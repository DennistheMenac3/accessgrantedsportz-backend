import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { query } from '../../config/database';

const leagueCache = new Map<string, any>();

const getLeagueForServer = async (guildId: string): Promise<any | null> => {
  if (leagueCache.has(guildId)) return leagueCache.get(guildId);

  const result = await query(
    `SELECT l.*,
      COALESCE((SELECT MAX(g.season) FROM games g WHERE g.league_id = l.id), 1) as current_season,
      COALESCE((SELECT MAX(g.week)   FROM games g WHERE g.league_id = l.id), 1) as current_week
     FROM leagues l
     WHERE l.discord_guild_id = $1
     LIMIT 1`,
    [guildId]
  );

  const league = result.rows[0] || null;
  if (league) {
    leagueCache.set(guildId, league);
    setTimeout(() => leagueCache.delete(guildId), 5 * 60 * 1000);
  }
  return league;
};

export const data = new SlashCommandBuilder()
  .setName('standings')
  .setDescription('📊 Get the current league standings')
  .addStringOption(option =>
    option
      .setName('view')
      .setDescription('How to display standings')
      .setRequired(false)
      .addChoices(
        { name: '🏈 Overall',       value: 'overall'    },
        { name: '🗺️ By Division',   value: 'division'   },
        { name: '🏟️ By Conference', value: 'conference' }
      )
  );

export const execute = async (
  interaction: ChatInputCommandInteraction
) => {
  console.log('🏈 Standings command triggered');

  try {
    await interaction.deferReply();
    console.log('✅ deferReply successful');
  } catch {
    console.log('❌ deferReply failed — interaction expired');
    return;
  }

  try {
    console.log('🔍 Getting league for server:', interaction.guildId);
    const league = await getLeagueForServer(interaction.guildId!);
    console.log('League found:', league?.name || 'NULL');

    if (!league) {
      await interaction.editReply('❌ No league connected.');
      return;
    }

    const view = interaction.options.getString('view') || 'overall';
    console.log('View:', view);

    const result = await query(
      `SELECT
        t.name, t.abbreviation,
        t.wins, t.losses,
        t.overall_rating,
        t.conference, t.division,
        u.username as owner,
        CASE
          WHEN (t.wins + t.losses) = 0 THEN 0
          ELSE ROUND(t.wins::decimal / (t.wins + t.losses) * 100, 1)
        END as win_pct
       FROM teams t
       LEFT JOIN users u ON u.id = t.owner_id
       WHERE t.league_id = $1
       ORDER BY t.conference, t.division, t.wins DESC`,
      [league.id]
    );

    console.log('Teams found:', result.rows.length);

    if (result.rows.length === 0) {
      await interaction.editReply('No teams found in your league.');
      return;
    }

    let response = '';

    if (view === 'division') {
      const divisions: { [key: string]: any[] } = {};
      result.rows.forEach((team: any) => {
        const div = team.division || '⚠️ Unassigned';
        if (!divisions[div]) divisions[div] = [];
        divisions[div].push(team);
      });

      response  = `📊 **DIVISION STANDINGS** | ${league.name}\n`;
      response += `Season ${league.current_season} | Week ${league.current_week}\n`;
      response += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      Object.keys(divisions).sort().forEach(division => {
        const conf = division.startsWith('AFC') ? '🔵' :
                     division.startsWith('NFC') ? '🔴' : '⚠️';
        response += `${conf} **${division}**\n`;
        divisions[division].forEach((team: any, i: number) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
          response +=
            `${medal} **${team.abbreviation}** ${team.wins}-${team.losses}` +
            ` | OVR: ${team.overall_rating}` +
            `${team.owner ? ` | ${team.owner}` : ''}\n`;
        });
        response += '\n';
      });

    } else if (view === 'conference') {
      const conferences: { [key: string]: any[] } = {};
      result.rows.forEach((team: any) => {
        const conf = team.conference || 'Unassigned';
        if (!conferences[conf]) conferences[conf] = [];
        conferences[conf].push(team);
      });

      response  = `🏟️ **CONFERENCE STANDINGS** | ${league.name}\n`;
      response += `Season ${league.current_season} | Week ${league.current_week}\n`;
      response += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      for (const conf of ['AFC', 'NFC', 'Unassigned']) {
        if (!conferences[conf]) continue;
        const emoji = conf === 'AFC' ? '🔵' : conf === 'NFC' ? '🔴' : '⚠️';
        response += `${emoji} **${conf}**\n`;
        conferences[conf]
          .sort((a: any, b: any) => b.wins - a.wins)
          .forEach((team: any, i: number) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
            response +=
              `${medal} **${team.abbreviation}** ${team.wins}-${team.losses}` +
              ` | ${team.division || 'No Division'}\n`;
          });
        response += '\n';
      }

    } else {
      response  = `📊 **OVERALL STANDINGS** | ${league.name}\n`;
      response += `Season ${league.current_season} | Week ${league.current_week}\n`;
      response += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      [...result.rows]
        .sort((a: any, b: any) => b.wins - a.wins)
        .forEach((team: any, i: number) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
          response +=
            `${medal} **${team.name}** (${team.abbreviation})\n` +
            `   ${team.wins}-${team.losses}` +
            ` | OVR: ${team.overall_rating}` +
            ` | ${team.division || 'No Division'}` +
            `${team.owner ? ` | ${team.owner}` : ''}\n\n`;
        });
    }

    const unassigned = result.rows.filter(
      (t: any) => !t.conference || !t.division
    );
    if (unassigned.length > 0) {
      response += `⚠️ **${unassigned.length} team(s) need division assignment:**\n`;
      unassigned.forEach((t: any) => {
        response += `   • ${t.name} (${t.abbreviation})\n`;
      });
    }

    response += `\n*Powered by AccessGrantedSportz*`;

    console.log('✅ Sending response...');
    await interaction.editReply(response);
    console.log('✅ Response sent!');

  } catch (error) {
    console.error('❌ Standings error:', error);
    try {
      await interaction.editReply('❌ Error fetching standings.');
    } catch {
      // Ignore
    }
  }
};