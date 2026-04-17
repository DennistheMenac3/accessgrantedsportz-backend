import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { calculateTeamLeaderStats } from '../../services/awardsService';
import { query } from '../../config/database';

// Inline helper
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
  .setName('gems')
  .setDescription('💎 Find trapped gems — elite players on bad teams');

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

    await interaction.editReply('💎 Scanning rosters for hidden talent...');

    const { trapped_gems } = await calculateTeamLeaderStats(
      league.id,
      league.current_season
    );

    if (trapped_gems.length === 0) {
      await interaction.editReply(
        '✅ No trapped gems found — talent is evenly distributed!'
      );
      return;
    }

    let response = `💎 **TRAPPED GEMS REPORT** | AccessGrantedSportz\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `*Elite players stuck on struggling teams*\n\n`;

    trapped_gems.slice(0, 5).forEach((gem: any, i: number) => {
      const tierEmoji =
        gem.gem_tier === 'ELITE_GEM'  ? '💎' :
        gem.gem_tier === 'STRONG_GEM' ? '🔷' :
        gem.gem_tier === 'SOLID_GEM'  ? '🔹' : '⚪';

      response += `${tierEmoji} **${gem.name}** | ${gem.position}\n`;
      response += `Team: ${gem.team_context.team_name} (${gem.team_context.team_wins}-${gem.team_context.team_losses})\n`;
      response += `OVR: ${gem.overall_rating} | Age: ${gem.age} | Dev: ${gem.dev_trait.toUpperCase()}\n`;
      response += `Gem Score: ${gem.trapped_gem_score} | ${gem.gem_tier}\n`;
      response += `📋 ${gem.gem_reasons[0]}\n\n`;
    });

    response += `\n*Use /scout [player name] for a full scouting report*\n`;
    response += `*Powered by AccessGrantedSportz War Room*`;

    await interaction.editReply(response);

  } catch (error) {
    console.error('Gems command error:', error);
    await interaction.editReply('❌ Error finding gems.');
  }
};