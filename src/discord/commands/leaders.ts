import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { query } from '../../config/database';
import { getLeagueForServer } from '../helpers';
import { COLORS, createEmbed } from '../../config/brand';

export const data = new SlashCommandBuilder()
  .setName('leaders')
  .setDescription('📊 View stat leaders for the current season')
  .addStringOption(option =>
    option
      .setName('stat')
      .setDescription('Which stat to show')
      .setRequired(true)
      .addChoices(
        { name: '🏈 Passing Yards',   value: 'pass_yards' },
        { name: '🏃 Rushing Yards',   value: 'rush_yards' },
        { name: '🙌 Receiving Yards', value: 'receiving_yards' },
        { name: '💨 Sacks',           value: 'sacks' },
        { name: '🎯 Interceptions',   value: 'interceptions' },
        { name: '🏆 Touchdowns',      value: 'touchdowns' },
        { name: '🤜 Tackles',         value: 'tackles' }
      )
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

    const stat = interaction.options.getString('stat', true);

    let statLabel  = '';
    let selectStat = '';
    let positions  = '';
    let emoji      = '';

    switch (stat) {
      case 'pass_yards':
        statLabel  = 'Passing Yards';
        selectStat = 'SUM(gs.pass_yards) as stat_total';
        positions  = `AND p.position = 'QB'`;
        emoji      = '🏈';
        break;
      case 'rush_yards':
        statLabel  = 'Rushing Yards';
        selectStat = 'SUM(gs.rush_yards) as stat_total';
        positions  = `AND p.position IN ('QB','RB','WR')`;
        emoji      = '🏃';
        break;
      case 'receiving_yards':
        statLabel  = 'Receiving Yards';
        selectStat = 'SUM(gs.receiving_yards) as stat_total';
        positions  = `AND p.position IN ('WR','TE','RB')`;
        emoji      = '🙌';
        break;
      case 'sacks':
        statLabel  = 'Sacks';
        selectStat = 'SUM(gs.sacks) as stat_total';
        positions  = `AND p.position IN ('DL','LB')`;
        emoji      = '💨';
        break;
      case 'interceptions':
        statLabel  = 'Interceptions';
        selectStat = 'SUM(gs.interceptions) as stat_total';
        positions  = `AND p.position IN ('CB','S','LB')`;
        emoji      = '🎯';
        break;
      case 'touchdowns':
        statLabel  = 'Total Touchdowns';
        selectStat =
          `SUM(gs.pass_touchdowns + gs.rush_touchdowns + ` +
          `gs.receiving_touchdowns) as stat_total`;
        positions  = '';
        emoji      = '🏆';
        break;
      case 'tackles':
        statLabel  = 'Tackles';
        selectStat = 'SUM(gs.tackles) as stat_total';
        positions  = `AND p.position IN ('DL','LB','CB','S')`;
        emoji      = '🤜';
        break;
    }

    const result = await query(
      `SELECT
        p.first_name, p.last_name,
        p.position, p.overall_rating,
        p.dev_trait,
        t.name         as team_name,
        t.abbreviation,
        ${selectStat},
        COUNT(DISTINCT gs.game_id) as games_played
       FROM game_stats gs
       JOIN games g  ON g.id  = gs.game_id
       JOIN players p ON p.id = gs.player_id
       JOIN teams t   ON t.id = p.team_id
       WHERE g.league_id = $1
       AND g.season      = $2
       ${positions}
       GROUP BY
         p.first_name, p.last_name,
         p.position, p.overall_rating,
         p.dev_trait,
         t.name, t.abbreviation
       HAVING SUM(gs.pass_yards) + SUM(gs.rush_yards) +
         SUM(gs.receiving_yards) > 0
       ORDER BY stat_total DESC
       LIMIT 10`,
      [league.id, league.current_season]
    );

    if (result.rows.length === 0) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.NAVY)
          .setTitle(`${emoji} ${statLabel} Leaders`)
          .setDescription(
            `No data found for Season ${league.current_season}.`
          )]
      });
      return;
    }

    const devEmoji = (dev: string) =>
      dev === 'xfactor'   ? '⚡' :
      dev === 'superstar' ? '⭐' :
      dev === 'star'      ? '🌟' : '';

    const fields = result.rows.map((p: any, i: number) => {
      const medal =
        i === 0 ? '🥇' :
        i === 1 ? '🥈' :
        i === 2 ? '🥉' :
        `**${i + 1}.**`;

      const statValue = parseFloat(p.stat_total).toFixed(
        stat === 'sacks' ? 1 : 0
      );

      return {
        name:
          `${medal} ${p.first_name} ${p.last_name} ` +
          `${devEmoji(p.dev_trait)}`,
        value:
          `${p.position} | ${p.team_name}\n` +
          `**${statValue}** ${statLabel} | ${p.games_played} games`,
        inline: true
      };
    });

    const embed = createEmbed(COLORS.NAVY)
      .setTitle(`${emoji} ${statLabel} Leaders | ${league.name}`)
      .setDescription(`Season ${league.current_season}`)
      .addFields(fields);

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('Leaders command error:', error);
    await interaction.editReply({
      embeds: [createEmbed(COLORS.DANGER)
        .setTitle('❌ Error')
        .setDescription('Error fetching leaders. Please try again.')]
    });
  }
};