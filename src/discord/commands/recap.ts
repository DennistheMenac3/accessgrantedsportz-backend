import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  ComponentType
} from 'discord.js';
import { query } from '../../config/database';
import { generatePostGameRecap } from '../../services/aiStorylineService';
import { postToChannel } from '../bot';
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
  .setName('recap')
  .setDescription('📰 Get detailed game recaps');

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

    // Step 1 — Show week selector
    const weeksResult = await query(
      `SELECT DISTINCT week
       FROM games
       WHERE league_id = $1
       AND season      = $2
       ORDER BY week DESC
       LIMIT 25`,
      [league.id, league.current_season]
    );

    if (weeksResult.rows.length === 0) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.NAVY)
          .setTitle('📰 Game Recap')
          .setDescription('No games found in your league yet.')]
      });
      return;
    }

    const weekOptions = weeksResult.rows.map((row: any) => ({
      label: `Week ${row.week}`,
      value: `week_${row.week}`,
      emoji: '📅'
    }));

    weekOptions.unshift({
      label: '📊 Full Season Summary',
      value: 'season_summary',
      emoji: '🏆'
    });

    const weekMenu = new StringSelectMenuBuilder()
      .setCustomId('select_week')
      .setPlaceholder('Select a week...')
      .addOptions(weekOptions);

    const weekRow = new ActionRowBuilder<StringSelectMenuBuilder>()
      .addComponents(weekMenu);

    await interaction.editReply({
      embeds: [createEmbed(COLORS.NAVY)
        .setTitle(`📰 Game Recap | ${league.name}`)
        .setDescription('Select a week to get started:')],
      components: [weekRow]
    });

    // Step 2 — Handle week selection
    const weekCollector = interaction.channel?.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time:          60000,
      filter:        i => i.user.id === interaction.user.id &&
                          i.customId === 'select_week'
    });

    weekCollector?.on('collect', async (weekInteraction: StringSelectMenuInteraction) => {
      await weekInteraction.deferUpdate();
      weekCollector.stop();

      const selectedValue = weekInteraction.values[0];

      // Handle full season summary
      if (selectedValue === 'season_summary') {
        await interaction.editReply({
          embeds: [createEmbed(COLORS.NAVY)
            .setTitle('⏳ Generating Season Summary...')
            .setDescription('This may take a moment.')],
          components: []
        });

        const allGamesResult = await query(
          `SELECT g.*,
            ht.name as home_team, ht.abbreviation as home_abbr,
            ht.wins as home_wins, ht.losses as home_losses,
            at.name as away_team, at.abbreviation as away_abbr,
            at.wins as away_wins, at.losses as away_losses
           FROM games g
           JOIN teams ht ON ht.id = g.home_team_id
           JOIN teams at ON at.id = g.away_team_id
           WHERE g.league_id = $1
           AND g.season      = $2
           ORDER BY g.week ASC`,
          [league.id, league.current_season]
        );

        // Group by week
        const weekGroups: { [key: number]: any[] } = {};
        allGamesResult.rows.forEach((game: any) => {
          if (!weekGroups[game.week]) weekGroups[game.week] = [];
          weekGroups[game.week].push(game);
        });

        const fields = Object.entries(weekGroups)
          .slice(0, 25)
          .map(([week, games]) => ({
            name:   `📅 Week ${week}`,
            value:  (games as any[]).map((game: any) => {
              const homeWon = game.home_score > game.away_score;
              return (
                `${homeWon ? '' : '🏆 '}**${game.away_abbr}** ` +
                `${game.away_score} - ${game.home_score} ` +
                `**${game.home_abbr}**${homeWon ? ' 🏆' : ''}`
              );
            }).join('\n'),
            inline: false
          }));

        const summaryEmbed = createEmbed(COLORS.GOLD)
          .setTitle(`🏆 Season ${league.current_season} Summary | ${league.name}`)
          .addFields(fields.slice(0, 10));

        await interaction.editReply({
          embeds:     [summaryEmbed],
          components: []
        });
        return;
      }

      // Step 3 — Show game selector
      const weekNum     = parseInt(selectedValue.replace('week_', ''));
      const gamesResult = await query(
        `SELECT g.*,
          ht.name as home_team, ht.abbreviation as home_abbr,
          ht.wins as home_wins, ht.losses as home_losses,
          at.name as away_team, at.abbreviation as away_abbr,
          at.wins as away_wins, at.losses as away_losses
         FROM games g
         JOIN teams ht ON ht.id = g.home_team_id
         JOIN teams at ON at.id = g.away_team_id
         WHERE g.league_id = $1
         AND g.season      = $2
         AND g.week        = $3
         ORDER BY g.home_score + g.away_score DESC`,
        [league.id, league.current_season, weekNum]
      );

      if (gamesResult.rows.length === 0) {
        await interaction.editReply({
          embeds: [createEmbed(COLORS.DANGER)
            .setTitle(`❌ No Games Found`)
            .setDescription(`No games found for Week ${weekNum}.`)],
          components: []
        });
        return;
      }

      const gameOptions = gamesResult.rows.map((game: any) => ({
        label:       `${game.away_abbr} ${game.away_score} - ${game.home_score} ${game.home_abbr}`,
        description: `${game.away_team} vs ${game.home_team}`,
        value:       game.id,
        emoji:       game.away_score > game.home_score ? '🏆' : '🏈'
      }));

      gameOptions.unshift({
        label:       `📊 All Week ${weekNum} Scores`,
        description: 'See all game scores for this week',
        value:       `week_scores_${weekNum}`,
        emoji:       '📅'
      });

      const gameMenu = new StringSelectMenuBuilder()
        .setCustomId('select_game')
        .setPlaceholder('Select a game...')
        .addOptions(gameOptions);

      const gameRow = new ActionRowBuilder<StringSelectMenuBuilder>()
        .addComponents(gameMenu);

      await interaction.editReply({
        embeds: [createEmbed(COLORS.NAVY)
          .setTitle(`📰 Week ${weekNum} Games | ${league.name}`)
          .setDescription('Select a game to recap:')],
        components: [gameRow]
      });

      // Step 4 — Handle game selection
      const gameCollector = interaction.channel?.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time:          60000,
        filter:        i => i.user.id === interaction.user.id &&
                            i.customId === 'select_game'
      });

      gameCollector?.on('collect', async (gameInteraction: StringSelectMenuInteraction) => {
        await gameInteraction.deferUpdate();
        gameCollector.stop();

        const selectedGameId = gameInteraction.values[0];

        // Week scores summary
        if (selectedGameId.startsWith('week_scores_')) {
          const fields = gamesResult.rows.map((game: any) => {
            const homeWon = game.home_score > game.away_score;
            const awayWon = game.away_score > game.home_score;
            return {
              name:
                `${awayWon ? '🏆 ' : ''}${game.away_abbr} ` +
                `${game.away_score} - ${game.home_score} ` +
                `${game.home_abbr}${homeWon ? ' 🏆' : ''}`,
              value:
                `${game.away_wins}-${game.away_losses} | ` +
                `${game.home_wins}-${game.home_losses}`,
              inline: true
            };
          });

          await interaction.editReply({
            embeds: [createEmbed(COLORS.NAVY)
              .setTitle(`🏈 Week ${weekNum} Scores | ${league.name}`)
              .setDescription(`Season ${league.current_season}`)
              .addFields(fields)],
            components: []
          });
          return;
        }

        // Step 5 — Generate AI recap
        const selectedGame = gamesResult.rows.find(
          (g: any) => g.id === selectedGameId
        );

        await interaction.editReply({
          embeds: [createEmbed(COLORS.NAVY)
            .setTitle('⏳ Generating Recap...')
            .setDescription(
              `${selectedGame?.away_team} vs ${selectedGame?.home_team}\n` +
              `This takes about 10 seconds...`
            )],
          components: []
        });

        try {
          const recap = await generatePostGameRecap(
            league.id,
            selectedGameId,
            league.current_season
          );

          const winner =
            selectedGame.home_score > selectedGame.away_score
              ? selectedGame.home_team
              : selectedGame.away_team;

          const recapEmbed = createEmbed(COLORS.NAVY)
            .setTitle('📰 Final Whistle | AccessGrantedSportz')
            .setDescription(
              `**${selectedGame.home_team} ${selectedGame.home_score}** — ` +
              `**${selectedGame.away_score} ${selectedGame.away_team}**\n` +
              `🏆 ${winner} wins | Week ${weekNum} | ` +
              `Season ${league.current_season}`
            )
            .addFields({
              name:  '📋 Game Recap',
              value: recap.slice(0, 1024),
              inline: false
            });

          await interaction.editReply({
            embeds:     [recapEmbed],
            components: []
          });

          // Post overflow if recap is long
          if (recap.length > 1024) {
            await postToChannel(
              interaction.channelId!,
              recap.slice(1024)
            );
          }

        } catch (recapError) {
          console.error('Recap generation error:', recapError);
          await interaction.editReply({
            embeds: [createEmbed(COLORS.DANGER)
              .setTitle('❌ Error')
              .setDescription('Error generating recap. Please try again.')],
            components: []
          });
        }
      });

      gameCollector?.on('end', async (collected) => {
        if (collected.size === 0) {
          await interaction.editReply({
            embeds: [createEmbed(COLORS.WARNING)
              .setTitle('⏰ Timed Out')
              .setDescription('Run /recap again to try.')],
            components: []
          });
        }
      });
    });

    weekCollector?.on('end', async (collected) => {
      if (collected.size === 0) {
        await interaction.editReply({
          embeds: [createEmbed(COLORS.WARNING)
            .setTitle('⏰ Timed Out')
            .setDescription('Run /recap again to try.')],
          components: []
        });
      }
    });

  } catch (error) {
    console.error('Recap error:', error);
    try {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('❌ Error')
          .setDescription('Error loading recap. Please try again.')],
        components: []
      });
    } catch {
      // Ignore
    }
  }
};