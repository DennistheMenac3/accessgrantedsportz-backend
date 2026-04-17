import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { generatePowerRankings } from '../../services/aiStorylineService';
import { splitMessage } from '../bot';
import { query } from '../../config/database';

// Inline helper — avoids separate import issues
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
  .setName('rankings')
  .setDescription('Get the latest power rankings')
  .addStringOption(option =>
    option
      .setName('style')
      .setDescription('Choose ranking style')
      .setRequired(false)
      .addChoices(
        { name: '🔥 The Hot Seat (Hype)',       value: 'stephen_a' },
        { name: '📊 The Power Report (Standard)', value: 'standard'  }
      )
  );

export const execute = async (
  interaction: ChatInputCommandInteraction
) => {
  await interaction.deferReply();

  try {
    const league = await getLeagueForServer(interaction.guildId!);

    if (!league) {
      await interaction.editReply(
        '❌ No league connected to this server. Ask your commissioner to set up AccessGrantedSportz!'
      );
      return;
    }

    const style = (
      interaction.options.getString('style') || 'stephen_a'
    ) as 'standard' | 'stephen_a';

    await interaction.editReply(
      `🏈 Generating ${style === 'stephen_a' ? '🔥 The Hot Seat' : '📊 The Power Report'}...`
    );

    const result = await generatePowerRankings(
      league.id,
      league.current_season,
      league.current_week,
      style
    );

    const header = style === 'stephen_a'
      ? '🔥 **THE HOT SEAT** | AccessGrantedSportz\n━━━━━━━━━━━━━━━━━━━━━━\n'
      : '📊 **THE POWER REPORT** | AccessGrantedSportz\n━━━━━━━━━━━━━━━━━━━━━━\n';

    const chunks = splitMessage(header + result.rankings, 2000);
    await interaction.editReply(chunks[0]);
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp(chunks[i]);
    }

  } catch (error) {
    console.error('Rankings command error:', error);
    await interaction.editReply('❌ Error generating rankings. Try again later.');
  }
};