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

export default router;