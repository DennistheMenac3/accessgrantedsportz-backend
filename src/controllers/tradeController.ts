import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import {
  calculateTradeValue,
  calculateLeagueTradeValues,
  analyzeTradeProposal
} from '../services/tradeValueService';
import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

// =============================================
// GET PLAYER TRADE VALUE
// GET /api/leagues/:leagueId/trades/player/:playerId
// =============================================
export const getPlayerTradeValue = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId  = req.params.leagueId as string;
    const playerId  = req.params.playerId as string;
    const season    = parseInt(req.query.season as string || '1');
    const week      = req.query.week
      ? parseInt(req.query.week as string)
      : undefined;

    const result = await calculateTradeValue(
      playerId,
      leagueId,
      season,
      week
    );

    // Get player info
    const playerResult = await query(
      `SELECT p.*,
        t.name as team_name,
        t.abbreviation as team_abbreviation,
        t.team_logo_url,
        t.primary_color
       FROM players p
       LEFT JOIN teams t ON t.id = p.team_id
       WHERE p.id = $1`,
      [playerId]
    );

    res.status(200).json({
      success: true,
      player: playerResult.rows[0],
      trade_value: result.total_value,
      breakdown: result.breakdown
    });

  } catch (error) {
    console.error('Get trade value error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error calculating trade value'
    });
  }
};

// =============================================
// GET ALL TRADE VALUES IN LEAGUE
// GET /api/leagues/:leagueId/trades/values
// =============================================
export const getLeagueTradeValues = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const season   = parseInt(req.query.season as string || '1');
    const week     = req.query.week
      ? parseInt(req.query.week as string)
      : undefined;

    console.log(`📊 Calculating trade values for league ${leagueId}...`);

    const result = await calculateLeagueTradeValues(
      leagueId,
      season,
      week
    );

    res.status(200).json({
      success: true,
      message: `Trade values calculated for ${result.processed} players`,
      count: result.processed,
      players: result.results
    });

  } catch (error) {
    console.error('Get league trade values error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error calculating league trade values'
    });
  }
};

// =============================================
// ANALYZE TRADE PROPOSAL
// POST /api/leagues/:leagueId/trades/analyze
// =============================================
export const analyzeTrade = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const {
      offered_player_ids,
      requested_player_ids,
      season
    } = req.body;

    if (
      !offered_player_ids ||
      !requested_player_ids ||
      !Array.isArray(offered_player_ids) ||
      !Array.isArray(requested_player_ids)
    ) {
      res.status(400).json({
        success: false,
        message: 'offered_player_ids and requested_player_ids arrays are required'
      });
      return;
    }

    const analysis = await analyzeTradeProposal(
      offered_player_ids,
      requested_player_ids,
      leagueId,
      season || 1
    );

    res.status(200).json({
      success: true,
      analysis
    });

  } catch (error) {
    console.error('Analyze trade error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error analyzing trade'
    });
  }
};

// =============================================
// SUBMIT TRADE PROPOSAL
// POST /api/leagues/:leagueId/trades/propose
// =============================================
export const proposeTrade = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const userId   = req.user!.id;
    const {
      receiving_team_id,
      offered_player_ids,
      requested_player_ids,
      season
    } = req.body;

    if (
      !receiving_team_id ||
      !offered_player_ids ||
      !requested_player_ids
    ) {
      res.status(400).json({
        success: false,
        message: 'receiving_team_id, offered_player_ids and requested_player_ids are required'
      });
      return;
    }

    // Get proposing team
    const proposingTeamResult = await query(
      `SELECT id FROM teams
       WHERE league_id = $1
       AND owner_id = $2`,
      [leagueId, userId]
    );

    if (proposingTeamResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: 'You do not have a team in this league'
      });
      return;
    }

    const proposingTeamId = proposingTeamResult.rows[0].id;

    // Analyze the trade
    const analysis = await analyzeTradeProposal(
      offered_player_ids,
      requested_player_ids,
      leagueId,
      season || 1
    );

    // Create the trade proposal
    const proposalId = uuidv4();
    await query(
      `INSERT INTO trade_proposals (
        id, league_id, proposing_team_id,
        receiving_team_id, status,
        total_value_offered, total_value_requested
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        proposalId,
        leagueId,
        proposingTeamId,
        receiving_team_id,
        'pending',
        analysis.offered_value,
        analysis.requested_value
      ]
    );

    // Add offered players
    for (const playerId of offered_player_ids) {
      await query(
        `INSERT INTO trade_proposal_items (
          id, proposal_id, direction,
          player_id, trade_value_at_time
        )
        VALUES ($1, $2, $3, $4, $5)`,
        [
          uuidv4(),
          proposalId,
          'offered',
          playerId,
          analysis.offered_players.find(
            (p: any) => p.id === playerId
          )?.total_value || 0
        ]
      );
    }

    // Add requested players
    for (const playerId of requested_player_ids) {
      await query(
        `INSERT INTO trade_proposal_items (
          id, proposal_id, direction,
          player_id, trade_value_at_time
        )
        VALUES ($1, $2, $3, $4, $5)`,
        [
          uuidv4(),
          proposalId,
          'requested',
          playerId,
          analysis.requested_players.find(
            (p: any) => p.id === playerId
          )?.total_value || 0
        ]
      );
    }

    res.status(201).json({
      success: true,
      message: 'Trade proposal submitted successfully',
      proposal_id: proposalId,
      analysis
    });

  } catch (error) {
    console.error('Propose trade error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error proposing trade'
    });
  }
};

// =============================================
// GET TRADE PROPOSALS FOR A LEAGUE
// GET /api/leagues/:leagueId/trades/proposals
// =============================================
export const getProposals = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;

    const result = await query(
      `SELECT tp.*,
        pt.name as proposing_team_name,
        pt.abbreviation as proposing_team_abbreviation,
        pt.team_logo_url as proposing_team_logo,
        rt.name as receiving_team_name,
        rt.abbreviation as receiving_team_abbreviation,
        rt.team_logo_url as receiving_team_logo
       FROM trade_proposals tp
       LEFT JOIN teams pt ON pt.id = tp.proposing_team_id
       LEFT JOIN teams rt ON rt.id = tp.receiving_team_id
       WHERE tp.league_id = $1
       ORDER BY tp.proposed_at DESC`,
      [leagueId]
    );

    res.status(200).json({
      success: true,
      count: result.rows.length,
      proposals: result.rows
    });

  } catch (error) {
    console.error('Get proposals error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching trade proposals'
    });
  }
};