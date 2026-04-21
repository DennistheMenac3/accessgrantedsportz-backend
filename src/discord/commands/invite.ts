import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { query } from '../../config/database';
import { v4 as uuidv4 } from 'uuid';
import { COLORS, createEmbed } from '../../config/brand';

const getLeagueForServer = async (guildId: string): Promise<any | null> => {
  const result = await query(
    `SELECT l.*,
      COALESCE((SELECT MAX(g.season) FROM games g WHERE g.league_id = l.id), 1) as current_season,
      COALESCE((SELECT MAX(g.week)   FROM games g WHERE g.league_id = l.id), 1) as current_week
     FROM leagues l
     WHERE l.discord_guild_id = $1
     LIMIT 1`,
    [guildId]
  );
  return result.rows[0] || null;
};

const generateInviteCode = (): string => {
  const chars    = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segments = [4, 4];
  return segments
    .map(len =>
      Array.from(
        { length: len },
        () => chars[Math.floor(Math.random() * chars.length)]
      ).join('')
    )
    .join('-');
};

export const data = new SlashCommandBuilder()
  .setName('invite')
  .setDescription('🎟️ Generate a league invite link for new members');

export const execute = async (
  interaction: ChatInputCommandInteraction
) => {
  await interaction.deferReply({ ephemeral: true });

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

    const ownerCheck = await query(
      `SELECT owner_id FROM leagues WHERE id = $1`,
      [league.id]
    );

    const inviteCode = generateInviteCode();
    const expiresAt  = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await query(
      `INSERT INTO league_invites (
        id, league_id, invite_code,
        created_by, max_uses, expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        uuidv4(),
        league.id,
        inviteCode,
        ownerCheck.rows[0]?.owner_id,
        32,
        expiresAt
      ]
    );

    const frontendUrl = process.env.FRONTEND_URL ||
      'https://accessgrantedsportz.com';
    const inviteUrl   = `${frontendUrl}/invite/${inviteCode}`;

    // Commissioner sees full details (ephemeral)
    const commishEmbed = createEmbed(COLORS.GOLD)
      .setTitle('🎟️ Invite Created!')
      .setDescription(
        `Share the message below in your league Discord or ` +
        `send the link directly to new members.`
      )
      .addFields(
        { name: '🏈 League',      value: league.name,                        inline: true },
        { name: '🔑 Code',        value: `\`${inviteCode}\``,                inline: true },
        { name: '📅 Expires',     value: expiresAt.toLocaleDateString(),     inline: true },
        { name: '👥 Spots',       value: '32 available',                     inline: true },
        { name: '🔗 Invite Link', value: inviteUrl,                          inline: false },
        {
          name:  'Share This With Your League',
          value:
            `🏈 **Join ${league.name} on AccessGrantedSportz!**\n\n` +
            `1. Click the link: **${inviteUrl}**\n` +
            `2. Login with Discord\n` +
            `3. Pick your team\n` +
            `4. Start tracking your franchise!\n\n` +
            `**Code:** \`${inviteCode}\` | Expires ${expiresAt.toLocaleDateString()}`,
          inline: false
        }
      );

    await interaction.editReply({ embeds: [commishEmbed] });

  } catch (error) {
    console.error('Invite command error:', error);
    await interaction.editReply({
      embeds: [createEmbed(COLORS.DANGER)
        .setTitle('❌ Error')
        .setDescription('Error generating invite. Please try again.')]
    });
  }
};