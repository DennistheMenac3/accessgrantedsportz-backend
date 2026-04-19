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
  .setName('scores')
  .setDescription('🏈 Get game scores for any week')
  .addIntegerOption(option =>
    option
      .setName('week')
      .setDescription('Week number (leave blank for latest week)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(22)
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

    let weekNum = interaction.options.getInteger('week');

    if (!weekNum) {
      const latestResult = await query(
        `SELECT MAX(week) as latest_week
         FROM games
         WHERE league_id = $1
         AND season      = $2`,
        [league.id, league.current_season]
      );
      weekNum = latestResult.rows[0]?.latest_week || 1;
    }

    const gamesResult = await query(
      `SELECT g.*,
        ht.name            as home_team,
        ht.abbreviation    as home_abbr,
        ht.wins            as home_wins,
        ht.losses          as home_losses,
        hu.username        as home_owner,
        hu.discord_user_id as home_discord_id,
        at.name            as away_team,
        at.abbreviation    as away_abbr,
        at.wins            as away_wins,
        at.losses          as away_losses,
        au.username        as away_owner,
        au.discord_user_id as away_discord_id
       FROM games g
       JOIN teams ht  ON ht.id = g.home_team_id
       JOIN teams at  ON at.id = g.away_team_id
       LEFT JOIN users hu ON hu.id = ht.owner_id
       LEFT JOIN users au ON au.id = at.owner_id
       WHERE g.league_id = $1
       AND g.season      = $2
       AND g.week        = $3
       ORDER BY g.home_score + g.away_score DESC`,
      [league.id, league.current_season, weekNum]
    );

    if (gamesResult.rows.length === 0) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.NAVY)
          .setTitle(`🏈 Week ${weekNum} Scores`)
          .setDescription(`No games found for Week ${weekNum}.`)]
      });
      return;
    }

    const fields = gamesResult.rows.map((game: any) => {
      const homeWon = game.home_score > game.away_score;
      const awayWon = game.away_score > game.home_score;
      const tie     = game.home_score === game.away_score;

      const awayTag = game.away_discord_id
        ? `<@${game.away_discord_id}>`
        : game.away_owner || null;

      const homeTag = game.home_discord_id
        ? `<@${game.home_discord_id}>`
        : game.home_owner || null;

      const showTags = awayTag && homeTag && awayTag !== homeTag;

      const score =
        `${awayWon ? '🏆 ' : ''}**${game.away_abbr}** ` +
        `(${game.away_wins}-${game.away_losses}) ` +
        `**${game.away_score}** - ` +
        `**${game.home_score}** ` +
        `**${game.home_abbr}** ` +
        `(${game.home_wins}-${game.home_losses})` +
        `${homeWon ? ' 🏆' : ''}` +
        `${tie ? ' 🤝' : ''}`;

      const owners = showTags
        ? `\n${awayTag} vs ${homeTag}`
        : '';

      return {
        name:   score,
        value:  owners || '​', // zero-width space if no owners
        inline: false
      };
    });

    const embed = createEmbed(COLORS.NAVY)
      .setTitle(`🏈 Week ${weekNum} Scores | ${league.name}`)
      .setDescription(`Season ${league.current_season}`)
      .addFields(fields)
      .setFooter({
        text: 'Use /recap for AI game recaps • AccessGrantedSportz'
      });

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('Scores error:', error);
    try {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('❌ Error')
          .setDescription('Error fetching scores. Please try again.')]
      });
    } catch {
      // Ignore
    }
  }
};