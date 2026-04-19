import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { query } from '../../config/database';
import { generateTradeAdvice } from '../../services/aiStorylineService';
import { splitMessage, postToChannel } from '../bot';

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

const findPlayer = async (
  name:     string,
  leagueId: string
): Promise<any | null> => {
  const result = await query(
    `SELECT
      p.id, p.first_name, p.last_name,
      p.position, p.overall_rating,
      p.dev_trait, p.age, p.speed,
      p.team_id,
      t.name         as team_name,
      t.abbreviation as team_abbr,
      t.wins, t.losses,
      COALESCE(tvh.total_value, 0) as trade_value
     FROM players p
     LEFT JOIN teams t ON t.id = p.team_id
     LEFT JOIN trade_value_history tvh
       ON tvh.player_id  = p.id
       AND tvh.league_id = p.league_id
     WHERE p.league_id = $1
     AND (
       LOWER(p.first_name || ' ' || p.last_name) LIKE LOWER('%' || $2 || '%')
       OR LOWER(p.first_name) LIKE LOWER('%' || $2 || '%')
       OR LOWER(p.last_name)  LIKE LOWER('%' || $2 || '%')
     )
     ORDER BY tvh.calculated_at DESC
     LIMIT 1`,
    [leagueId, name]
  );
  return result.rows[0] || null;
};

export const data = new SlashCommandBuilder()
  .setName('tradecheck')
  .setDescription('⚖️ AI-powered trade analysis with full roster context')
  .addStringOption(option =>
    option
      .setName('offering')
      .setDescription('Player you are offering')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('requesting')
      .setDescription('Player you want in return')
      .setRequired(true)
  );

export const execute = async (
  interaction: ChatInputCommandInteraction
) => {
  try {
    await interaction.deferReply();
  } catch {
    return;
  }

  try {
    console.log('🔍 Tradecheck called by:', interaction.user.username);

    const league = await getLeagueForServer(interaction.guildId!);
    if (!league) {
      await interaction.editReply('❌ No league connected.');
      return;
    }

    const offeringName   = interaction.options.getString('offering',   true);
    const requestingName = interaction.options.getString('requesting', true);

    console.log('🔍 Offering:', offeringName);
    console.log('🔍 Requesting:', requestingName);

    const [offered, requested] = await Promise.all([
      findPlayer(offeringName,   league.id),
      findPlayer(requestingName, league.id)
    ]);

    if (!offered) {
      await interaction.editReply(`❌ Player "${offeringName}" not found.`);
      return;
    }
    if (!requested) {
      await interaction.editReply(`❌ Player "${requestingName}" not found.`);
      return;
    }

    console.log('✅ Players found:', offered.first_name, 'vs', requested.first_name);

    const devLabel = (dev: string) =>
      dev === 'xfactor'   ? '⚡ XFactor'  :
      dev === 'superstar' ? '⭐ Superstar' :
      dev === 'star'      ? '🌟 Star'      : '📋 Normal';

    // Show loading message
    await interaction.editReply(
      `⏳ **AI analyzing trade...**\n` +
      `${offered.first_name} ${offered.last_name} ↔️ ` +
      `${requested.first_name} ${requested.last_name}\n` +
      `Checking rosters, needs, draft capital... (~15 seconds)`
    );

    console.log('🔍 Calling generateTradeAdvice...');

    // Get AI trade advice with full roster context
    const advice = await generateTradeAdvice(
      [offered.id],
      [requested.id],
      league.id,
      league.current_season
    );

    console.log('✅ AI advice received:', advice.verdict);

    const offeredValue   = parseFloat(offered.trade_value  || '0');
    const requestedValue = parseFloat(requested.trade_value || '0');
    const difference     = offeredValue - requestedValue;
    const absDiff        = Math.abs(difference);

    let response = `⚖️ **TRADE ANALYSIS** | AccessGrantedSportz\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    response += `**YOU OFFER:**\n`;
    response += `🏈 **${offered.first_name} ${offered.last_name}**\n`;
    response += `${offered.position} | ${offered.team_name} `;
    response += `(${offered.wins}-${offered.losses})\n`;
    response += `OVR: ${offered.overall_rating} | Age: ${offered.age} | `;
    response += `Spd: ${offered.speed} | ${devLabel(offered.dev_trait)}\n`;
    response += `💰 TVS: **${offeredValue.toFixed(1)}**\n\n`;

    response += `**YOU RECEIVE:**\n`;
    response += `🏈 **${requested.first_name} ${requested.last_name}**\n`;
    response += `${requested.position} | ${requested.team_name} `;
    response += `(${requested.wins}-${requested.losses})\n`;
    response += `OVR: ${requested.overall_rating} | Age: ${requested.age} | `;
    response += `Spd: ${requested.speed} | ${devLabel(requested.dev_trait)}\n`;
    response += `💰 TVS: **${requestedValue.toFixed(1)}**\n\n`;

    response += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `**VERDICT:** ${advice.verdict}\n`;
    response += `**Value Gap:** ${absDiff.toFixed(1)} points\n`;
    response += `**Winner:** ${advice.winner}\n\n`;

    response += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `🤖 **AI TRADE ADVISOR:**\n\n`;
    response += advice.advice;
    response += `\n\n*Powered by AccessGrantedSportz Trade Engine*`;

    const chunks = splitMessage(response, 2000);
    await interaction.editReply(chunks[0]);

    for (let i = 1; i < chunks.length; i++) {
      await postToChannel(interaction.channelId!, chunks[i]);
    }

  } catch (error) {
    console.error('❌ Tradecheck error:', error);
    try {
      await interaction.editReply('❌ Error analyzing trade. Please try again.');
    } catch {
      // Ignore
    }
  }
};