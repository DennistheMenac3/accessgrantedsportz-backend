import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import {
  calculateAllAwards,
  getAwardLeaders,
  calculateTeamLeaderStats
} from '../services/awardsService';

export const calculate = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const season   = parseInt(
      req.body.season || req.query.season as string || '1'
    );

    const result = await calculateAllAwards(leagueId, season);

    res.status(200).json({
      success:           true,
      message:           `${result.awards_calculated} awards calculated successfully`,
      season,
      awards_calculated: result.awards_calculated,
      winners:           result.winners,
      team_leaders:      result.team_leaders,
      trapped_gems:      result.trapped_gems,
      trapped_gem_count: result.trapped_gems.length
    });

  } catch (error) {
    console.error('Calculate awards error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error calculating awards'
    });
  }
};

export const getLeaders = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const season   = parseInt(req.params.season as string);

    const leaders = await getAwardLeaders(leagueId, season);

    res.status(200).json({
      success: true,
      season,
      count:  leaders.length,
      awards: leaders
    });

  } catch (error) {
    console.error('Get award leaders error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching award leaders'
    });
  }
};

export const getTrappedGems = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const season   = parseInt(req.params.season as string);

    const { trapped_gems } = await calculateTeamLeaderStats(
      leagueId,
      season
    );

    res.status(200).json({
      success:      true,
      season,
      count:        trapped_gems.length,
      trapped_gems: trapped_gems
    });

  } catch (error) {
    console.error('Get trapped gems error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching trapped gems'
    });
  }
};