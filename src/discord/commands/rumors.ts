import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { generateTradeRumors } from '../../services/aiStorylineService';
import { splitMessage } from '../bot';
import { query } from '../../config/database';

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
  .setName('rumors')
  .setDescription('Get the latest Word on the Street trade rumors')
  .addIntegerOption(option =>
    option
      .setName('deadline')
      .setDescription('Weeks until trade deadline (triggers deadline report)')
      .setRequired(false)
  );

export const execute = async (
  interaction: ChatInputCommandInteraction
) => {
  await interaction.deferReply();

  try {
    const league = await getLeagueForServer(interaction.guildId!);

    if (!league) {
      await interaction.editReply('❌ No league connected to this server.');
      return;
    }

    const weeksToDeadline = interaction.options.getInteger('deadline') ?? undefined;

    await interaction.editReply('📰 Gathering intel from league sources...');

    const result = await generateTradeRumors(
      league.id,
      league.current_season,
      league.current_week,
      weeksToDeadline
    );

    const rumorHeader = '📰 **WORD ON THE STREET** | AccessGrantedSportz\n━━━━━━━━━━━━━━━━━━━━━━\n';
    const rumorChunks = splitMessage(rumorHeader + result.rumors, 2000);
    await interaction.editReply(rumorChunks[0]);
    for (let i = 1; i < rumorChunks.length; i++) {
      await interaction.followUp(rumorChunks[i]);
    }

    const takesHeader = '\n🔥 **HOT TAKES** | Word on the Street\n━━━━━━━━━━━━━━━━━━━━━━\n';
    const takesChunks = splitMessage(takesHeader + result.hot_takes, 2000);
    for (const chunk of takesChunks) {
      await interaction.followUp(chunk);
    }

    if (result.deadline_report) {
      const deadlineHeader = '\n🚨 **DEADLINE ALERT** | Word on the Street\n━━━━━━━━━━━━━━━━━━━━━━\n';
      const deadlineChunks = splitMessage(deadlineHeader + result.deadline_report, 2000);
      for (const chunk of deadlineChunks) {
        await interaction.followUp(chunk);
      }
    }

  } catch (error) {
    console.error('Rumors command error:', error);
    await interaction.editReply('❌ Error generating rumors. Try again later.');
  }
};