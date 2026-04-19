import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { query } from '../config/database';
import { calculateTradeValue } from '../services/tradeValueService';
import {
  getPlayerTradeValue,
  getLeagueTradeValues,
  analyzeTrade,
  proposeTrade,
  getProposals
} from '../controllers/tradeController';
import {
  getTeamDraftPicks,
  generateSeasonDraftPicks,
  getLeagueDraftPicks,
  getDraftPickValue
} from '../services/draftPickService';

const router = Router({ mergeParams: true });

// Apply auth middleware to all routes in this router
router.use(protect);

// ==========================================
// TRADE ROUTES
// ==========================================

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

// ==========================================
// DRAFT PICK ROUTES
// ==========================================

// GET /api/leagues/:leagueId/trades/picks
// Get all draft picks in league
router.get('/picks', async (req: any, res: any) => {
  try {
    const leagueId = req.params.leagueId;
    const season   = parseInt(req.query.season as string) || 1;

    const picks = await getLeagueDraftPicks(leagueId, season);

    res.status(200).json({
      success: true,
      count:   picks.length,
      picks
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching picks' });
  }
});

// POST /api/leagues/:leagueId/trades/picks/generate
// Generate all draft picks for a season
router.post('/picks/generate', async (req: any, res: any) => {
  try {
    const leagueId = req.params.leagueId;
    const season   = req.body.season || 1;

    await generateSeasonDraftPicks(leagueId, season);

    res.status(200).json({
      success: true,
      message: `Draft picks generated for season ${season}`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error generating picks'
    });
  }
});

// GET /api/leagues/:leagueId/trades/picks/team/:teamId
// Get picks for a specific team
router.get('/picks/team/:teamId', async (req: any, res: any) => {
  try {
    const leagueId = req.params.leagueId;
    const teamId   = req.params.teamId;
    const season   = parseInt(req.query.season as string) || 1;

    const picks = await getTeamDraftPicks(teamId, leagueId, season);

    res.status(200).json({
      success: true,
      count:   picks.length,
      picks
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching team picks'
    });
  }
});

export default router;