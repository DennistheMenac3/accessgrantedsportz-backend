import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import {
  createInvite,
  getInviteByCode,
  useInvite,
  getLeagueInvites,
  deactivateInvite
} from '../models/inviteModel';
import { isLeagueOwner } from '../models/leagueModel';
import { query } from '../config/database';

// =============================================
// CREATE INVITE
// POST /api/leagues/:leagueId/invites
// Commissioner only
// =============================================
export const create = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const userId   = req.user!.id;
    const maxUses  = req.body.max_uses || 32;

    const owns = await isLeagueOwner(leagueId, userId);
    if (!owns) {
      res.status(403).json({
        success: false,
        message: 'Only the commissioner can create invites'
      });
      return;
    }

    const invite = await createInvite(leagueId, userId, maxUses);

    const frontendUrl = process.env.FRONTEND_URL || 'https://accessgrantedsportz.com';
    const inviteUrl   = `${frontendUrl}/invite/${invite.invite_code}`;
    const discordMsg  =
      `🏈 **Join ${req.body.league_name || 'our Madden league'} on AccessGrantedSportz!**\n` +
      `Use invite code: **${invite.invite_code}**\n` +
      `Or click: ${inviteUrl}\n` +
      `Expires in 30 days | ${maxUses} spots available`;

    res.status(201).json({
      success:         true,
      message:         'Invite created successfully',
      invite_code:     invite.invite_code,
      invite_url:      inviteUrl,
      expires_at:      invite.expires_at,
      max_uses:        invite.max_uses,
      discord_message: discordMsg
    });

  } catch (error) {
    console.error('Create invite error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error creating invite'
    });
  }
};

// =============================================
// VALIDATE INVITE
// GET /api/invites/:code
// Public — no auth needed
// Shows league info before they register
// =============================================
export const validate = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const code   = req.params.code as string;
    const invite = await getInviteByCode(code);

    if (!invite) {
      res.status(404).json({
        success: false,
        message: 'Invalid or expired invite code'
      });
      return;
    }

    // Get available teams
    const teamsResult = await query(
      `SELECT id, name, abbreviation,
        overall_rating, team_logo_url,
        primary_color, wins, losses
       FROM teams
       WHERE league_id = $1
       AND owner_id IS NULL
       ORDER BY name ASC`,
      [invite.league_id]
    );

    res.status(200).json({
      success: true,
      valid:   true,
      league: {
        id:     invite.league_id,
        name:   invite.league_name,
        sport:  invite.sport,
        season: invite.season
      },
      invite: {
        code:       invite.invite_code,
        expires_at: invite.expires_at,
        spots_left: invite.max_uses - invite.uses
      },
      available_teams: teamsResult.rows
    });

  } catch (error) {
    console.error('Validate invite error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error validating invite'
    });
  }
};

// =============================================
// JOIN LEAGUE
// POST /api/invites/:code/join
// Requires auth — user must be registered
// =============================================
export const join = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const code   = req.params.code as string;
    const userId = req.user!.id;
    const teamId = req.body.team_id as string;

    const invite = await useInvite(code, userId);

    if (!invite) {
      res.status(400).json({
        success: false,
        message: 'Invalid, expired or full invite code'
      });
      return;
    }

    if (teamId) {
      const teamCheck = await query(
        `SELECT owner_id FROM teams WHERE id = $1`,
        [teamId]
      );

      if (teamCheck.rows[0]?.owner_id) {
        res.status(400).json({
          success: false,
          message: 'That team is already taken'
        });
        return;
      }

      await query(
        `UPDATE teams SET
          owner_id       = $1,
          owner_username = $2
         WHERE id = $3
         AND league_id   = $4`,
        [
          userId,
          req.user!.username,
          teamId,
          invite.league_id
        ]
      );

      await query(
        `UPDATE league_members
         SET team_id = $1
         WHERE league_id = $2
         AND user_id     = $3`,
        [teamId, invite.league_id, userId]
      );
    }

    res.status(200).json({
      success:   true,
      message:   `Welcome to ${invite.league_name}!`,
      league_id: invite.league_id,
      team_id:   teamId || null
    });

  } catch (error) {
    console.error('Join league error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error joining league'
    });
  }
};

// =============================================
// GET ALL INVITES
// GET /api/leagues/:leagueId/invites
// Commissioner only
// =============================================
export const getAll = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const userId   = req.user!.id;

    const owns = await isLeagueOwner(leagueId, userId);
    if (!owns) {
      res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
      return;
    }

    const invites = await getLeagueInvites(leagueId);

    res.status(200).json({
      success: true,
      count:   invites.length,
      invites
    });

  } catch (error) {
    console.error('Get invites error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching invites'
    });
  }
};

// =============================================
// GET LEAGUE MEMBERS
// GET /api/leagues/:leagueId/members
// =============================================
export const getMembers = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;

    const result = await query(
      `SELECT
        u.id            as user_id,
        u.username,
        u.email,
        lm.role,
        lm.joined_at,
        t.id            as team_id,
        t.name          as team_name,
        t.abbreviation,
        t.wins,
        t.losses,
        t.overall_rating,
        t.team_logo_url
       FROM league_members lm
       JOIN users u  ON u.id  = lm.user_id
       LEFT JOIN teams t ON t.id = lm.team_id
       WHERE lm.league_id = $1
       ORDER BY lm.joined_at ASC`,
      [leagueId]
    );

    res.status(200).json({
      success: true,
      count:   result.rows.length,
      members: result.rows
    });

  } catch (error) {
    console.error('Get members error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching members'
    });
  }
};

// =============================================
// DEACTIVATE INVITE
// DELETE /api/leagues/:leagueId/invites/:inviteId
// Commissioner only
// =============================================
export const deactivate = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const leagueId = req.params.leagueId as string;
    const inviteId = req.params.inviteId as string;
    const userId   = req.user!.id;

    const owns = await isLeagueOwner(leagueId, userId);
    if (!owns) {
      res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
      return;
    }

    await deactivateInvite(inviteId);

    res.status(200).json({
      success: true,
      message: 'Invite deactivated'
    });

  } catch (error) {
    console.error('Deactivate invite error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error deactivating invite'
    });
  }
};