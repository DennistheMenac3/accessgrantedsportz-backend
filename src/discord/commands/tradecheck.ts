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

const getStoredValue = async (
  playerId: string,
  leagueId: string
): Promise<number> => {
  const result = await query(
    `SELECT COALESCE(total_value, 0) as total_value
     FROM trade_value_history
     WHERE player_id = $1
     AND league_id = $2
     ORDER BY calculated_at DESC
     LIMIT 1`,
    [playerId, leagueId]
  );
  return parseFloat(result.rows[0]?.total_value || 0);
};

export const data = new SlashCommandBuilder()
  .setName('tradecheck')
  .setDescription('⚖️ Analyze if a trade is fair')
  .addStringOption(option =>
    option
      .setName('offering')
      .setDescription('Player you are offering (first last)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('requesting')
      .setDescription('Player you want in return (first last)')
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

    const offeringName   = interaction.options.getString('offering',   true);
    const requestingName = interaction.options.getString('requesting', true);

    const findPlayer = async (name: string) => {
      const [first, ...lastParts] = name.split(' ');
      const last = lastParts.join(' ');
      const result = await query(
        `SELECT
          p.id, p.first_name, p.last_name,
          p.position, p.overall_rating,
          p.dev_trait, p.age, p.speed,
          t.name as team_name
         FROM players p
         LEFT JOIN teams t ON t.id = p.team_id
         WHERE p.league_id = $1
         AND LOWER(p.first_name) = LOWER($2)
         AND LOWER(p.last_name)  = LOWER($3)`,
        [league.id, first, last]
      );
      return result.rows[0] || null;
    };

    const [offered, requested] = await Promise.all([
      findPlayer(offeringName),
      findPlayer(requestingName)
    ]);

    if (!offered) {
      await interaction.editReply(`❌ Player "${offeringName}" not found.`);
      return;
    }
    if (!requested) {
      await interaction.editReply(`❌ Player "${requestingName}" not found.`);
      return;
    }

    // Use stored values — fast database lookup
    const [offeredValue, requestedValue] = await Promise.all([
      getStoredValue(offered.id,   league.id),
      getStoredValue(requested.id, league.id)
    ]);

    const difference = offeredValue - requestedValue;
    const absDiff    = Math.abs(difference);

    const fairness =
      absDiff <= 10  ? '✅ FAIR TRADE'              :
      absDiff <= 25  ? '🟡 SLIGHTLY UNEVEN'         :
      absDiff <= 50  ? '🟠 CLEAR ADVANTAGE'         :
      absDiff <= 100 ? '🔴 LOPSIDED'                :
      '🚨 HIGHWAY ROBBERY';

    const advice =
      absDiff <= 10  ? 'Balanced trade — pull the trigger!'          :
      absDiff <= 25  ? 'Close but not even. Try adding a pick.'      :
      absDiff <= 50  ? 'Significant value gap. Negotiate harder.'    :
      absDiff <= 100 ? 'Walk away or demand major additions.'        :
      difference > 0 ? 'You\'re getting robbed. Do NOT do this.'    :
      'You\'re stealing. Do this immediately!';

    const whoWins =
      absDiff <= 10  ? 'Neither side'                                         :
      difference > 0 ? `${requested.first_name} ${requested.last_name}'s team` :
      `${offered.first_name} ${offered.last_name}'s team`;

    const devLabel = (dev: string) =>
      dev === 'xfactor'   ? '⚡ XFactor'  :
      dev === 'superstar' ? '⭐ Superstar' :
      dev === 'star'      ? '🌟 Star'      : '📋 Normal';

    let response = `⚖️ **TRADE ANALYSIS** | AccessGrantedSportz\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    response += `**YOU OFFER:**\n`;
    response += `🏈 **${offered.first_name} ${offered.last_name}**\n`;
    response += `${offered.position} | ${offered.team_name}\n`;
    response += `OVR: ${offered.overall_rating} | Age: ${offered.age} | Spd: ${offered.speed}\n`;
    response += `${devLabel(offered.dev_trait)}\n`;
    response += `💰 Trade Value: **${offeredValue.toFixed(1)}**\n\n`;

    response += `**YOU RECEIVE:**\n`;
    response += `🏈 **${requested.first_name} ${requested.last_name}**\n`;
    response += `${requested.position} | ${requested.team_name}\n`;
    response += `OVR: ${requested.overall_rating} | Age: ${requested.age} | Spd: ${requested.speed}\n`;
    response += `${devLabel(requested.dev_trait)}\n`;
    response += `💰 Trade Value: **${requestedValue.toFixed(1)}**\n\n`;

    response += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `**VERDICT:** ${fairness}\n`;
    response += `Value Gap: **${absDiff.toFixed(1)} points**\n`;
    response += `Winner: **${whoWins}**\n\n`;
    response += `💡 ${advice}\n\n`;
    response += `*Powered by AccessGrantedSportz Trade Engine*`;

    await interaction.editReply(response);

  } catch (error) {
    console.error('Tradecheck error:', error);
    await interaction.editReply('❌ Error analyzing trade.');
  }
};