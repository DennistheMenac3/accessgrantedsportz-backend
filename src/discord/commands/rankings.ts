import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { generatePowerRankings } from '../../services/aiStorylineService';
import { query } from '../../config/database';
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

export const data = new SlashCommandBuilder()
  .setName('rankings')
  .setDescription('Get the latest power rankings')
  .addStringOption(option =>
    option
      .setName('style')
      .setDescription('Choose ranking style')
      .setRequired(false)
      .addChoices(
        { name: '🔥 The Hot Seat (Hype)',        value: 'stephen_a' },
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
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('❌ No League Connected')
          .setDescription(
            'No league connected to this server.\n' +
            'Ask your commissioner to set up AccessGrantedSportz!'
          )]
      });
      return;
    }

    const style = (
      interaction.options.getString('style') || 'stephen_a'
    ) as 'standard' | 'stephen_a';

    const isHotSeat  = style === 'stephen_a';
    const title      = isHotSeat ? '🔥 The Hot Seat' : '📊 The Power Report';
    const color      = isHotSeat ? COLORS.ORANGE : COLORS.NAVY;

    // Loading embed
    await interaction.editReply({
      embeds: [createEmbed(color)
        .setTitle(`${title} | Generating...`)
        .setDescription('Analyzing all teams... (~15 seconds)')]
    });

    const result = await generatePowerRankings(
      league.id,
      league.current_season,
      league.current_week,
      style
    );

    // Split rankings into chunks of 1024 chars for embed fields
    const rankingsText = result.rankings;
    const chunks: string[] = [];
    let current = '';

    rankingsText.split('\n').forEach((line: string) => {
      if ((current + line).length > 1000) {
        chunks.push(current);
        current = line + '\n';
      } else {
        current += line + '\n';
      }
    });
    if (current) chunks.push(current);

    // First embed — header
    const mainEmbed = createEmbed(color)
      .setTitle(`${title} | ${league.name}`)
      .setDescription(
        `Week ${league.current_week} | Season ${league.current_season}`
      )
      .addFields(
        chunks.slice(0, 4).map((chunk, i) => ({
          name:   i === 0 ? '📋 Rankings' : '​', // zero-width space for continuation
          value:  chunk.slice(0, 1024),
          inline: false
        }))
      );

    await interaction.editReply({ embeds: [mainEmbed] });

    // If rankings overflow post additional embeds
    for (let i = 4; i < chunks.length; i++) {
      await interaction.followUp({
        embeds: [createEmbed(color)
          .setDescription(chunks[i].slice(0, 4096))]
      });
    }

  } catch (error) {
    console.error('Rankings command error:', error);
    await interaction.editReply({
      embeds: [createEmbed(COLORS.DANGER)
        .setTitle('❌ Error')
        .setDescription('Error generating rankings. Please try again.')]
    });
  }
};