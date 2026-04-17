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
  .setName('compare')
  .setDescription('⚔️ Compare two players side by side')
  .addStringOption(option =>
    option
      .setName('player1')
      .setDescription('First player (first last)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('player2')
      .setDescription('Second player (first last)')
      .setRequired(true)
  );

export const execute = async (
  interaction: ChatInputCommandInteraction
) => {
  console.log('⚡ Compare command received!'); // ADD THIS
  await interaction.deferReply();

  try {
    const league = await getLeagueForServer(interaction.guildId!);
    if (!league) {
      await interaction.editReply('❌ No league connected.');
      return;
    }

    const name1 = interaction.options.getString('player1', true);
    const name2 = interaction.options.getString('player2', true);

    const findPlayer = async (name: string) => {
      const result = await query(
        `SELECT
          p.id, p.first_name, p.last_name,
          p.position, p.overall_rating,
          p.dev_trait, p.age, p.speed,
          t.name as team_name,
          t.wins, t.losses,
          COALESCE(tvh.total_value, 0) as trade_value
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
        [league.id, name]
      );
      return result.rows[0] || null;
    };

    const [p1, p2] = await Promise.all([
      findPlayer(name1),
      findPlayer(name2)
    ]);

    if (!p1) {
      await interaction.editReply(`❌ Player "${name1}" not found.`);
      return;
    }
    if (!p2) {
      await interaction.editReply(`❌ Player "${name2}" not found.`);
      return;
    }

    const v1   = parseFloat(p1.trade_value);
    const v2   = parseFloat(p2.trade_value);
    const diff = Math.abs(v1 - v2);

    const fairness =
      diff <= 10  ? '✅ EVEN'            :
      diff <= 25  ? '🟡 SLIGHT EDGE'     :
      diff <= 50  ? '🟠 CLEAR ADVANTAGE' :
      diff <= 100 ? '🔴 LOPSIDED'        :
      '🚨 HIGHWAY ROBBERY';

    const devLabel = (dev: string) =>
      dev === 'xfactor'   ? '⚡ XFactor'  :
      dev === 'superstar' ? '⭐ Superstar' :
      dev === 'star'      ? '🌟 Star'      : '📋 Normal';

    const winner = v1 >= v2 ? p1 : p2;

    let response = `⚔️ **PLAYER COMPARISON** | AccessGrantedSportz\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    response += `**${p1.first_name} ${p1.last_name}**\n`;
    response += `${p1.position} | ${p1.team_name} (${p1.wins}-${p1.losses})\n`;
    response += `OVR: ${p1.overall_rating} | Age: ${p1.age} | Spd: ${p1.speed}\n`;
    response += `${devLabel(p1.dev_trait)}\n`;
    response += `💰 TVS: **${v1.toFixed(1)}**\n\n`;

    response += `**${p2.first_name} ${p2.last_name}**\n`;
    response += `${p2.position} | ${p2.team_name} (${p2.wins}-${p2.losses})\n`;
    response += `OVR: ${p2.overall_rating} | Age: ${p2.age} | Spd: ${p2.speed}\n`;
    response += `${devLabel(p2.dev_trait)}\n`;
    response += `💰 TVS: **${v2.toFixed(1)}**\n\n`;

    response += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `**VERDICT:** ${fairness}\n`;
    response += `**${winner.first_name} ${winner.last_name}** `;
    response += `leads by **${diff.toFixed(1)}** value points\n\n`;
    response += `*Powered by AccessGrantedSportz*`;

    await interaction.editReply(response);

  } catch (error) {
    console.error('Compare error:', error);
    await interaction.editReply('❌ Error comparing players.');
  }
};