import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import {
  createPlayer,
  getPlayersByTeam,
  getPlayersByLeague,
  getPlayerById,
  updatePlayer,
  deletePlayer,
  searchPlayers,
  getTopPlayersByPosition
} from '../models/playerModel';

// =============================================
// CREATE PLAYER
// POST /api/leagues/:leagueId/players
// =============================================
export const create = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const {
      team_id,
      first_name,
      last_name,
      position,
      overall_rating,
      age,
      speed,
      strength,
      awareness,
      dev_trait,
      years_pro,
      headshot_url,
      player_card_url
    } = req.body;

    // Validate required fields
    if (!team_id || !first_name || !last_name || !position) {
      res.status(400).json({
        success: false,
        message: 'team_id, first_name, last_name and position are required'
      });
      return;
    }

    // Validate position
    const validPositions = [
      'QB', 'RB', 'WR', 'TE', 'OL',
      'DL', 'LB', 'CB', 'S', 'K', 'P'
    ];

    if (!validPositions.includes(position.toUpperCase())) {
      res.status(400).json({
        success: false,
        message: `Invalid position. Must be one of: ${validPositions.join(', ')}`
      });
      return;
    }

    const player = await createPlayer({
      team_id,
      league_id: leagueId,
      first_name,
      last_name,
      position,
      overall_rating,
      age,
      speed,
      strength,
      awareness,
      dev_trait,
      years_pro,
      headshot_url,
      player_card_url
    });

    res.status(201).json({
      success: true,
      message: `${player.first_name} ${player.last_name} added successfully`,
      player
    });

  } catch (error) {
    console.error('Create player error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error creating player'
    });
  }
};

// =============================================
// GET ALL PLAYERS IN LEAGUE
// GET /api/leagues/:leagueId/players
// =============================================
export const getAll = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const players = await getPlayersByLeague(leagueId);

    res.status(200).json({
      success: true,
      count: players.length,
      players
    });

  } catch (error) {
    console.error('Get players error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching players'
    });
  }
};

// =============================================
// GET PLAYERS BY TEAM
// GET /api/leagues/:leagueId/players/team/:teamId
// =============================================
export const getByTeam = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const teamId = req.params.teamId as string;
    const players = await getPlayersByTeam(teamId);

    res.status(200).json({
      success: true,
      count: players.length,
      players
    });

  } catch (error) {
    console.error('Get players by team error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching team players'
    });
  }
};

// =============================================
// GET SINGLE PLAYER
// GET /api/leagues/:leagueId/players/:id
// =============================================
export const getOne = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const player = await getPlayerById(id);

    if (!player) {
      res.status(404).json({
        success: false,
        message: 'Player not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      player
    });

  } catch (error) {
    console.error('Get player error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching player'
    });
  }
};

// =============================================
// SEARCH PLAYERS
// GET /api/leagues/:leagueId/players/search
// =============================================
export const search = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const {
      position,
      min_overall,
      max_overall,
      dev_trait,
      min_age,
      max_age,
      search: searchTerm
    } = req.query;

    const players = await searchPlayers(leagueId, {
      position:    position as string,
      min_overall: min_overall ? parseInt(min_overall as string) : undefined,
      max_overall: max_overall ? parseInt(max_overall as string) : undefined,
      dev_trait:   dev_trait as string,
      min_age:     min_age ? parseInt(min_age as string) : undefined,
      max_age:     max_age ? parseInt(max_age as string) : undefined,
      search:      searchTerm as string
    });

    res.status(200).json({
      success: true,
      count: players.length,
      players
    });

  } catch (error) {
    console.error('Search players error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error searching players'
    });
  }
};

// =============================================
// GET TOP PLAYERS BY POSITION
// GET /api/leagues/:leagueId/players/top/:position
// =============================================
export const getTopByPosition = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const position = req.params.position as string;
    const limit = req.query.limit
      ? parseInt(req.query.limit as string)
      : 10;

    const players = await getTopPlayersByPosition(
      leagueId,
      position,
      limit
    );

    res.status(200).json({
      success: true,
      position: position.toUpperCase(),
      count: players.length,
      players
    });

  } catch (error) {
    console.error('Get top players error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching top players'
    });
  }
};

// =============================================
// UPDATE PLAYER
// PUT /api/leagues/:leagueId/players/:id
// =============================================
export const update = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const {
      team_id,
      first_name,
      last_name,
      position,
      overall_rating,
      age,
      speed,
      strength,
      awareness,
      dev_trait,
      years_pro,
      headshot_url,
      player_card_url
    } = req.body;

    const player = await updatePlayer(id, {
      team_id,
      first_name,
      last_name,
      position,
      overall_rating,
      age,
      speed,
      strength,
      awareness,
      dev_trait,
      years_pro,
      headshot_url,
      player_card_url
    });

    if (!player) {
      res.status(404).json({
        success: false,
        message: 'Player not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: `${player.first_name} ${player.last_name} updated successfully`,
      player
    });

  } catch (error) {
    console.error('Update player error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating player'
    });
  }
};

// =============================================
// DELETE PLAYER
// DELETE /api/leagues/:leagueId/players/:id
// =============================================
export const remove = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;

    const deleted = await deletePlayer(id);

    if (!deleted) {
      res.status(404).json({
        success: false,
        message: 'Player not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Player deleted successfully'
    });

  } catch (error) {
    console.error('Delete player error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error deleting player'
    });
  }
};