import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

// Shape of a Team object
export interface Team {
  id: string;
  league_id: string;
  owner_id: string;
  name: string;
  abbreviation: string;
  city: string;
  overall_rating: number;
  wins: number;
  losses: number;
  team_logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  created_at: Date;
  updated_at: Date;
}

// What we need to create a team
export interface CreateTeamInput {
  league_id: string;
  owner_id: string;
  name: string;
  abbreviation: string;
  city: string;
  overall_rating?: number;
  team_logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
}

// What we need to update a team
export interface UpdateTeamInput {
  name?: string;
  abbreviation?: string;
  city?: string;
  overall_rating?: number;
  wins?: number;
  losses?: number;
  team_logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
}

// Create a new team
export const createTeam = async (
  input: CreateTeamInput
): Promise<Team> => {
  const result = await query(
    `INSERT INTO teams 
      (id, league_id, owner_id, name, abbreviation, 
       city, overall_rating, team_logo_url,
       primary_color, secondary_color)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      uuidv4(),
      input.league_id,
      input.owner_id,
      input.name,
      input.abbreviation,
      input.city,
      input.overall_rating || 70,
      input.team_logo_url || null,
      input.primary_color || '#000000',
      input.secondary_color || '#FFFFFF'
    ]
  );
  return result.rows[0];
};

// Get all teams in a league
export const getTeamsByLeague = async (
  league_id: string
): Promise<Team[]> => {
  const result = await query(
    `SELECT t.*,
      COUNT(DISTINCT p.id) as player_count,
      u.username as owner_username
     FROM teams t
     LEFT JOIN players p ON p.team_id = t.id
     LEFT JOIN users u ON u.id = t.owner_id
     WHERE t.league_id = $1
     GROUP BY t.id, u.username
     ORDER BY t.wins DESC, t.losses ASC`,
    [league_id]
  );
  return result.rows;
};

// Get a single team by ID
export const getTeamById = async (
  id: string
): Promise<Team | null> => {
  const result = await query(
    `SELECT t.*,
      u.username as owner_username,
      COUNT(DISTINCT p.id) as player_count,
      COUNT(DISTINCT g.id) as games_played
     FROM teams t
     LEFT JOIN users u ON u.id = t.owner_id
     LEFT JOIN players p ON p.team_id = t.id
     LEFT JOIN games g ON 
       (g.home_team_id = t.id OR g.away_team_id = t.id)
     WHERE t.id = $1
     GROUP BY t.id, u.username`,
    [id]
  );
  return result.rows[0] || null;
};

// Get team with full player roster
export const getTeamWithRoster = async (
  id: string
): Promise<any | null> => {
  // First get the team
  const teamResult = await query(
    `SELECT t.*, u.username as owner_username
     FROM teams t
     LEFT JOIN users u ON u.id = t.owner_id
     WHERE t.id = $1`,
    [id]
  );

  if (teamResult.rows.length === 0) return null;

  const team = teamResult.rows[0];

  // Then get the full roster
  const rosterResult = await query(
    `SELECT p.*,
      pt.speed, pt.acceleration, pt.strength,
      pt.awareness, pt.height_inches, pt.weight_lbs,
      pt.change_of_direction, pt.jumping,
      tvh.total_value as trade_value
     FROM players p
     LEFT JOIN player_traits pt ON 
       pt.player_id = p.id
     LEFT JOIN trade_value_history tvh ON
       tvh.player_id = p.id
     WHERE p.team_id = $1
     ORDER BY p.overall_rating DESC`,
    [id]
  );

  // Attach roster to team object
  team.roster = rosterResult.rows;

  return team;
};

// Update a team
export const updateTeam = async (
  id: string,
  input: UpdateTeamInput
): Promise<Team | null> => {
  const result = await query(
    `UPDATE teams
     SET
       name             = COALESCE($1, name),
       abbreviation     = COALESCE($2, abbreviation),
       city             = COALESCE($3, city),
       overall_rating   = COALESCE($4, overall_rating),
       wins             = CASE 
                            WHEN $5::integer IS NOT NULL 
                            THEN wins + $5::integer
                            ELSE wins 
                          END,
       losses           = CASE 
                            WHEN $6::integer IS NOT NULL 
                            THEN losses + $6::integer
                            ELSE losses 
                          END,
       team_logo_url    = COALESCE($7, team_logo_url),
       primary_color    = COALESCE($8, primary_color),
       secondary_color  = COALESCE($9, secondary_color),
       updated_at       = CURRENT_TIMESTAMP
     WHERE id = $10
     RETURNING *`,
    [
      input.name        ?? null,
      input.abbreviation ?? null,
      input.city        ?? null,
      input.overall_rating ?? null,
      input.wins        ?? null,
      input.losses      ?? null,
      input.team_logo_url ?? null,
      input.primary_color ?? null,
      input.secondary_color ?? null,
      id
    ]
  );
  return result.rows[0] || null;
};

// Delete a team
export const deleteTeam = async (id: string): Promise<boolean> => {
  const result = await query(
    `DELETE FROM teams WHERE id = $1`,
    [id]
  );
  return (result.rowCount ?? 0) > 0;
};

// Check if a user owns a team
export const isTeamOwner = async (
  teamId: string,
  userId: string
): Promise<boolean> => {
  const result = await query(
    `SELECT id FROM teams
     WHERE id = $1 AND owner_id = $2`,
    [teamId, userId]
  );
  return result.rows.length > 0;
};

// Get standings for a league
export const getStandings = async (
  league_id: string
): Promise<any[]> => {
  const result = await query(
    `SELECT 
      t.id,
      t.name,
      t.abbreviation,
      t.city,
      t.wins,
      t.losses,
      t.overall_rating,
      t.team_logo_url,
      t.primary_color,
      t.secondary_color,
      u.username as owner_username,
      CASE 
        WHEN (t.wins + t.losses) = 0 THEN 0
        ELSE ROUND(
          t.wins::decimal / (t.wins + t.losses) * 100, 1
        )
      END as win_percentage,
      COALESCE(SUM(
        CASE 
          WHEN g.home_team_id = t.id THEN g.home_score
          WHEN g.away_team_id = t.id THEN g.away_score
          ELSE 0
        END
      ), 0) as points_scored,
      COALESCE(SUM(
        CASE 
          WHEN g.home_team_id = t.id THEN g.away_score
          WHEN g.away_team_id = t.id THEN g.home_score
          ELSE 0
        END
      ), 0) as points_allowed
     FROM teams t
     LEFT JOIN users u ON u.id = t.owner_id
     LEFT JOIN games g ON 
       (g.home_team_id = t.id OR g.away_team_id = t.id)
     WHERE t.league_id = $1
     GROUP BY t.id, u.username
     ORDER BY t.wins DESC, win_percentage DESC`,
    [league_id]
  );
  return result.rows;
};