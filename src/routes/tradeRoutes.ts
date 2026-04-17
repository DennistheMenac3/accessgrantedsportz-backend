import { Router } from 'express';
import {
  getPlayerTradeValue,
  getLeagueTradeValues,
  analyzeTrade,
  proposeTrade,
  getProposals
} from '../controllers/tradeController';
import { protect } from '../middleware/authMiddleware';
import { query } from '../config/database';
import { calculateTradeValue } from '../services/tradeValueService';

const router = Router({ mergeParams: true });

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

// POST /api/leagues/:leagueId/trades/calculate-values
// Calculates trade values for all players in the league
router.post('/calculate-values', async (req: any, res: any) => {
  try {
    const leagueId = req.params.leagueId;
    const season   = req.body.season || 1;

    const players = await query(
      `SELECT p.*, t.abbreviation as team_abbreviation
       FROM players p
       LEFT JOIN teams t ON t.id = p.team_id
       WHERE p.league_id = $1`,
      [leagueId]
    );

    let calculated = 0;
    let failed     = 0;

    for (const player of players.rows) {
      try {
        await calculateTradeValue(player.id, leagueId, season);
        calculated++;
      } catch (err) {
        console.error(
          `Error calculating value for ` +
          `${player.first_name} ${player.last_name}:`, err
        );
        failed++;
      }
    }

    res.status(200).json({
      success:    true,
      message:    `Trade values calculated for ${calculated} players`,
      calculated,
      failed,
      total:      players.rows.length
    });

  } catch (error) {
    console.error('Calculate values error:', error);
    res.status(500).json({
      success: false,
      message: 'Error calculating trade values'
    });
  }
});

export default router;