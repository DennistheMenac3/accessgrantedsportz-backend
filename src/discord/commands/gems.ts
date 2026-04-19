import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { calculateTeamLeaderStats } from '../../services/awardsService';
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
  .setName('gems')
  .setDescription('💎 Find trapped gems — elite players on bad teams');

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
          .setDescription('No league is connected to this server.')]
      });
      return;
    }

    await interaction.editReply({
      embeds: [createEmbed(COLORS.NAVY)
        .setTitle('💎 Scanning Rosters...')
        .setDescription('Searching for hidden talent on struggling teams...')]
    });

    const { trapped_gems } = await calculateTeamLeaderStats(
      league.id,
      league.current_season
    );

    if (trapped_gems.length === 0) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.SUCCESS)
          .setTitle('✅ No Trapped Gems Found')
          .setDescription('Talent is evenly distributed across all teams!')]
      });
      return;
    }

    const fields = trapped_gems.slice(0, 5).map((gem: any) => {
      const tierEmoji =
        gem.gem_tier === 'ELITE_GEM'  ? '💎' :
        gem.gem_tier === 'STRONG_GEM' ? '🔷' :
        gem.gem_tier === 'SOLID_GEM'  ? '🔹' : '⚪';

      const devLabel =
        gem.dev_trait === 'xfactor'   ? '⚡ XFactor'  :
        gem.dev_trait === 'superstar' ? '⭐ Superstar' :
        gem.dev_trait === 'star'      ? '🌟 Star'      : '📋 Normal';

      return {
        name:
          `${tierEmoji} ${gem.name} | ${gem.position} | ` +
          `${gem.team_context.team_name} ` +
          `(${gem.team_context.team_wins}-${gem.team_context.team_losses})`,
        value:
          `OVR: **${gem.overall_rating}** | Age: ${gem.age} | ${devLabel}\n` +
          `Gem Score: **${gem.trapped_gem_score}** | ${gem.gem_tier}\n` +
          `📋 ${gem.gem_reasons[0]}`,
        inline: false
      };
    });

    const embed = createEmbed(COLORS.GOLD)
      .setTitle('💎 Trapped Gems Report | AccessGrantedSportz')
      .setDescription(
        `**${league.name}** | Season ${league.current_season}\n` +
        `*Elite players stuck on struggling teams — buy low before it's too late*`
      )
      .addFields(fields)
      .setFooter({
        text: 'Use /scout [player name] for a full scouting report • AccessGrantedSportz'
      });

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('Gems command error:', error);
    await interaction.editReply({
      embeds: [createEmbed(COLORS.DANGER)
        .setTitle('❌ Error')
        .setDescription('Error finding gems. Please try again.')]
    });
  }
};