import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { getAwardLeaders } from '../../services/awardsService';
import { getLeagueForServer } from '../helpers';
import { COLORS, FOOTER, createEmbed } from '../../config/brand';

export const data = new SlashCommandBuilder()
  .setName('awards')
  .setDescription('🏆 View current award leaders for the season');

export const execute = async (
  interaction: ChatInputCommandInteraction
) => {
  await interaction.deferReply();

  try {
    const league = await getLeagueForServer(interaction.guildId!);
    if (!league) {
      const errorEmbed = createEmbed(COLORS.DANGER)
        .setTitle('❌ No League Connected')
        .setDescription('No league is connected to this server.');
      await interaction.editReply({ embeds: [errorEmbed] });
      return;
    }

    const awards = await getAwardLeaders(
      league.id,
      league.current_season
    );

    if (awards.length === 0) {
      const noDataEmbed = createEmbed(COLORS.NAVY)
        .setTitle('🏆 Award Leaders')
        .setDescription(
          `No awards calculated yet for Season ${league.current_season}.`
        );
      await interaction.editReply({ embeds: [noDataEmbed] });
      return;
    }

    const devEmoji = (dev: string) =>
      dev === 'xfactor'   ? '⚡' :
      dev === 'superstar' ? '⭐' :
      dev === 'star'      ? '🌟' : '';

    const categoryEmoji = (cat: string) =>
      cat === 'individual'  ? '👤' :
      cat === 'team'        ? '🏟️' :
      cat === 'statistical' ? '📊' : '🏆';

    // Group by category
    const categories: { [key: string]: any[] } = {};
    awards.forEach((award: any) => {
      if (!categories[award.category]) {
        categories[award.category] = [];
      }
      categories[award.category].push(award);
    });

    // Build embed fields from categories
    const fields: { name: string; value: string; inline: boolean }[] = [];

    for (const [category, categoryAwards] of Object.entries(categories)) {
      const fieldValue = categoryAwards.map((award: any) => {
        const winner = award.first_name
          ? `${award.first_name} ${award.last_name} ${devEmoji(award.dev_trait || '')}`
          : award.team_name;
        const team = award.team_abbreviation
          ? ` (${award.team_abbreviation})`
          : '';
        return `🏅 **${award.award_name}**\n${winner}${team}`;
      }).join('\n\n');

      fields.push({
        name:   `${categoryEmoji(category)} ${category.toUpperCase()} AWARDS`,
        value:  fieldValue.slice(0, 1024),
        inline: false
      });
    }

    const embed = createEmbed(COLORS.GOLD)
      .setTitle(`🏆 Award Leaders | ${league.name}`)
      .setDescription(`Season ${league.current_season}`)
      .addFields(fields);

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('Awards command error:', error);
    const errorEmbed = createEmbed(COLORS.DANGER)
      .setTitle('❌ Error')
      .setDescription('Error fetching awards. Please try again.');
    await interaction.editReply({ embeds: [errorEmbed] });
  }
};