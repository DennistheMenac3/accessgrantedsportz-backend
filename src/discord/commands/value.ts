import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
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
      await interaction.editReply('❌ No league connected.');
      return;
    }

    const playerName = interaction.options.getString('player', true);

    const result = await query(
      `SELECT
        p.first_name, p.last_name,
        p.position, p.overall_rating,
        p.age, p.dev_trait, p.speed,
        t.name as team_name,
        t.wins, t.losses,
        COALESCE(tvh.total_value, 0)      as trade_value,
        tvh.value_breakdown,
        tvh.calculated_at
       FROM players p
       LEFT JOIN teams t ON t.id = p.team_id
       LEFT JOIN trade_value_history tvh
         ON tvh.player_id = p.id
         AND tvh.league_id = p.league_id
       WHERE p.league_id = $1
       AND (
         LOWER(p.first_name || ' ' || p.last_name) LIKE LOWER($2)
         OR LOWER(p.first_name) LIKE LOWER($2)
         OR LOWER(p.last_name) LIKE LOWER($2)
         OR LOWER(p.first_name || ' ' || p.last_name) LIKE LOWER('%' || $2 || '%')
       )
       ORDER BY tvh.calculated_at DESC
       LIMIT 1`,
      [league.id, playerName]
    );

    if (result.rows.length === 0) {
      await interaction.editReply(`❌ Player "${playerName}" not found.`);
      return;
    }

    const player     = result.rows[0];
    const tradeValue = parseFloat(player.trade_value);
    const breakdown  = player.value_breakdown || {};

    const devLabel =
      player.dev_trait === 'xfactor'   ? '⚡ X-Factor'  :
      player.dev_trait === 'superstar' ? '⭐ Superstar'  :
      player.dev_trait === 'star'      ? '🌟 Star'       : '📋 Normal';

    let response = `💰 **TRADE VALUE REPORT** | AccessGrantedSportz\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    response += `**${player.first_name} ${player.last_name}**\n`;
    response += `${player.position} | ${player.team_name} (${player.wins}-${player.losses})\n`;
    response += `OVR: ${player.overall_rating} | Age: ${player.age} | Spd: ${player.speed}\n`;
    response += `${devLabel}\n\n`;
    response += `💎 **TRADE VALUE SCORE: ${tradeValue.toFixed(1)}**\n\n`;

    if (breakdown && Object.keys(breakdown).length > 0) {
      response += `**Breakdown:**\n`;
      response += `📊 Base Value:     ${breakdown.base_value || 0}\n`;
      response += `⚡ Speed Bonus:    ${breakdown.speed_bonus || 0}\n`;
      response += `🧬 Dev/Age Bonus:  ${breakdown.dev_trait_age_bonus || 0}\n`;
      response += `🏋️ Trait Bonus:    ${breakdown.trait_bonus || 0}\n`;
      response += `🏆 Award Bonus:    ${breakdown.award_bonus || 0}\n`;
      response += `📈 Trend Bonus:    ${breakdown.trend_bonus || 0}\n\n`;
      response += `**Multipliers:**\n`;
      response += `📅 Age:      ${breakdown.age_multiplier || 1}x\n`;
      response += `🏈 Position: ${breakdown.position_multiplier || 1}x\n`;
      response += `⚡ Dev:      ${breakdown.dev_trait_multiplier || 1}x\n`;
    }

    response += `\n*Powered by AccessGrantedSportz Trade Engine*`;

    await interaction.editReply(response);

  } catch (error) {
    console.error('Value error:', error);
    await interaction.editReply('❌ Error fetching trade value.');
  }
};