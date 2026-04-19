import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { query } from '../../config/database';
import { v4 as uuidv4 } from 'uuid';
import { COLORS, createEmbed } from '../../config/brand';

const getLeagueForServer = async (guildId: string): Promise<any | null> => {
  const result = await query(
    `SELECT l.* FROM leagues l
     WHERE l.discord_guild_id = $1
     LIMIT 1`,
    [guildId]
  );
  return result.rows[0] || null;
};

export const data = new SlashCommandBuilder()
  .setName('join')
  .setDescription('🏈 Join the league and link your Discord account')
  .addStringOption(option =>
    option
      .setName('code')
      .setDescription('Your invite code (e.g. XXXX-XXXX)')
      .setRequired(true)
  );

export const execute = async (
  interaction: ChatInputCommandInteraction
) => {
  try {
    await interaction.deferReply({ ephemeral: true });
  } catch {
    return;
  }

  try {
    const league = await getLeagueForServer(interaction.guildId!);
    if (!league) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('❌ No League Connected')
          .setDescription('No league is connected to this server.')]
      });
      return;
    }

    const code          = interaction.options.getString('code', true).toUpperCase();
    const discordUserId = interaction.user.id;
    const discordTag    = interaction.user.username;

    // Validate invite code
    const inviteResult = await query(
      `SELECT li.*, l.name as league_name
       FROM league_invites li
       JOIN leagues l ON l.id = li.league_id
       WHERE li.invite_code = $1
       AND li.league_id     = $2
       AND li.is_active     = true
       AND li.expires_at    > NOW()
       AND li.uses          < li.max_uses`,
      [code, league.id]
    );

    if (inviteResult.rows.length === 0) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('❌ Invalid Invite Code')
          .setDescription(
            'This invite code is invalid or expired.\n' +
            'Ask your commissioner for a new one.'
          )]
      });
      return;
    }

    // Check if Discord already linked
    const existingUser = await query(
      `SELECT u.*, t.name as team_name, t.abbreviation
       FROM users u
       LEFT JOIN teams t ON t.owner_id = u.id
       WHERE u.discord_user_id = $1`,
      [discordUserId]
    );

    if (existingUser.rows.length > 0) {
      const user = existingUser.rows[0];
      if (user.team_name) {
        await interaction.editReply({
          embeds: [createEmbed(COLORS.SUCCESS)
            .setTitle('✅ Already Linked!')
            .addFields(
              { name: '🏈 Team',     value: `${user.team_name} (${user.abbreviation})`, inline: true },
              { name: '👤 Username', value: user.username,                               inline: true }
            )]
        });
      } else {
        await interaction.editReply({
          embeds: [createEmbed(COLORS.WARNING)
            .setTitle('✅ Discord Linked — No Team Yet')
            .setDescription(
              'Your Discord is linked but you haven\'t claimed a team.\n' +
              'Use **/claim [abbreviation]** to pick your team!'
            )]
        });
      }
      return;
    }

    // Check if user has existing web account
    const leagueMember = await query(
      `SELECT lm.*, u.username, u.id as user_id,
        t.name as team_name, t.abbreviation
       FROM league_members lm
       JOIN users u ON u.id = lm.user_id
       LEFT JOIN teams t ON t.id = lm.team_id
       WHERE lm.league_id = $1
       AND u.discord_user_id IS NULL
       ORDER BY lm.joined_at DESC`,
      [league.id]
    );

    if (leagueMember.rows.length > 0) {
      const member = leagueMember.rows[0];
      await query(
        `UPDATE users SET
          discord_user_id  = $1,
          discord_username = $2
         WHERE id = $3`,
        [discordUserId, discordTag, member.user_id]
      );

      await interaction.editReply({
        embeds: [createEmbed(COLORS.SUCCESS)
          .setTitle('✅ Discord Linked Successfully!')
          .setDescription('You\'ll now be tagged in score updates!')
          .addFields(
            { name: '🏈 League',   value: league.name,       inline: true },
            { name: '👤 Username', value: member.username,   inline: true },
            {
              name:  '🏟️ Team',
              value: member.team_name
                ? `${member.team_name} (${member.abbreviation})`
                : 'Not claimed — use **/claim [abbr]**',
              inline: true
            }
          )]
      });
      return;
    }

    // Create new account via Discord
    const newUserId = uuidv4();

    await query(
      `INSERT INTO users (
        id, username, email,
        password_hash, discord_user_id, discord_username
      )
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        newUserId,
        discordTag,
        `${discordUserId}@discord.ags`,
        'discord_auth',
        discordUserId,
        discordTag
      ]
    );

    await query(
      `INSERT INTO league_members (id, league_id, user_id, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (league_id, user_id) DO NOTHING`,
      [uuidv4(), league.id, newUserId, 'member']
    );

    await query(
      `UPDATE league_invites SET uses = uses + 1
       WHERE invite_code = $1`,
      [code]
    );

    // Show available teams
    const teamsResult = await query(
      `SELECT id, name, abbreviation, overall_rating, wins, losses
       FROM teams
       WHERE league_id = $1
       AND owner_id IS NULL
       ORDER BY overall_rating DESC`,
      [league.id]
    );

    if (teamsResult.rows.length === 0) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.WARNING)
          .setTitle(`✅ Welcome to ${league.name}!`)
          .setDescription(
            'Your Discord account has been linked.\n' +
            'Unfortunately all teams are taken — contact your commissioner.'
          )]
      });
      return;
    }

    const teamFields = teamsResult.rows.slice(0, 10).map((team: any) => ({
      name:   `${team.abbreviation} — ${team.name}`,
      value:  `${team.wins}-${team.losses} | OVR: ${team.overall_rating}`,
      inline: true
    }));

    await interaction.editReply({
      embeds: [createEmbed(COLORS.GOLD)
        .setTitle(`✅ Welcome to ${league.name}!`)
        .setDescription(
          `Your Discord is linked! 🎉\n\n` +
          `Use **/claim [abbreviation]** to claim your team.\n` +
          `Example: \`/claim BAL\``
        )
        .addFields(teamFields)]
    });

  } catch (error) {
    console.error('Join command error:', error);
    try {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('❌ Error')
          .setDescription('Error joining league. Please try again.')]
      });
    } catch {
      // Ignore
    }
  }
};