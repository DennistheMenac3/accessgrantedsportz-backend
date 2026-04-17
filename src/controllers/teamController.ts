import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import {
  createTeam,
  getTeamsByLeague,
  getTeamById,
  getTeamWithRoster,
  updateTeam,
  deleteTeam,
  isTeamOwner,
  getStandings
} from '../models/teamModel';

// =============================================
// CREATE TEAM
// POST /api/leagues/:leagueId/teams
// =============================================
export const create = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const { 
      name, 
      abbreviation, 
      city, 
      overall_rating,
      team_logo_url,
      primary_color,
      secondary_color
    } = req.body;
    const owner_id = req.user!.id;

    // Validate required fields
    if (!name || !abbreviation || !city) {
      res.status(400).json({
        success: false,
        message: 'Team name, abbreviation and city are required'
      });
      return;
    }

    // Abbreviation should be 2-4 characters
    if (abbreviation.length < 2 || abbreviation.length > 4) {
      res.status(400).json({
        success: false,
        message: 'Abbreviation must be 2-4 characters'
      });
      return;
    }

    const team = await createTeam({
      league_id: leagueId,
      owner_id,
      name,
      abbreviation: abbreviation.toUpperCase(),
      city,
      overall_rating,
      team_logo_url,
      primary_color,
      secondary_color
    });

    res.status(201).json({
      success: true,
      message: `${team.city} ${team.name} created successfully`,
      team
    });

  } catch (error) {
    console.error('Create team error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error creating team'
    });
  }
};

// =============================================
// GET ALL TEAMS IN LEAGUE
// GET /api/leagues/:leagueId/teams
// =============================================
export const getAll = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const teams = await getTeamsByLeague(leagueId);

    res.status(200).json({
      success: true,
      count: teams.length,
      teams
    });

  } catch (error) {
    console.error('Get teams error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching teams'
    });
  }
};

// =============================================
// GET SINGLE TEAM
// GET /api/leagues/:leagueId/teams/:id
// =============================================
export const getOne = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;

    // Get team with full roster
    const team = await getTeamWithRoster(id);

    if (!team) {
      res.status(404).json({
        success: false,
        message: 'Team not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      team
    });

  } catch (error) {
    console.error('Get team error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching team'
    });
  }
};

// =============================================
// GET STANDINGS
// GET /api/leagues/:leagueId/teams/standings
// =============================================
export const standings = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const standingsData = await getStandings(leagueId);

    res.status(200).json({
      success: true,
      count: standingsData.length,
      standings: standingsData
    });

  } catch (error) {
    console.error('Get standings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching standings'
    });
  }
};

// =============================================
// UPDATE TEAM
// PUT /api/leagues/:leagueId/teams/:id
// =============================================
export const update = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { 
      name, 
      abbreviation, 
      city, 
      overall_rating, 
      wins, 
      losses,
      team_logo_url,
      primary_color,
      secondary_color
    } = req.body;
    const userId = req.user!.id;

    // Verify ownership
    const owns = await isTeamOwner(id, userId);
    if (!owns) {
      res.status(403).json({
        success: false,
        message: 'Not authorized to update this team'
      });
      return;
    }

    const team = await updateTeam(id, {
      name,
      abbreviation: abbreviation?.toUpperCase(),
      city,
      overall_rating,
      wins,
      losses,
      team_logo_url,
      primary_color,
      secondary_color
    });

    if (!team) {
      res.status(404).json({
        success: false,
        message: 'Team not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Team updated successfully',
      team
    });

  } catch (error) {
    console.error('Update team error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating team'
    });
  }
};

// =============================================
// DELETE TEAM
// DELETE /api/leagues/:leagueId/teams/:id
// =============================================
export const remove = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.id;

    // Verify ownership
    const owns = await isTeamOwner(id, userId);
    if (!owns) {
      res.status(403).json({
        success: false,
        message: 'Not authorized to delete this team'
      });
      return;
    }

    const deleted = await deleteTeam(id);

    if (!deleted) {
      res.status(404).json({
        success: false,
        message: 'Team not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Team deleted successfully'
    });

  } catch (error) {
    console.error('Delete team error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error deleting team'
    });
  }
};