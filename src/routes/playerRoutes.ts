import { Router } from 'express';
import {
  create,
  getAll,
  getByTeam,
  getOne,
  search,
  getTopByPosition,
  update,
  remove
} from '../controllers/playerController';
import { protect } from '../middleware/authMiddleware';

const router = Router({ mergeParams: true });

// All player routes are protected
router.use(protect);

// Special routes first — before /:id
// GET /api/leagues/:leagueId/players/search
router.get('/search', search);

// GET /api/leagues/:leagueId/players/team/:teamId
router.get('/team/:teamId', getByTeam);

// GET /api/leagues/:leagueId/players/top/:position
router.get('/top/:position', getTopByPosition);

// Standard CRUD routes
// POST /api/leagues/:leagueId/players
router.post('/', create);

// GET /api/leagues/:leagueId/players
router.get('/', getAll);

// GET /api/leagues/:leagueId/players/:id
router.get('/:id', getOne);

// PUT /api/leagues/:leagueId/players/:id
router.put('/:id', update);

// DELETE /api/leagues/:leagueId/players/:id
router.delete('/:id', remove);

export default router;