import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { query } from '../../config/database';
import { v4 as uuidv4 } from 'uuid';

const getLeagueForServer = async (guildId: string): Promise<any | null> => {
  const result = await query(
    `SELECT l.*
     FROM leagues l
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
      await interaction.editReply('❌ No league connected to this server.');
      return;
    }

    const code          = interaction.options.getString('code', true).toUpperCase();
    const discordUserId = interaction.user.id;
    const discordTag    = interaction.user.username;

    // =============================================
    // Step 1 — Validate invite code
    // =============================================
    const inviteResult = await query(
      `SELECT li.*,
        l.name as league_name
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
      await interaction.editReply(
        '❌ Invalid or expired invite code. Ask your commissioner for a new one.'
      );
      return;
    }

    const invite = inviteResult.rows[0];

    // =============================================
    // Step 2 — Check if Discord already linked
    // =============================================
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
        await interaction.editReply(
          `✅ You're already linked!\n` +
          `**Team:** ${user.team_name} (${user.abbreviation})\n` +
          `**Username:** ${user.username}`
        );
      } else {
        await interaction.editReply(
          `✅ Your Discord is linked but you haven't claimed a team yet.\n` +
          `Visit the invite link to pick your team!`
        );
      }
      return;
    }

    // =============================================
    // Step 3 — Check if user has a web account
    // already linked to this league
    // =============================================
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
      // Show them their options if multiple unlinked accounts
      const member = leagueMember.rows[0];

      // Link Discord to their existing account
      await query(
        `UPDATE users 
         SET discord_user_id = $1,
             discord_username = $2
         WHERE id = $3`,
        [discordUserId, discordTag, member.user_id]
      );

      await interaction.editReply(
        `✅ **Discord linked successfully!**\n\n` +
        `**League:** ${league.name}\n` +
        `**Username:** ${member.username}\n` +
        `${member.team_name
          ? `**Team:** ${member.team_name} (${member.abbreviation})`
          : `**Team:** Not yet claimed — visit the invite link to pick one!`
        }\n\n` +
        `You'll now be tagged in score updates! 🏈`
      );
      return;
    }

    // =============================================
    // Step 4 — Create new account via Discord
    // No web signup needed
    // =============================================
    const newUserId = uuidv4();

    // Create user account
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

    // Add to league members
    await query(
      `INSERT INTO league_members (
        id, league_id, user_id, role
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (league_id, user_id) DO NOTHING`,
      [uuidv4(), league.id, newUserId, 'member']
    );

    // Increment invite uses
    await query(
      `UPDATE league_invites
       SET uses = uses + 1
       WHERE invite_code = $1`,
      [code]
    );

    // =============================================
    // Step 5 — Show available teams to claim
    // =============================================
    const teamsResult = await query(
      `SELECT id, name, abbreviation,
        overall_rating, wins, losses
       FROM teams
       WHERE league_id = $1
       AND owner_id IS NULL
       ORDER BY name ASC`,
      [league.id]
    );

    if (teamsResult.rows.length === 0) {
      await interaction.editReply(
        `✅ **Welcome to ${league.name}!**\n\n` +
        `Your Discord account has been linked.\n` +
        `Unfortunately all teams are taken. Contact your commissioner.`
      );
      return;
    }

    // Format available teams list
    let teamList = `✅ **Welcome to ${league.name}!**\n\n`;
    teamList += `Your Discord is now linked 🎉\n\n`;
    teamList += `**Available Teams:**\n`;

    teamsResult.rows.forEach((team: any) => {
      teamList +=
        `• **${team.abbreviation}** — ${team.name} ` +
        `(${team.wins}-${team.losses}) OVR: ${team.overall_rating}\n`;
    });

    teamList += `\nUse **/claim [team abbreviation]** to claim your team!`;

    await interaction.editReply(teamList);

  } catch (error) {
    console.error('Join command error:', error);
    try {
      await interaction.editReply('❌ Error joining league. Please try again.');
    } catch {
      // Ignore
    }
  }
};