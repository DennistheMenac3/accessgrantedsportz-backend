import { Router } from 'express';
import { query } from '../config/database';
import {
  ingestTeams,
  ingestPlayers,
  ingestGames
} from '../services/maddenIngestionService';
import {
  autoPostGameRecap,
  autoPostAwardUpdate,
  autoPostRankings
} from '../services/schedulerService';
import { calculateAllAwards } from '../services/awardsService';

const router = Router();

// =============================================
// VALIDATE API KEY MIDDLEWARE
// All Madden export routes use this
// =============================================
const validateApiKey = async (
  req: any,
  res: any,
  next: any
): Promise<void> => {
  const leagueId = req.params.leagueId;
  const apiKey   = req.query.key as string;

  if (!apiKey) {
    res.status(401).json({
      success: false,
      message: 'API key required. Add ?key=YOUR_KEY to URL'
    });
    return;
  }

  const result = await query(
    `SELECT * FROM leagues WHERE id = $1 AND api_key = $2`,
    [leagueId, apiKey]
  );

  if (result.rows.length === 0) {
    res.status(401).json({
      success: false,
      message: 'Invalid league ID or API key'
    });
    return;
  }

  req.league = result.rows[0];
  next();
};

// =============================================
// LEAGUE INFO EXPORT
// POST /api/ingest/madden/:leagueId/leagueinfo
// Receives: league settings + all 32 teams
// =============================================
router.post(
  '/madden/:leagueId/leagueinfo',
  validateApiKey,
  async (req: any, res: any) => {
    try {
      const leagueId = req.params.leagueId;
      const data     = req.body;

      console.log(`📥 League info export received for ${req.league.name}`);

      // Madden sends teams in leagueTeamInfoList
      const teams = 
        data.leagueTeamInfoList?.leagueTeamInfo ||
        data.teamInfoList?.teamInfo ||
        data.teams || [];

      if (teams.length === 0) {
        res.status(400).json({
          success: false,
          message: 'No team data found in export'
        });
        return;
      }

      const { created, updated, unassigned } = await ingestTeams(
        leagueId,
        teams
      );

      console.log(`✅ Teams processed: ${created} created, ${updated} updated`);

      res.status(200).json({
        success:    true,
        message:    'League info imported successfully',
        created,
        updated,
        unassigned: unassigned.length > 0 ? unassigned : undefined
      });

    } catch (error) {
      console.error('League info ingest error:', error);
      res.status(500).json({
        success: false,
        message: 'Error processing league info'
      });
    }
  }
);

// =============================================
// ROSTERS EXPORT
// POST /api/ingest/madden/:leagueId/rosters
// Receives: all player data
// =============================================
router.post(
  '/madden/:leagueId/rosters',
  validateApiKey,
  async (req: any, res: any) => {
    try {
      const leagueId = req.params.leagueId;
      const data     = req.body;
      const season   = req.league.season || 1;

      console.log(`📥 Rosters export received for ${req.league.name}`);

      // Madden sends players in rosterInfoList
      const players =
        data.rosterInfoList?.playerInfo ||
        data.playerInfoList?.playerInfo ||
        data.rosters || [];

      if (players.length === 0) {
        res.status(400).json({
          success: false,
          message: 'No player data found in export'
        });
        return;
      }

      // Get team ID map from existing teams
      const teamsResult = await query(
        `SELECT id, abbreviation FROM teams WHERE league_id = $1`,
        [leagueId]
      );

      const teamIdMap = new Map<number, string>();
      // Build map from Madden teamId to our UUID
      // We match by abbreviation
      const teamsByAbbr = new Map<string, string>();
      teamsResult.rows.forEach((t: any) => {
        teamsByAbbr.set(t.abbreviation, t.id);
      });

      // Map Madden teamIds
      players.forEach((p: any) => {
        if (p.teamId !== undefined) {
          // Will be resolved during ingest
        }
      });

      const { created, updated, playerIdMap } = await ingestPlayers(
        leagueId,
        season,
        players,
        teamIdMap
      );

      console.log(
        `✅ Players processed: ${created} created, ${updated} updated`
      );

      res.status(200).json({
        success: true,
        message: 'Rosters imported successfully',
        created,
        updated
      });

    } catch (error) {
      console.error('Rosters ingest error:', error);
      res.status(500).json({
        success: false,
        message: 'Error processing rosters'
      });
    }
  }
);

// =============================================
// WEEKLY STATS EXPORT
// POST /api/ingest/madden/:leagueId/week
// Receives: game scores + player stats for a week
// Triggers: Discord auto-posts
// =============================================
router.post(
  '/madden/:leagueId/week',
  validateApiKey,
  async (req: any, res: any) => {
    try {
      const leagueId = req.params.leagueId;
      const data     = req.body;
      const season   = req.league.season || 1;

      console.log(`📥 Weekly stats export received for ${req.league.name}`);

      // Madden sends scores in scheduleInfoList
      const scores =
        data.scheduleInfoList?.scheduleInfo ||
        data.gameInfoList?.gameInfo ||
        data.scores || [];

      if (scores.length === 0) {
        res.status(400).json({
          success: false,
          message: 'No game data found in export'
        });
        return;
      }

      // Get team and player ID maps
      const teamsResult = await query(
        `SELECT id, abbreviation FROM teams WHERE league_id = $1`,
        [leagueId]
      );
      const playersResult = await query(
        `SELECT id FROM players WHERE league_id = $1`,
        [leagueId]
      );

      const teamIdMap   = new Map<number, string>();
      const playerIdMap = new Map<number, string>();

      const { created, statsProcessed } = await ingestGames(
        leagueId,
        scores,
        teamIdMap,
        playerIdMap
      );

      console.log(
        `✅ Games processed: ${created} created, ` +
        `${statsProcessed} stats processed`
      );

      // Send response immediately
      res.status(200).json({
        success: true,
        message: 'Weekly stats imported successfully',
        games_created:   created,
        stats_processed: statsProcessed
      });

      // Auto-post to Discord after response
      const channelId = req.league.discord_channel_id;
      if (channelId) {
        try {
          await calculateAllAwards(leagueId, season);

          // Find games just created and post recaps
          const recentGames = await query(
            `SELECT id FROM games
             WHERE league_id = $1
             AND created_at > NOW() - INTERVAL '5 minutes'`,
            [leagueId]
          );

          for (const game of recentGames.rows) {
            await autoPostGameRecap(
              leagueId,
              game.id,
              season,
              channelId
            );
            await new Promise(r => setTimeout(r, 2000));
          }

          await autoPostAwardUpdate(leagueId, channelId, season);

        } catch (discordError) {
          console.error('Discord auto-post error:', discordError);
        }
      }

    } catch (error) {
      console.error('Weekly stats ingest error:', error);
      res.status(500).json({
        success: false,
        message: 'Error processing weekly stats'
      });
    }
  }
);

// =============================================
// LEGACY ENDPOINT — Keep for backward compat
// POST /api/ingest/madden/:leagueId
// =============================================
router.post(
  '/madden/:leagueId',
  validateApiKey,
  async (req: any, res: any) => {
    try {
      const leagueId = req.params.leagueId;
      const {
        leagueInfo,
        teams,
        rosters,
        scores
      } = req.body;

      if (!teams || !rosters) {
        res.status(400).json({
          success: false,
          message: 'Invalid export. Required: teams, rosters'
        });
        return;
      }

      const season = leagueInfo?.currentSeason || req.league.season || 1;

      const {
        created:   teamsCreated,
        updated:   teamsUpdated,
        teamIdMap
      } = await ingestTeams(leagueId, teams);

      const {
        created:    playersCreated,
        updated:    playersUpdated,
        playerIdMap
      } = await ingestPlayers(leagueId, season, rosters, teamIdMap);

      let gamesCreated    = 0;
      let statsProcessed  = 0;

      if (scores?.length > 0) {
        const gamesResult = await ingestGames(
          leagueId,
          scores,
          teamIdMap,
          playerIdMap
        );
        gamesCreated   = gamesResult.created;
        statsProcessed = gamesResult.statsProcessed;
      }

      res.status(200).json({
        success: true,
        message: 'League data imported successfully',
        teams:   { created: teamsCreated, updated: teamsUpdated },
        players: { created: playersCreated, updated: playersUpdated },
        games:   { created: gamesCreated, stats: statsProcessed }
      });

    } catch (error) {
      console.error('Legacy ingest error:', error);
      res.status(500).json({
        success: false,
        message: 'Error importing league data'
      });
    }
  }
);

export default router;