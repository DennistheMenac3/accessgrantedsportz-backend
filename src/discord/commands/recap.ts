import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { query } from '../../config/database';
import { generatePostGameRecap } from '../../services/aiStorylineService';
import { splitMessage } from '../bot';

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
  .setDescription('📰 Get AI written game recaps for the week')
  .addIntegerOption(option =>
    option
      .setName('week')
      .setDescription('Which week to recap (defaults to latest week)')
      .setRequired(false)
  )
  .addIntegerOption(option =>
    option
      .setName('game')
      .setDescription('Specific game number only (leave blank for all games)')
      .setRequired(false)
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

    const week       = interaction.options.getInteger('week') || league.current_week;
    const gameNumber = interaction.options.getInteger('game') || null;

    // Get all games from that week
    const gamesResult = await query(
      `SELECT g.*,
        ht.name as home_team,
        ht.abbreviation as home_abbr,
        at.name as away_team,
        at.abbreviation as away_abbr
       FROM games g
       LEFT JOIN teams ht ON ht.id = g.home_team_id
       LEFT JOIN teams at ON at.id = g.away_team_id
       WHERE g.league_id = $1
       AND g.season = $2
       AND g.week = $3
       ORDER BY g.created_at ASC`,
      [league.id, league.current_season, week]
    );

    if (gamesResult.rows.length === 0) {
      await interaction.editReply(
        `❌ No games found for Week ${week} Season ${league.current_season}.`
      );
      return;
    }

    // If specific game number requested
    if (gameNumber) {
      const game = gamesResult.rows[gameNumber - 1];
      if (!game) {
        await interaction.editReply(
          `❌ Game #${gameNumber} not found. ` +
          `There are only ${gamesResult.rows.length} games this week.`
        );
        return;
      }
      await interaction.editReply(
        `📰 Writing recap for **${game.home_team} vs ${game.away_team}**...`
      );
      await sendRecap(interaction, league, game, week);
      return;
    }

    // No specific game — recap ALL games this week
    const gameCount = gamesResult.rows.length;

    await interaction.editReply(
      `📰 Writing recaps for all **${gameCount} game${gameCount > 1 ? 's' : ''}** ` +
      `from Week ${week}... This may take a moment.`
    );

    // Post a header for the week
    let weekHeader = `🏈 **WEEK ${week} RECAP REPORT** | AccessGrantedSportz\n`;
    weekHeader += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    weekHeader += `Season ${league.current_season} | ${gameCount} Game${gameCount > 1 ? 's' : ''}\n\n`;

    // Add scoreboard
    gamesResult.rows.forEach((g: any, i: number) => {
      const winner =
        g.home_score > g.away_score ? g.home_abbr :
        g.away_score > g.home_score ? g.away_abbr : 'TIE';
      weekHeader += `🏆 ${g.home_team} **${g.home_score}** — ${g.away_team} **${g.away_score}** *(${winner} wins)*\n`;
    });

    await interaction.followUp(weekHeader);

    // Generate recap for each game
    for (let i = 0; i < gamesResult.rows.length; i++) {
      const game = gamesResult.rows[i];

      // Post divider between games
      if (gamesResult.rows.length > 1) {
        await interaction.followUp(
          `\n📝 **GAME ${i + 1} OF ${gameCount}** | ` +
          `${game.home_team} vs ${game.away_team}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━`
        );
      }

      // Generate the AI recap
      const recap = await generatePostGameRecap(
        league.id,
        game.id,
        league.current_season
      );

      const winner =
        game.home_score > game.away_score ? game.home_team :
        game.away_score > game.home_score ? game.away_team : 'TIE';

      const header =
        `📰 **FINAL WHISTLE** | Week ${week}\n` +
        `${game.home_team} **${game.home_score}** — ` +
        `${game.away_team} **${game.away_score}** | 🏆 ${winner}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      const chunks = splitMessage(header + recap, 2000);
      for (const chunk of chunks) {
        await interaction.followUp(chunk);
      }
    }

    // Final footer
    await interaction.followUp(
      `\n✅ **Week ${week} recaps complete!**\n` +
      `*Powered by AccessGrantedSportz AI*`
    );

  } catch (error) {
    console.error('Recap command error:', error);
    await interaction.editReply('❌ Error generating recap.');
  }
};

// =============================================
// Helper — Generate and send a single recap
// =============================================
const sendRecap = async (
  interaction: ChatInputCommandInteraction,
  league:      any,
  game:        any,
  week:        number
): Promise<void> => {
  const recap = await generatePostGameRecap(
    league.id,
    game.id,
    league.current_season
  );

  const winner =
    game.home_score > game.away_score ? game.home_team :
    game.away_score > game.home_score ? game.away_team : 'TIE';

  const header =
    `📰 **FINAL WHISTLE** | AccessGrantedSportz\n` +
    `Week ${week} | ${game.home_team} **${game.home_score}** — ` +
    `${game.away_team} **${game.away_score}** | 🏆 ${winner}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const chunks = splitMessage(header + recap, 2000);
  await interaction.editReply(chunks[0]);
  for (let i = 1; i < chunks.length; i++) {
    await interaction.followUp(chunks[i]);
  }
};