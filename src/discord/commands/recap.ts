import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  ComponentType,
  EmbedBuilder
} from 'discord.js';
import { query } from '../../config/database';
import { generatePostGameRecap } from '../../services/aiStorylineService';
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

export const data = new SlashCommandBuilder()
  .setName('recap')
  .setDescription('📰 Get AI-generated game recaps');

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
      await interaction.editReply('❌ No league connected.');
      return;
    }

    // =============================================
    // Step 1 — Show week selector
    // =============================================
    const weeksResult = await query(
      `SELECT DISTINCT week 
       FROM games 
       WHERE league_id = $1 
       AND season = $2
       ORDER BY week DESC
       LIMIT 25`,
      [league.id, league.current_season]
    );

    if (weeksResult.rows.length === 0) {
      await interaction.editReply('❌ No games found in your league.');
      return;
    }

    const weekOptions = weeksResult.rows.map((row: any) => ({
      label: `Week ${row.week}`,
      value: `week_${row.week}`,
      emoji: '📅'
    }));

    // Add full season option
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
      content: `📰 **GAME RECAP** | ${league.name}\nSelect a week to get started:`,
      components: [weekRow]
    });

    // =============================================
    // Step 2 — Handle week selection
    // =============================================
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
          content: '⏳ Generating full season summary... This may take a moment.',
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
           AND g.season = $2
           ORDER BY g.week ASC`,
          [league.id, league.current_season]
        );

        let summary = `🏆 **SEASON ${league.current_season} SUMMARY** | ${league.name}\n`;
        summary += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        let currentWeek = 0;
        allGamesResult.rows.forEach((game: any) => {
          if (game.week !== currentWeek) {
            currentWeek = game.week;
            summary += `**📅 Week ${game.week}**\n`;
          }
          const homeWon = game.home_score > game.away_score;
          summary +=
            `${game.away_abbr} **${game.away_score}** - ` +
            `**${game.home_score}** ${game.home_abbr} ` +
            `${homeWon ? '🏆' : ''}\n`;
        });

        summary += `\n*Use /recap to get AI recaps for individual games*\n`;
        summary += `*Powered by AccessGrantedSportz*`;

        const chunks = splitMessage(summary, 2000);
        await interaction.editReply({ content: chunks[0], components: [] });
        for (let i = 1; i < chunks.length; i++) {
          await postToChannel(interaction.channelId!, chunks[i]);
        }
        return;
      }

      // Get week number
      const weekNum = parseInt(selectedValue.replace('week_', ''));

      // =============================================
      // Step 3 — Show game selector for that week
      // =============================================
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
         AND g.season = $2
         AND g.week = $3
         ORDER BY g.home_score + g.away_score DESC`,
        [league.id, league.current_season, weekNum]
      );

      if (gamesResult.rows.length === 0) {
        await interaction.editReply({
          content: `❌ No games found for Week ${weekNum}.`,
          components: []
        });
        return;
      }

      const gameOptions = gamesResult.rows.map((game: any) => ({
        label: `${game.away_abbr} ${game.away_score} - ${game.home_score} ${game.home_abbr}`,
        description: `${game.away_team} vs ${game.home_team}`,
        value: game.id,
        emoji: game.away_score > game.home_score ? '🏆' : '🏈'
      }));

      // Add full week option
      gameOptions.unshift({
        label: `📊 All Week ${weekNum} Scores`,
        description: 'See all game scores for this week',
        value: `week_scores_${weekNum}`,
        emoji: '📅'
      });

      const gameMenu = new StringSelectMenuBuilder()
        .setCustomId('select_game')
        .setPlaceholder('Select a game...')
        .addOptions(gameOptions);

      const gameRow = new ActionRowBuilder<StringSelectMenuBuilder>()
        .addComponents(gameMenu);

      await interaction.editReply({
        content:
          `📰 **Week ${weekNum} Games** | ${league.name}\n` +
          `Select a game for the AI recap:`,
        components: [gameRow]
      });

      // =============================================
      // Step 4 — Handle game selection
      // =============================================
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

        // Handle week scores summary
        if (selectedGameId.startsWith('week_scores_')) {
          let scoreMsg = `🏈 **Week ${weekNum} Scores** | ${league.name}\n`;
          scoreMsg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

          gamesResult.rows.forEach((game: any) => {
            const homeWon = game.home_score > game.away_score;
            const awayWon = game.away_score > game.home_score;
            scoreMsg +=
              `${awayWon ? '🏆 ' : ''}**${game.away_abbr}** ` +
              `(${game.away_wins}-${game.away_losses}) ` +
              `**${game.away_score}** - ` +
              `**${game.home_score}** ` +
              `**${game.home_abbr}** ` +
              `(${game.home_wins}-${game.home_losses})` +
              `${homeWon ? ' 🏆' : ''}\n\n`;
          });

          scoreMsg += `*Use /recap again to get an AI recap for a specific game*\n`;
          scoreMsg += `*Powered by AccessGrantedSportz*`;

          await interaction.editReply({ content: scoreMsg, components: [] });
          return;
        }

        // =============================================
        // Step 5 — Generate AI recap for selected game
        // =============================================
        const selectedGame = gamesResult.rows.find(
          (g: any) => g.id === selectedGameId
        );

        await interaction.editReply({
          content:
            `⏳ **Generating AI recap...**\n` +
            `${selectedGame?.away_team} vs ${selectedGame?.home_team}\n` +
            `This takes about 10 seconds...`,
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

          const header =
            `📰 **FINAL WHISTLE** | AccessGrantedSportz\n` +
            `${selectedGame.home_team} **${selectedGame.home_score}** — ` +
            `${selectedGame.away_team} **${selectedGame.away_score}** | 🏆 ${winner}\n` +
            `Week ${weekNum} | Season ${league.current_season}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

          const fullRecap = header + recap;
          const chunks   = splitMessage(fullRecap, 2000);

          await interaction.editReply({
            content:    chunks[0],
            components: []
          });

          for (let i = 1; i < chunks.length; i++) {
            await postToChannel(interaction.channelId!, chunks[i]);
          }

        } catch (recapError) {
          console.error('Recap generation error:', recapError);
          await interaction.editReply({
            content:    '❌ Error generating recap. Please try again.',
            components: []
          });
        }
      });

      gameCollector?.on('end', async (collected) => {
        if (collected.size === 0) {
          await interaction.editReply({
            content:    '⏰ Timed out. Run /recap again.',
            components: []
          });
        }
      });
    });

    weekCollector?.on('end', async (collected) => {
      if (collected.size === 0) {
        await interaction.editReply({
          content:    '⏰ Timed out. Run /recap again.',
          components: []
        });
      }
    });

  } catch (error) {
    console.error('Recap error:', error);
    try {
      await interaction.editReply({
        content:    '❌ Error loading recap.',
        components: []
      });
    } catch {
      // Ignore
    }
  }
};