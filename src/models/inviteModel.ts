import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

// =============================================
// Generate a random invite code
// Short and easy to share — like RAVENS2024
// =============================================
const generateInviteCode = (): string => {
  const chars    = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segments = [4, 4];
  return segments
    .map(len =>
      Array.from(
        { length: len },
        () => chars[Math.floor(Math.random() * chars.length)]
      ).join('')
    )
    .join('-');
};

// =============================================
// Create a new invite for a league
// =============================================
export const createInvite = async (
  leagueId:  string,
  createdBy: string,
  maxUses:   number = 32
): Promise<any> => {
  const inviteCode = generateInviteCode();

  const result = await query(
    `INSERT INTO league_invites (
      id, league_id, invite_code,
      created_by, max_uses
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *`,
    [uuidv4(), leagueId, inviteCode, createdBy, maxUses]
  );

  return result.rows[0];
};

// =============================================
// Get invite by code
// =============================================
export const getInviteByCode = async (
  code: string
): Promise<any | null> => {
  const result = await query(
    `SELECT li.*,
      l.name as league_name,
      l.sport,
      l.season,
      u.username as created_by_username
     FROM league_invites li
     JOIN leagues l ON l.id = li.league_id
     JOIN users u ON u.id = li.created_by
     WHERE li.invite_code = UPPER($1)
     AND li.is_active = true
     AND li.expires_at > NOW()
     AND li.uses < li.max_uses`,
    [code]
  );
  return result.rows[0] || null;
};

// =============================================
// Use an invite code
// Called when someone joins via invite
// =============================================
export const useInvite = async (
  code:    string,
  userId:  string
): Promise<any | null> => {
  const invite = await getInviteByCode(code);
  if (!invite) return null;

  // Increment usage count
  await query(
    `UPDATE league_invites
     SET uses = uses + 1
     WHERE invite_code = UPPER($1)`,
    [code]
  );

  // Add user to league members
  await query(
    `INSERT INTO league_members (
      id, league_id, user_id, role
    )
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (league_id, user_id) DO NOTHING`,
    [uuidv4(), invite.league_id, userId, 'member']
  );

  return invite;
};

// =============================================
// Get all invites for a league
// =============================================
export const getLeagueInvites = async (
  leagueId: string
): Promise<any[]> => {
  const result = await query(
    `SELECT li.*,
      u.username as created_by_username
     FROM league_invites li
     JOIN users u ON u.id = li.created_by
     WHERE li.league_id = $1
     ORDER BY li.created_at DESC`,
    [leagueId]
  );
  return result.rows;
};

// =============================================
// Deactivate an invite
// =============================================
export const deactivateInvite = async (
  inviteId: string
): Promise<void> => {
  await query(
    `UPDATE league_invites
     SET is_active = false
     WHERE id = $1`,
    [inviteId]
  );
};