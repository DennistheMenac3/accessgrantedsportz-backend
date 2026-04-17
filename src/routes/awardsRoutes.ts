import { Router } from 'express';
import {
  calculate,
  getLeaders,
  getTrappedGems
} from '../controllers/awardsController';
import { protect } from '../middleware/authMiddleware';

const router = Router({ mergeParams: true });

router.use(protect);

// POST /api/leagues/:leagueId/awards/calculate
router.post('/calculate', calculate);

// GET /api/leagues/:leagueId/awards/gems/:season
// Must be BEFORE /:season route
// otherwise Express reads "gems" as a season number
router.get('/gems/:season', getTrappedGems);

// GET /api/leagues/:leagueId/awards/:season
router.get('/:season', getLeaders);

export default router;