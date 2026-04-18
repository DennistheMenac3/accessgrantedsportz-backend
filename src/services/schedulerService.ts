import cron from 'node-cron';
import { query } from '../config/database';
import {
  generatePowerRankings,
  generateTradeRumors,
  saveStoryline
} from './aiStorylineService';
import { postToChannel } from '../discord/bot';
import { splitMessage } from '../discord/bot';

// =============================================
// SCHEDULER SERVICE
// Runs automated tasks on a schedule
// Powers the "always alive" feeling of the bot
// =============================================

// =============================================
// HELPER — Get all active leagues with Discord
// Only leagues connected to Discord get posts
// =============================================
const getActiveDiscordLeagues = async (): Promise<any[]> => {
  const result = await query(
    `SELECT l.*,
      COALESCE(
        (SELECT MAX(g.season) FROM games g WHERE g.league_id = l.id),
        1
      ) as current_season,
      COALESCE(
        (SELECT MAX(g.week) FROM games g WHERE g.league_id = l.id),
        1
      ) as current_week
     FROM leagues l
     WHERE l.discord_guild_id IS NOT NULL
     AND l.discord_guild_id != ''
     AND l.discord_channel_id IS NOT NULL
     AND l.discord_channel_id != ''`
  );
  return result.rows;
};

// =============================================
// AUTO POST POWER RANKINGS
// Posts Hot Seat rankings to Discord
// =============================================
export const autoPostRankings = async (
  leagueId:  string,
  channelId: string,
  season:    number,
  week:      number
): Promise<void> => {
  try {
    console.log(`📊 Auto-posting rankings for league ${leagueId}...`);

    const result = await generatePowerRankings(
      leagueId,
      season,
      week,
      'stephen_a'
    );

    const header =
      `🔥 **THE HOT SEAT** | AccessGrantedSportz\n` +
      `Week ${week} Power Rankings\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    const chunks = splitMessage(header + result.rankings, 2000);
    for (const chunk of chunks) {
      await postToChannel(channelId, chunk);
    }

    console.log(`✅ Rankings posted for league ${leagueId}`);
  } catch (error) {
    console.error(`❌ Error auto-posting rankings:`, error);
  }
};

// =============================================
// AUTO POST TRADE RUMORS
// Posts Word on the Street to Discord
// =============================================
export const autoPostRumors = async (
  leagueId:         string,
  channelId:        string,
  season:           number,
  week:             number,
  weeksToDeadline?: number
): Promise<void> => {
  try {
    console.log(`📰 Auto-posting rumors for league ${leagueId}...`);

    const result = await generateTradeRumors(
      leagueId,
      season,
      week,
      weeksToDeadline
    );

    // Post rumors
    const rumorHeader =
      `📰 **WORD ON THE STREET** | AccessGrantedSportz\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    const rumorChunks = splitMessage(
      rumorHeader + result.rumors,
      2000
    );
    for (const chunk of rumorChunks) {
      await postToChannel(channelId, chunk);
    }

    // Post hot takes
    const takesHeader =
      `\n🔥 **HOT TAKES** | Word on the Street\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    const takesChunks = splitMessage(
      takesHeader + result.hot_takes,
      2000
    );
    for (const chunk of takesChunks) {
      await postToChannel(channelId, chunk);
    }

    // Post deadline report if generated
    if (result.deadline_report) {
      const deadlineHeader =
        `\n🚨 **TRADE DEADLINE ALERT** | Word on the Street\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      const deadlineChunks = splitMessage(
        deadlineHeader + result.deadline_report,
        2000
      );
      for (const chunk of deadlineChunks) {
        await postToChannel(channelId, chunk);
      }
    }

    console.log(`✅ Rumors posted for league ${leagueId}`);
  } catch (error) {
    console.error(`❌ Error auto-posting rumors:`, error);
  }
};

// =============================================
// AUTO POST GAME RECAP
// Called automatically when a game is submitted
// =============================================
export const autoPostGameRecap = async (
  leagueId:   string,
  gameId:     string,
  season:     number,
  channelId:  string
): Promise<void> => {
  try {
    console.log(`🏈 Auto-posting game recap...`);

    const { generatePostGameRecap } = await import('./aiStorylineService');

    // Get game info
    const gameResult = await query(
      `SELECT g.*,
        ht.name as home_team,
        at.name as away_team
       FROM games g
       LEFT JOIN teams ht ON ht.id = g.home_team_id
       LEFT JOIN teams at ON at.id = g.away_team_id
       WHERE g.id = $1`,
      [gameId]
    );

    if (gameResult.rows.length === 0) return;
    const game = gameResult.rows[0];

    const recap = await generatePostGameRecap(
      leagueId,
      gameId,
      season
    );

    const winner =
      game.home_score > game.away_score ? game.home_team :
      game.away_score > game.home_score ? game.away_team : 'TIE';

    const header =
      `📰 **FINAL WHISTLE** | AccessGrantedSportz\n` +
      `${game.home_team} **${game.home_score}** — ` +
      `${game.away_team} **${game.away_score}** | 🏆 ${winner}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    const chunks = splitMessage(header + recap, 2000);
    for (const chunk of chunks) {
      await postToChannel(channelId, chunk);
    }

    console.log(`✅ Game recap posted`);
  } catch (error) {
    console.error(`❌ Error auto-posting recap:`, error);
  }
};

// =============================================
// AUTO POST AWARD UPDATE
// Called when awards are calculated
// =============================================
export const autoPostAwardUpdate = async (
  leagueId:  string,
  channelId: string,
  season:    number
): Promise<void> => {
  try {
    const { getAwardLeaders } = await import('./awardsService');
    const awards = await getAwardLeaders(leagueId, season);

    if (awards.length === 0) return;

    const devEmoji = (dev: string) =>
      dev === 'xfactor'   ? '⚡' :
      dev === 'superstar' ? '⭐' :
      dev === 'star'      ? '🌟' : '';

    let message = `🏆 **AWARD LEADERS UPDATE** | AccessGrantedSportz\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Show top 5 most interesting awards
    const individual = awards.filter(
      (a: any) => a.category === 'individual'
    ).slice(0, 5);

    individual.forEach((award: any) => {
      if (award.first_name) {
        message +=
          `🏅 **${award.award_name}**\n` +
          `${award.first_name} ${award.last_name} ` +
          `${devEmoji(award.dev_trait || '')} ` +
          `(${award.team_abbreviation})\n\n`;
      }
    });

    message += `*Use /awards for full standings*\n`;
    message += `*Powered by AccessGrantedSportz*`;

    await postToChannel(channelId, message);

    console.log(`✅ Award update posted`);
  } catch (error) {
    console.error(`❌ Error auto-posting awards:`, error);
  }
};

// =============================================
// WEEKLY SCHEDULER
// Runs every Monday at 9am
// Posts rankings and rumors automatically
// =============================================
export const startScheduler = (): void => {
  console.log('⏰ Starting AccessGrantedSportz scheduler...');

  // Every Monday at 9:00 AM
  cron.schedule('0 9 * * 1', async () => {
    console.log('⏰ Monday morning scheduler running...');

    const leagues = await getActiveDiscordLeagues();

    if (leagues.length === 0) {
      console.log('No leagues with Discord connected — skipping');
      return;
    }

    for (const league of leagues) {
      // Calculate weeks to deadline
      // Assumes 18 week season with deadline at week 11
      const DEADLINE_WEEK  = 11;
      const weeksToDeadline = DEADLINE_WEEK - league.current_week;

      // Post power rankings
      await autoPostRankings(
        league.id,
        league.discord_channel_id,
        league.current_season,
        league.current_week
      );

      // Wait 5 seconds between posts
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Post trade rumors
      // Include deadline report if close to deadline
      await autoPostRumors(
        league.id,
        league.discord_channel_id,
        league.current_season,
        league.current_week,
        weeksToDeadline > 0 && weeksToDeadline <= 2
          ? weeksToDeadline
          : undefined
      );

      console.log(
        `✅ Weekly content posted for ${league.name}`
      );
    }
  }, {
    timezone: 'America/New_York'
  });

  // Every day at 12:00 PM — check for new games
  // and post recaps for any unrecapped games
  cron.schedule('0 12 * * *', async () => {
    console.log('⏰ Daily recap check running...');

    const leagues = await getActiveDiscordLeagues();

    for (const league of leagues) {
      // Find games from last 24 hours with no recap
     const unrecappedGames = await query(
  `SELECT g.id
   FROM games g
   WHERE g.league_id = $1
   AND g.season = $2
   AND g.week = (SELECT MAX(week) FROM games WHERE league_id = $1)
   AND NOT EXISTS (
     SELECT 1 FROM storylines s
     WHERE s.league_id = g.league_id
     AND s.storyline_type = 'game_recap'
     AND s.metadata->>'game_id' = g.id::text
   )`,
        [league.id, league.current_season]
      );

      for (const game of unrecappedGames.rows) {
        await autoPostGameRecap(
          league.id,
          game.id,
          league.current_season,
          league.discord_channel_id
        );

        // Wait 3 seconds between recaps
        await new Promise(
          resolve => setTimeout(resolve, 3000)
        );
      }
    }
  }, {
    timezone: 'America/New_York'
  });

  console.log('✅ Scheduler started!');
  console.log('   📅 Monday 9AM — Power rankings + Trade rumors');
  console.log('   📅 Daily 12PM — Game recap check');
};