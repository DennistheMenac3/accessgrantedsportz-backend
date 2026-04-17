import { Router } from 'express';
import {
  create,
  getAll,
  getOne,
  update,
  remove,
  standings,
  assignDivision
} from '../controllers/teamController';
import { protect } from '../middleware/authMiddleware';

// mergeParams: true lets us access
// :leagueId from the parent route
const router = Router({ mergeParams: true });

// All team routes are protected
router.use(protect);

// GET /api/leagues/:leagueId/teams/standings
// Must be defined BEFORE /:id route
router.get('/standings', standings);

// POST /api/leagues/:leagueId/teams
router.post('/', create);

// GET /api/leagues/:leagueId/teams
router.get('/', getAll);

// GET /api/leagues/:leagueId/teams/:id
router.get('/:id', getOne);

// PUT /api/leagues/:leagueId/teams/:id
router.put('/:id', update);

// DELETE /api/leagues/:leagueId/teams/:id
router.delete('/:id', remove);

// PUT /api/leagues/:leagueId/teams/:id/division
router.put('/:id/division', assignDivision);

export default router;