import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { query } from '../../config/database';

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
  .setName('claim')
  .setDescription('🏈 Claim your team in the league')
  .addStringOption(option =>
    option
      .setName('team')
      .setDescription('Team abbreviation (e.g. BAL, KC, DAL)')
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
      await interaction.editReply('❌ No league connected.');
      return;
    }

    const discordUserId = interaction.user.id;
    const teamAbbr      = interaction.options
      .getString('team', true)
      .toUpperCase();

    // Find the user by Discord ID
    const userResult = await query(
      `SELECT u.*
       FROM users u
       WHERE u.discord_user_id = $1`,
      [discordUserId]
    );

    if (userResult.rows.length === 0) {
      await interaction.editReply(
        `❌ You haven't joined the league yet.\n` +
        `Use **/join [invite code]** first!`
      );
      return;
    }

    const user = userResult.rows[0];

    // Check if already has a team
    const existingTeam = await query(
      `SELECT t.* FROM teams t
       WHERE t.owner_id  = $1
       AND t.league_id   = $2`,
      [user.id, league.id]
    );

    if (existingTeam.rows.length > 0) {
      await interaction.editReply(
        `❌ You already own **${existingTeam.rows[0].name}**.\n` +
        `Contact your commissioner to change teams.`
      );
      return;
    }

    // Find the requested team
    const teamResult = await query(
      `SELECT * FROM teams
       WHERE league_id   = $1
       AND abbreviation  = $2`,
      [league.id, teamAbbr]
    );

    if (teamResult.rows.length === 0) {
      await interaction.editReply(
        `❌ Team **${teamAbbr}** not found.\n` +
        `Use **/join** to see available teams.`
      );
      return;
    }

    const team = teamResult.rows[0];

    // Check if team is taken
    if (team.owner_id) {
      await interaction.editReply(
        `❌ **${team.name}** is already taken.\n` +
        `Use **/join** to see available teams.`
      );
      return;
    }

    // Claim the team
    await query(
      `UPDATE teams
       SET owner_id        = $1,
           owner_username  = $2
       WHERE id            = $3`,
      [user.id, user.username, team.id]
    );

    // Update league member record
    await query(
      `UPDATE league_members
       SET team_id = $1
       WHERE league_id = $2
       AND user_id     = $3`,
      [team.id, league.id, user.id]
    );

    await interaction.editReply(
      `✅ **${team.name} is yours!**\n\n` +
      `🏈 **${team.abbreviation}** — ${team.name}\n` +
      `Record: ${team.wins}-${team.losses}\n` +
      `Overall: ${team.overall_rating}\n\n` +
      `You'll be tagged in score updates as <@${discordUserId}>\n` +
      `Good luck this season! 🏆`
    );

  } catch (error) {
    console.error('Claim command error:', error);
    try {
      await interaction.editReply('❌ Error claiming team.');
    } catch {
      // Ignore
    }
  }
};