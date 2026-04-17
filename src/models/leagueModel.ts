import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

// Shape of a League object
export interface League {
  id: string;
  name: string;
  owner_id: string;
  sport: string;
  season: number;
  created_at: Date;
  updated_at: Date;
}

// What we need to create a league
export interface CreateLeagueInput {
  name: string;
  sport: string;
  season: number;
  owner_id: string;
}

// What we need to update a league
export interface UpdateLeagueInput {
  name?: string;
  sport?: string;
  season?: number;
}

// Create a new league
export const createLeague = async (
  input: CreateLeagueInput
): Promise<League> => {
  const result = await query(
    `INSERT INTO leagues (id, name, owner_id, sport, season)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [uuidv4(), input.name, input.owner_id, input.sport, input.season]
  );
  return result.rows[0];
};

// Get all leagues owned by a specific user
export const getLeaguesByOwner = async (
  owner_id: string
): Promise<League[]> => {
  const result = await query(
    `SELECT l.*,
      COUNT(DISTINCT t.id) as team_count
     FROM leagues l
     LEFT JOIN teams t ON t.league_id = l.id
     WHERE l.owner_id = $1
     GROUP BY l.id
     ORDER BY l.created_at DESC`,
    [owner_id]
  );
  return result.rows;
};

// Get a single league by ID with full details
export const getLeagueById = async (
  id: string
): Promise<League | null> => {
  const result = await query(
    `SELECT l.*,
      COUNT(DISTINCT t.id) as team_count,
      COUNT(DISTINCT p.id) as player_count,
      COUNT(DISTINCT g.id) as game_count
     FROM leagues l
     LEFT JOIN teams t ON t.league_id = l.id
     LEFT JOIN players p ON p.league_id = l.id
     LEFT JOIN games g ON g.league_id = l.id
     WHERE l.id = $1
     GROUP BY l.id`,
    [id]
  );
  return result.rows[0] || null;
};

// Update a league
export const updateLeague = async (
  id:   string,
  data: {
    name?:               string;
    sport?:              string;
    season?:             number;
    league_logo_url?:    string;
    league_banner_url?:  string;
    discord_guild_id?:   string;
    discord_channel_id?: string;
  }
): Promise<any | null> => {
  const result = await query(
    `UPDATE leagues SET
  name               = COALESCE($1, name),
  sport              = COALESCE($2, sport),
  season             = COALESCE($3, season),
  league_logo_url    = COALESCE($4, league_logo_url),
  league_banner_url  = COALESCE($5, league_banner_url),
  discord_guild_id   = $6,
  discord_channel_id = $7,
  updated_at         = NOW()
WHERE id = $8
RETURNING *`,
    [
      data.name,
      data.sport,
      data.season,
      data.league_logo_url,
      data.league_banner_url,
      data.discord_guild_id,
      data.discord_channel_id,
      id
    ]
  );
  return result.rows[0] || null;
};

// Delete a league
export const deleteLeague = async (id: string): Promise<boolean> => {
  const result = await query(
    `DELETE FROM leagues WHERE id = $1`,
    [id]
  );
  return (result.rowCount ?? 0) > 0;
};

// Check if a user owns a league
// Used to prevent users from editing
// other people's leagues
export const isLeagueOwner = async (
  leagueId: string,
  userId: string
): Promise<boolean> => {
  const result = await query(
    `SELECT id FROM leagues
     WHERE id = $1 AND owner_id = $2`,
    [leagueId, userId]
  );
  return result.rows.length > 0;
};