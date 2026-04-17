import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import {
  generateTradeRumors,
  generatePowerRankings,
  generatePostGameRecap,
  generateAwardAnnouncement,
  generateScoutingReport,
  generateCapCasualtyReport,
  findTeamNeeds
} from '../services/aiStorylineService';
import { query } from '../config/database';

// =============================================
// GENERATE TRADE RUMORS
// POST /api/leagues/:leagueId/storylines/rumors
// =============================================
export const tradeRumors = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const { season, week, weeks_to_deadline } = req.body;

    console.log('📰 Generating trade rumors...');
    const result = await generateTradeRumors(
      leagueId, season || 1, week || 1, weeks_to_deadline
    );

    res.status(200).json({
      success: true,
      message: 'Trade rumors generated successfully',
      ...result
    });
  } catch (error) {
    console.error('Trade rumors error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error generating trade rumors'
    });
  }
};

// =============================================
// GENERATE POWER RANKINGS
// POST /api/leagues/:leagueId/storylines/rankings
// Body: { season, week, style: 'standard' | 'stephen_a' }
// =============================================
export const powerRankings = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const { season, week, style } = req.body;

    const rankingStyle = style === 'stephen_a' ? 'stephen_a' : 'standard';

    console.log(`📊 Generating ${rankingStyle} power rankings...`);
    const result = await generatePowerRankings(
      leagueId, season || 1, week || 1, rankingStyle
    );

    res.status(200).json({
      success: true,
      message: `${rankingStyle} power rankings generated`,
      ...result
    });
  } catch (error) {
    console.error('Power rankings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error generating power rankings'
    });
  }
};

// =============================================
// GENERATE POST GAME RECAP
// POST /api/leagues/:leagueId/storylines/recap/:gameId
// =============================================
export const gameRecap = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const gameId   = req.params.gameId   as string;
    const { season } = req.body;

    console.log('🏈 Generating game recap...');
    const recap = await generatePostGameRecap(leagueId, gameId, season || 1);

    res.status(200).json({
      success: true,
      message: 'Game recap generated',
      recap
    });
  } catch (error) {
    console.error('Game recap error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error generating game recap'
    });
  }
};

// =============================================
// GENERATE SCOUTING REPORT
// POST /api/leagues/:leagueId/storylines/scout/:playerId
// =============================================
export const scoutingReport = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const playerId = req.params.playerId as string;
    const { season } = req.body;

    console.log('🔍 Generating scouting report...');
    const report = await generateScoutingReport(leagueId, playerId, season || 1);

    res.status(200).json({
      success: true,
      message: 'Scouting report generated',
      report
    });
  } catch (error) {
    console.error('Scouting report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error generating scouting report'
    });
  }
};

// =============================================
// GET TEAM NEEDS FOR A PLAYER
// GET /api/leagues/:leagueId/storylines/needs/:playerId
// Returns which teams need this player most
// =============================================
export const teamNeeds = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const playerId = req.params.playerId as string;

    // Get player position
    const playerResult = await query(
      `SELECT position, overall_rating FROM players WHERE id = $1`,
      [playerId]
    );

    if (playerResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Player not found' });
      return;
    }

    const { position } = playerResult.rows[0];

    console.log('🎯 Finding team needs...');
    const needs = await findTeamNeeds(leagueId, position, 50, playerId);

    res.status(200).json({
      success: true,
      player_id: playerId,
      position,
      count: needs.length,
      interested_teams: needs
    });
  } catch (error) {
    console.error('Team needs error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error finding team needs'
    });
  }
};

// =============================================
// GENERATE CAP CASUALTY REPORT
// POST /api/leagues/:leagueId/storylines/cap
// =============================================
export const capReport = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const { season, week } = req.body;

    console.log('💰 Generating cap casualty report...');
    const result = await generateCapCasualtyReport(
      leagueId, season || 1, week || 1
    );

    res.status(200).json({
      success: true,
      message: 'Cap casualty report generated',
      ...result
    });
  } catch (error) {
    console.error('Cap report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error generating cap report'
    });
  }
};

// =============================================
// GET ALL STORYLINES
// GET /api/leagues/:leagueId/storylines
// =============================================
export const getStorylines = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const { season, week, type } = req.query;

    let queryText = `SELECT * FROM storylines WHERE league_id = $1`;
    const params: any[] = [leagueId];
    let paramCount = 1;

    if (season) {
      paramCount++;
      queryText += ` AND season = $${paramCount}`;
      params.push(parseInt(season as string));
    }
    if (week) {
      paramCount++;
      queryText += ` AND week = $${paramCount}`;
      params.push(parseInt(week as string));
    }
    if (type) {
      paramCount++;
      queryText += ` AND storyline_type = $${paramCount}`;
      params.push(type);
    }

    queryText += ` ORDER BY created_at DESC LIMIT 50`;

    const result = await query(queryText, params);

    res.status(200).json({
      success: true,
      count: result.rows.length,
      storylines: result.rows
    });
  } catch (error) {
    console.error('Get storylines error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching storylines'
    });
  }
};