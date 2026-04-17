import { Router } from 'express';
import {
  tradeRumors,
  powerRankings,
  gameRecap,
  scoutingReport,
  teamNeeds,
  capReport,
  getStorylines
} from '../controllers/storylineController';
import { protect } from '../middleware/authMiddleware';
import { query } from '../config/database';
import {
  autoPostRankings,
  autoPostRumors
} from '../services/schedulerService';

const router = Router({ mergeParams: true });
router.use(protect);

// GET  /api/leagues/:leagueId/storylines
router.get('/', getStorylines);

// POST /api/leagues/:leagueId/storylines/rumors
router.post('/rumors', tradeRumors);

// POST /api/leagues/:leagueId/storylines/rankings
router.post('/rankings', powerRankings);

// POST /api/leagues/:leagueId/storylines/cap
router.post('/cap', capReport);

// GET  /api/leagues/:leagueId/storylines/needs/:playerId
router.get('/needs/:playerId', teamNeeds);

// POST /api/leagues/:leagueId/storylines/recap/:gameId
router.post('/recap/:gameId', gameRecap);

// POST /api/leagues/:leagueId/storylines/scout/:playerId
router.post('/scout/:playerId', scoutingReport);

// POST /api/leagues/:leagueId/storylines/autopost
// Manually trigger auto-post for testing
router.post('/autopost', async (req: any, res: any) => {
  try {
    const leagueId = req.params.leagueId;

    const leagueResult = await query(
      `SELECT * FROM leagues WHERE id = $1`,
      [leagueId]
    );

    const league = leagueResult.rows[0];

    if (!league?.discord_channel_id) {
      res.status(400).json({
        success: false,
        message: 'No Discord channel configured. Set discord_channel_id first.'
      });
      return;
    }

    const season = 1;
    const week   = league.current_week || 2;

    await autoPostRankings(
      leagueId,
      league.discord_channel_id,
      season,
      week
    );

    await new Promise(resolve => setTimeout(resolve, 3000));

    await autoPostRumors(
      leagueId,
      league.discord_channel_id,
      season,
      week
    );

    res.status(200).json({
      success: true,
      message: 'Auto-post triggered successfully',
      channel: league.discord_channel_id
    });

  } catch (error) {
    console.error('Auto-post error:', error);
    res.status(500).json({
      success: false,
      message: 'Error triggering auto-post'
    });
  }
});

export default router;