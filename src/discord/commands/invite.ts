import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { query } from '../../config/database';
import { v4 as uuidv4 } from 'uuid';

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
      await interaction.editReply('❌ No league connected.');
      return;
    }

    // Check if user is the commissioner
    const ownerCheck = await query(
      `SELECT owner_id FROM leagues WHERE id = $1`,
      [league.id]
    );

    const discordUserId = interaction.user.id;
    const userResult    = await query(
      `SELECT id, username FROM users
       WHERE discord_user_id = $1`,
      [discordUserId]
    );

    // Generate invite code
    const inviteCode = generateInviteCode();
    const expiresAt  = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000
    );

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

    const baseUrl   = process.env.FRONTEND_URL || 'https://accessgrantedsportz.com';
    const inviteUrl = `${baseUrl}/join/${inviteCode}`;

    let response = `🎟️ **League Invite Created!**\n\n`;
    response += `**League:** ${league.name}\n`;
    response += `**Invite Code:** \`${inviteCode}\`\n`;
    response += `**Expires:** ${expiresAt.toLocaleDateString()}\n`;
    response += `**Spots:** 32 available\n\n`;
    response += `**Share this message in your league:**\n\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `🏈 **Join ${league.name} on AccessGrantedSportz!**\n\n`;
    response += `1. Go to **${inviteUrl}**\n`;
    response += `2. Create your account\n`;
    response += `3. Pick your team\n`;
    response += `4. Start tracking your franchise!\n\n`;
    response += `**Invite Code:** \`${inviteCode}\`\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━━`;

    await interaction.editReply(response);

  } catch (error) {
    console.error('Invite command error:', error);
    await interaction.editReply('❌ Error generating invite.');
  }
};