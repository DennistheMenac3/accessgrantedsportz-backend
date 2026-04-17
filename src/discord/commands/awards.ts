import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { getAwardLeaders } from '../../services/awardsService';
import { getLeagueForServer } from '../helpers';

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
      await interaction.editReply('❌ No league connected.');
      return;
    }

    const awards = await getAwardLeaders(
      league.id,
      league.current_season
    );

    if (awards.length === 0) {
      await interaction.editReply(
        `No awards calculated yet for Season ${league.current_season}. Try /calculate first.`
      );
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

    let response = `🏆 **AWARD LEADERS** | AccessGrantedSportz\n`;
    response += `**${league.name}** | Season ${league.current_season}\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Group by category
    const categories: { [key: string]: any[] } = {};
    awards.forEach((award: any) => {
      if (!categories[award.category]) {
        categories[award.category] = [];
      }
      categories[award.category].push(award);
    });

    for (const [category, categoryAwards] of Object.entries(categories)) {
      response += `${categoryEmoji(category)} **${category.toUpperCase()} AWARDS**\n`;

      categoryAwards.forEach((award: any) => {
        const winner = award.first_name
          ? `${award.first_name} ${award.last_name} ${devEmoji(award.dev_trait || '')}`
          : award.team_name;

        response += `🏅 **${award.award_name}**\n`;
        response += `   ${winner}`;
        if (award.team_abbreviation) {
          response += ` (${award.team_abbreviation})`;
        }
        response += `\n\n`;
      });
    }

    response += `*Powered by AccessGrantedSportz*`;

    await interaction.editReply(response);

  } catch (error) {
    console.error('Awards command error:', error);
    await interaction.editReply('❌ Error fetching awards.');
  }
};