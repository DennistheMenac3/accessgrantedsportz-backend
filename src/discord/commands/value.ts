import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
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
  .setName('value')
  .setDescription('💰 Get a player\'s trade value score and breakdown')
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
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('❌ No League Connected')
          .setDescription('No league is connected to this server.')]
      });
      return;
    }

    const playerName = interaction.options.getString('player', true);

    const result = await query(
      `SELECT
        p.first_name, p.last_name,
        p.position, p.overall_rating,
        p.age, p.dev_trait, p.speed,
        t.name         as team_name,
        t.abbreviation as team_abbr,
        t.wins, t.losses,
        COALESCE(tvh.total_value, 0) as trade_value,
        tvh.value_breakdown,
        tvh.calculated_at
       FROM players p
       LEFT JOIN teams t ON t.id = p.team_id
       LEFT JOIN trade_value_history tvh
         ON tvh.player_id  = p.id
         AND tvh.league_id = p.league_id
       WHERE p.league_id = $1
       AND (
         LOWER(p.first_name || ' ' || p.last_name) LIKE LOWER($2)
         OR LOWER(p.first_name) LIKE LOWER($2)
         OR LOWER(p.last_name)  LIKE LOWER($2)
         OR LOWER(p.first_name || ' ' || p.last_name) LIKE LOWER('%' || $2 || '%')
       )
       ORDER BY tvh.calculated_at DESC
       LIMIT 1`,
      [league.id, playerName]
    );

    if (result.rows.length === 0) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('❌ Player Not Found')
          .setDescription(`Player "${playerName}" not found in your league.`)]
      });
      return;
    }

    const player     = result.rows[0];
    const tradeValue = parseFloat(player.trade_value);
    const breakdown  = player.value_breakdown || {};

    const devLabel =
      player.dev_trait === 'xfactor'   ? '⚡ XFactor'  :
      player.dev_trait === 'superstar' ? '⭐ Superstar' :
      player.dev_trait === 'star'      ? '🌟 Star'      : '📋 Normal';

    // Color based on trade value tier
    const valueColor =
      tradeValue >= 200 ? COLORS.GOLD    :
      tradeValue >= 150 ? COLORS.ORANGE  :
      tradeValue >= 100 ? COLORS.NAVY    :
      tradeValue >= 50  ? COLORS.NAVY    :
      COLORS.DANGER;

    const valueTier =
      tradeValue >= 200 ? '👑 ELITE'         :
      tradeValue >= 150 ? '💎 FRANCHISE'      :
      tradeValue >= 100 ? '⭐ PREMIUM'        :
      tradeValue >= 50  ? '✅ SOLID STARTER'  :
      '📋 DEPTH';

    const embed = createEmbed(valueColor)
      .setTitle(
        `💰 ${player.first_name} ${player.last_name} | Trade Value Report`
      )
      .setDescription(
        `${player.position} | ${player.team_name} ` +
        `(${player.wins}-${player.losses})\n` +
        `${devLabel} | ${valueTier}`
      )
      .addFields(
        {
          name:   '📊 Player Info',
          value:
            `**Overall:** ${player.overall_rating}\n` +
            `**Age:** ${player.age}\n` +
            `**Speed:** ${player.speed}\n` +
            `**Dev Trait:** ${devLabel}`,
          inline: true
        },
        {
          name:   '💰 Trade Value',
          value:
            `**TVS: ${tradeValue.toFixed(1)}**\n` +
            `Tier: ${valueTier}`,
          inline: true
        }
      );

    // Add breakdown if available
    if (breakdown && Object.keys(breakdown).length > 0) {
      embed.addFields(
        {
          name:
            '📈 Value Breakdown',
          value:
            `📊 Base Value:    **${breakdown.base_value      || 0}**\n` +
            `⚡ Speed Bonus:   **${breakdown.speed_bonus     || 0}**\n` +
            `🧬 Dev/Age Bonus: **${breakdown.dev_trait_age_bonus || 0}**\n` +
            `🏋️ Trait Bonus:   **${breakdown.trait_bonus     || 0}**\n` +
            `🏆 Award Bonus:   **${breakdown.award_bonus     || 0}**\n` +
            `📈 Trend Bonus:   **${breakdown.trend_bonus     || 0}**`,
          inline: true
        },
        {
          name:   '✖️ Multipliers',
          value:
            `📅 Age:      **${breakdown.age_multiplier       || 1}x**\n` +
            `🏈 Position: **${breakdown.position_multiplier  || 1}x**\n` +
            `⚡ Dev:      **${breakdown.dev_trait_multiplier || 1}x**`,
          inline: true
        }
      );
    }

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('Value error:', error);
    await interaction.editReply({
      embeds: [createEmbed(COLORS.DANGER)
        .setTitle('❌ Error')
        .setDescription('Error fetching trade value. Please try again.')]
    });
  }
};