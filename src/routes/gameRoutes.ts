import { Router } from 'express';
import {
  create,
  getAll,
  getOne,
  submitStats,
  getPlayerStats,
  getLeaders
} from '../controllers/gameController';
import { protect } from '../middleware/authMiddleware';

const router = Router({ mergeParams: true });

// All game routes are protected
router.use(protect);

// Special routes before /:id
// GET /api/leagues/:leagueId/games/leaders/:season/:stat
router.get('/leaders/:season/:stat', getLeaders);

// GET /api/leagues/:leagueId/games/player/:playerId/season/:season
router.get('/player/:playerId/season/:season', getPlayerStats);

// Standard CRUD
// POST /api/leagues/:leagueId/games
router.post('/', create);

// GET /api/leagues/:leagueId/games
router.get('/', getAll);

// GET /api/leagues/:leagueId/games/:id
router.get('/:id', getOne);

// POST /api/leagues/:leagueId/games/:id/stats
router.post('/:id/stats', submitStats);

export default router;