import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import {
  createLeague,
  getLeaguesByOwner,
  getLeagueById,
  updateLeague,
  deleteLeague,
  isLeagueOwner
} from '../models/leagueModel';

// =============================================
// CREATE LEAGUE
// POST /api/leagues
// =============================================
export const create = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { name, sport, season } = req.body;
    const owner_id = req.user!.id;

    // Validate required fields
    if (!name || !season) {
      res.status(400).json({
        success: false,
        message: 'League name and season are required'
      });
      return;
    }

    const league = await createLeague({
      name,
      sport: sport || 'NFL',
      season: parseInt(season),
      owner_id
    });

    res.status(201).json({
      success: true,
      message: `${league.name} league created successfully`,
      league
    });

  } catch (error) {
    console.error('Create league error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error creating league'
    });
  }
};

// =============================================
// GET ALL MY LEAGUES
// GET /api/leagues
// =============================================
export const getAll = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const owner_id = req.user!.id;
    const leagues = await getLeaguesByOwner(owner_id);

    res.status(200).json({
      success: true,
      count: leagues.length,
      leagues
    });

  } catch (error) {
    console.error('Get leagues error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching leagues'
    });
  }
};

// =============================================
// GET SINGLE LEAGUE
// GET /api/leagues/:id
// =============================================
export const getOne = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const league = await getLeagueById(id);

    if (!league) {
      res.status(404).json({
        success: false,
        message: 'League not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      league
    });

  } catch (error) {
    console.error('Get league error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching league'
    });
  }
};

// =============================================
// UPDATE LEAGUE
// PUT /api/leagues/:id
// =============================================
export const update = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { name, sport, season } = req.body;
    const userId = req.user!.id;

    // Verify the user owns this league
    const owns = await isLeagueOwner(id, userId);
    if (!owns) {
      res.status(403).json({
        success: false,
        message: 'Not authorized to update this league'
      });
      return;
    }

    const league = await updateLeague(id, { name, sport, season });

    if (!league) {
      res.status(404).json({
        success: false,
        message: 'League not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'League updated successfully',
      league
    });

  } catch (error) {
    console.error('Update league error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating league'
    });
  }
};

// =============================================
// DELETE LEAGUE
// DELETE /api/leagues/:id
// =============================================
export const remove = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;

    // Verify ownership before deleting
    const owns = await isLeagueOwner(id, userId);
    if (!owns) {
      res.status(403).json({
        success: false,
        message: 'Not authorized to delete this league'
      });
      return;
    }

    const deleted = await deleteLeague(id);

    if (!deleted) {
      res.status(404).json({
        success: false,
        message: 'League not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'League deleted successfully'
    });

  } catch (error) {
    console.error('Delete league error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error deleting league'
    });
  }
};