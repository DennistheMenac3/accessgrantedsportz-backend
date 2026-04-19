import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { query } from '../../config/database';
import { COLORS, createEmbed } from '../../config/brand';

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
  try {
    await interaction.deferReply();
  } catch {
    return;
  }

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

    const view = interaction.options.getString('view') || 'overall';

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

    if (result.rows.length === 0) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.NAVY)
          .setTitle('📊 Standings')
          .setDescription('No teams found in your league.')]
      });
      return;
    }

    const medal = (i: number) =>
      i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;

    let embed;

    if (view === 'division') {
      const divisions: { [key: string]: any[] } = {};
      result.rows.forEach((team: any) => {
        const div = team.division || '⚠️ Unassigned';
        if (!divisions[div]) divisions[div] = [];
        divisions[div].push(team);
      });

      const fields = Object.keys(divisions).sort().map(division => {
        const conf  = division.startsWith('AFC') ? '🔵' :
                      division.startsWith('NFC') ? '🔴' : '⚠️';
        const value = divisions[division].map((team: any, i: number) =>
          `${medal(i)} **${team.abbreviation}** ${team.wins}-${team.losses} ` +
          `| OVR: ${team.overall_rating}` +
          `${team.owner ? ` | ${team.owner}` : ''}`
        ).join('\n');

        return {
          name:   `${conf} ${division}`,
          value:  value || '—',
          inline: true
        };
      });

      embed = createEmbed(COLORS.NAVY)
        .setTitle(`🗺️ Division Standings | ${league.name}`)
        .setDescription(
          `Season ${league.current_season} | Week ${league.current_week}`
        )
        .addFields(fields.slice(0, 25));

    } else if (view === 'conference') {
      const conferences: { [key: string]: any[] } = {};
      result.rows.forEach((team: any) => {
        const conf = team.conference || 'Unassigned';
        if (!conferences[conf]) conferences[conf] = [];
        conferences[conf].push(team);
      });

      const fields = ['AFC', 'NFC', 'Unassigned']
        .filter(conf => conferences[conf])
        .map(conf => {
          const emoji = conf === 'AFC' ? '🔵' : conf === 'NFC' ? '🔴' : '⚠️';
          const value = conferences[conf]
            .sort((a: any, b: any) => b.wins - a.wins)
            .map((team: any, i: number) =>
              `${medal(i)} **${team.abbreviation}** ${team.wins}-${team.losses} ` +
              `| ${team.division || 'No Division'}`
            ).join('\n');

          return {
            name:   `${emoji} ${conf}`,
            value:  value || '—',
            inline: true
          };
        });

      embed = createEmbed(COLORS.NAVY)
        .setTitle(`🏟️ Conference Standings | ${league.name}`)
        .setDescription(
          `Season ${league.current_season} | Week ${league.current_week}`
        )
        .addFields(fields);

    } else {
      const sorted  = [...result.rows].sort(
        (a: any, b: any) => b.wins - a.wins
      );
      const fields  = sorted.slice(0, 25).map((team: any, i: number) => ({
        name:
          `${medal(i)} ${team.name} (${team.abbreviation})`,
        value:
          `${team.wins}-${team.losses} | ` +
          `OVR: ${team.overall_rating} | ` +
          `${team.division || 'No Division'}` +
          `${team.owner ? ` | ${team.owner}` : ''}`,
        inline: false
      }));

      embed = createEmbed(COLORS.NAVY)
        .setTitle(`📊 Overall Standings | ${league.name}`)
        .setDescription(
          `Season ${league.current_season} | Week ${league.current_week}`
        )
        .addFields(fields);
    }

    // Warn about unassigned teams
    const unassigned = result.rows.filter(
      (t: any) => !t.conference || !t.division
    );
    if (unassigned.length > 0) {
      embed.addFields({
        name:   `⚠️ ${unassigned.length} Team(s) Need Division Assignment`,
        value:  unassigned.map((t: any) => `• ${t.name} (${t.abbreviation})`).join('\n'),
        inline: false
      });
    }

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('Standings error:', error);
    try {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('❌ Error')
          .setDescription('Error fetching standings. Please try again.')]
      });
    } catch {
      // Ignore
    }
  }
};