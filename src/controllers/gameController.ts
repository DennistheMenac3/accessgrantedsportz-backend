import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import {
  createGame,
  getGamesByLeague,
  getGameById,
  updateGameScore,
  submitGameStats,
  getPlayerSeasonStats,
  getLeagueLeaders
} from '../models/gameModel';
import { updateTeam } from '../models/teamModel';

// =============================================
// CREATE GAME
// POST /api/leagues/:leagueId/games
// =============================================
export const create = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const {
      home_team_id,
      away_team_id,
      home_score,
      away_score,
      week,
      season,
      played_at
    } = req.body;

    // Validate required fields
    if (!home_team_id || !away_team_id || !week || !season) {
      res.status(400).json({
        success: false,
        message: 'home_team_id, away_team_id, week and season are required'
      });
      return;
    }

    // Cant play against yourself
    if (home_team_id === away_team_id) {
      res.status(400).json({
        success: false,
        message: 'Home and away teams must be different'
      });
      return;
    }

    const game = await createGame({
      league_id: leagueId,
      home_team_id,
      away_team_id,
      home_score,
      away_score,
      week: parseInt(week),
      season: parseInt(season),
      played_at
    });

    // If scores were provided update team records
    if (home_score !== undefined && away_score !== undefined) {
      await updateTeamRecords(
        home_team_id,
        away_team_id,
        home_score,
        away_score
      );
    }

    res.status(201).json({
      success: true,
      message: `Week ${game.week} game created successfully`,
      game
    });

  } catch (error) {
    console.error('Create game error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error creating game'
    });
  }
};

// =============================================
// GET ALL GAMES IN LEAGUE
// GET /api/leagues/:leagueId/games
// =============================================
export const getAll = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const { week, season, team_id } = req.query;

    const games = await getGamesByLeague(leagueId, {
      week:    week    ? parseInt(week as string)    : undefined,
      season:  season  ? parseInt(season as string)  : undefined,
      team_id: team_id as string
    });

    res.status(200).json({
      success: true,
      count: games.length,
      games
    });

  } catch (error) {
    console.error('Get games error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching games'
    });
  }
};

// =============================================
// GET SINGLE GAME WITH BOX SCORE
// GET /api/leagues/:leagueId/games/:id
// =============================================
export const getOne = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const game = await getGameById(id);

    if (!game) {
      res.status(404).json({
        success: false,
        message: 'Game not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      game
    });

  } catch (error) {
    console.error('Get game error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching game'
    });
  }
};

// =============================================
// SUBMIT GAME STATS
// POST /api/leagues/:leagueId/games/:id/stats
// =============================================
export const submitStats = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const gameId = req.params.id as string;
    const { home_score, away_score, stats } = req.body;

    // Validate
    if (!stats || !Array.isArray(stats) || stats.length === 0) {
      res.status(400).json({
        success: false,
        message: 'Stats array is required'
      });
      return;
    }

    // Get the game first
    const game = await getGameById(gameId);
    if (!game) {
      res.status(404).json({
        success: false,
        message: 'Game not found'
      });
      return;
    }

    // Submit all player stats
    await submitGameStats(gameId, stats);

    // Update final score if provided
    if (home_score !== undefined && away_score !== undefined) {
      await updateGameScore(gameId, home_score, away_score);

      // Update team win/loss records
      await updateTeamRecords(
        game.home_team_id,
        game.away_team_id,
        home_score,
        away_score
      );
    }

    // Get the updated game with full box score
    const updatedGame = await getGameById(gameId);

    res.status(200).json({
      success: true,
      message: 'Game stats submitted successfully',
      game: updatedGame
    });

  } catch (error) {
    console.error('Submit stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error submitting stats'
    });
  }
};

// =============================================
// GET PLAYER SEASON STATS
// GET /api/leagues/:leagueId/games/player/:playerId/season/:season
// =============================================
export const getPlayerStats = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const playerId = req.params.playerId as string;
    const season   = parseInt(req.params.season as string);

    const stats = await getPlayerSeasonStats(playerId, season);

    if (!stats) {
      res.status(404).json({
        success: false,
        message: 'No stats found for this player and season'
      });
      return;
    }

    res.status(200).json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('Get player stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching player stats'
    });
  }
};

// =============================================
// GET LEAGUE LEADERS
// GET /api/leagues/:leagueId/games/leaders/:season/:stat
// =============================================
export const getLeaders = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const season   = parseInt(req.params.season as string);
    const stat     = req.params.stat as string;
    const limit    = req.query.limit
      ? parseInt(req.query.limit as string)
      : 10;

    const leaders = await getLeagueLeaders(
      leagueId,
      season,
      stat,
      limit
    );

    res.status(200).json({
      success: true,
      stat,
      season,
      count: leaders.length,
      leaders
    });

  } catch (error: any) {
    console.error('Get leaders error:', error);

    // Handle invalid stat column error
    if (error.message?.includes('Invalid stat column')) {
      res.status(400).json({
        success: false,
        message: error.message,
        valid_stats: [
          'pass_yards', 'pass_touchdowns',
          'rush_yards', 'rush_touchdowns',
          'receiving_yards', 'receptions',
          'receiving_touchdowns', 'tackles',
          'sacks', 'forced_fumbles',
          'interceptions'
        ]
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Server error fetching leaders'
    });
  }
};

// =============================================
// HELPER — Update team win/loss records
// Called automatically when a game score
// is submitted
// =============================================
const updateTeamRecords = async (
  home_team_id: string,
  away_team_id: string,
  home_score: number,
  away_score: number
): Promise<void> => {
  if (home_score > away_score) {
    // Home team won
    await updateTeam(home_team_id, { wins: 1 });
    await updateTeam(away_team_id, { losses: 1 });
  } else if (away_score > home_score) {
    // Away team won
    await updateTeam(away_team_id, { wins: 1 });
    await updateTeam(home_team_id, { losses: 1 });
  }
  // Ties — no wins or losses recorded
};