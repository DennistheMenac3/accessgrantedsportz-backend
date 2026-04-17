import { query } from '../../config/database';
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { generateScoutingReport } from '../../services/aiStorylineService';
import { splitMessage } from '../bot';

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

export const data = new SlashCommandBuilder()
  .setName('scout')
  .setDescription('Get a War Room scouting report on a player')
  .addStringOption(option =>
    option
      .setName('player')
      .setDescription('Player name (first last)')
      .setRequired(true)
  );

export const execute = async (
  interaction: ChatInputCommandInteraction
) => {
  await interaction.deferReply();

  try {
    const league = await getLeagueForServer(interaction.guildId!);

    if (!league) {
      await interaction.editReply('❌ No league connected.');
      return;
    }

    const playerName = interaction.options.getString('player', true);
    const [firstName, ...lastNameParts] = playerName.split(' ');
    const lastName = lastNameParts.join(' ');

    // Find the player
    const playerResult = await query(
      `SELECT id FROM players
       WHERE league_id = $1
       AND LOWER(first_name) = LOWER($2)
       AND LOWER(last_name) = LOWER($3)`,
      [league.id, firstName, lastName]
    );

    if (playerResult.rows.length === 0) {
      await interaction.editReply(
        `❌ Player "${playerName}" not found in your league.`
      );
      return;
    }

    const playerId = playerResult.rows[0].id;

    await interaction.editReply(
      `🔍 War Room is pulling the file on **${playerName}**...`
    );

    const report = await generateScoutingReport(
      league.id,
      playerId,
      league.current_season
    );

    const header = `🔍 **WAR ROOM REPORT** | AccessGrantedSportz\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    const chunks = splitMessage(header + report, 2000);

    await interaction.editReply(chunks[0]);
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp(chunks[i]);
    }

  } catch (error) {
    console.error('Scout command error:', error);
    await interaction.editReply('❌ Error generating scouting report.');
  }
};