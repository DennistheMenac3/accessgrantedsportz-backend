import { Router } from 'express';
import {
  getPlayerTradeValue,
  getLeagueTradeValues,
  analyzeTrade,
  proposeTrade,
  getProposals
} from '../controllers/tradeController';
import { protect } from '../middleware/authMiddleware';

const router = Router({ mergeParams: true });

// All trade routes are protected
router.use(protect);

// GET /api/leagues/:leagueId/trades/values
router.get('/values', getLeagueTradeValues);

// GET /api/leagues/:leagueId/trades/proposals
router.get('/proposals', getProposals);

// GET /api/leagues/:leagueId/trades/player/:playerId
router.get('/player/:playerId', getPlayerTradeValue);

// POST /api/leagues/:leagueId/trades/analyze
router.post('/analyze', analyzeTrade);

// POST /api/leagues/:leagueId/trades/propose
router.post('/propose', proposeTrade);

export default router;