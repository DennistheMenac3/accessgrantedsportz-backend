import { Router } from 'express';
import { ingestMaddenData } from '../controllers/ingestionController';
import { protect } from '../middleware/authMiddleware';

const router = Router();

// Protected — must be logged in to ingest data
router.use(protect);

// POST /api/ingest/madden/:leagueId
router.post('/madden/:leagueId', ingestMaddenData);

export default router;