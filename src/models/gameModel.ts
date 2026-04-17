import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

// Shape of a Game object
export interface Game {
  id: string;
  league_id: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  week: number;
  season: number;
  played_at: Date;
  created_at: Date;
}

// What we need to create a game
export interface CreateGameInput {
  league_id: string;
  home_team_id: string;
  away_team_id: string;
  home_score?: number;
  away_score?: number;
  week: number;
  season: number;
  played_at?: Date;
}

// What we need to submit stats for a game
export interface PlayerStatInput {
  player_id: string;
  team_id: string;
  pass_attempts?: number;
  pass_completions?: number;
  pass_yards?: number;
  pass_touchdowns?: number;
  interceptions?: number;
  rush_attempts?: number;
  rush_yards?: number;
  rush_touchdowns?: number;
  receptions?: number;
  receiving_yards?: number;
  receiving_touchdowns?: number;
  tackles?: number;
  sacks?: number;
  forced_fumbles?: number;
}

// Create a new game
export const createGame = async (
  input: CreateGameInput
): Promise<Game> => {
  const result = await query(
    `INSERT INTO games (
      id, league_id, home_team_id, away_team_id,
      home_score, away_score, week, season, played_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      uuidv4(),
      input.league_id,
      input.home_team_id,
      input.away_team_id,
      input.home_score || 0,
      input.away_score || 0,
      input.week,
      input.season,
      input.played_at || new Date()
    ]
  );
  return result.rows[0];
};

// Get all games in a league
export const getGamesByLeague = async (
  league_id: string,
  filters?: {
    week?: number;
    season?: number;
    team_id?: string;
  }
): Promise<any[]> => {
  let queryText = `
    SELECT g.*,
      ht.name as home_team_name,
      ht.abbreviation as home_team_abbreviation,
      ht.team_logo_url as home_team_logo,
      ht.primary_color as home_team_color,
      at.name as away_team_name,
      at.abbreviation as away_team_abbreviation,
      at.team_logo_url as away_team_logo,
      at.primary_color as away_team_color,
      -- Who won
      CASE
        WHEN g.home_score > g.away_score THEN ht.name
        WHEN g.away_score > g.home_score THEN at.name
        ELSE 'TIE'
      END as winner
    FROM games g
    LEFT JOIN teams ht ON ht.id = g.home_team_id
    LEFT JOIN teams at ON at.id = g.away_team_id
    WHERE g.league_id = $1
  `;

  const params: any[] = [league_id];
  let paramCount = 1;

  if (filters?.week) {
    paramCount++;
    queryText += ` AND g.week = $${paramCount}`;
    params.push(filters.week);
  }

  if (filters?.season) {
    paramCount++;
    queryText += ` AND g.season = $${paramCount}`;
    params.push(filters.season);
  }

  if (filters?.team_id) {
    paramCount++;
    queryText += ` AND (
      g.home_team_id = $${paramCount} OR
      g.away_team_id = $${paramCount}
    )`;
    params.push(filters.team_id);
  }

  queryText += ` ORDER BY g.season DESC, g.week DESC`;

  const result = await query(queryText, params);
  return result.rows;
};

// Get a single game with full box score
export const getGameById = async (
  id: string
): Promise<any | null> => {
  // Get the game
  const gameResult = await query(
    `SELECT g.*,
      ht.name as home_team_name,
      ht.abbreviation as home_team_abbreviation,
      ht.team_logo_url as home_team_logo,
      ht.primary_color as home_team_color,
      at.name as away_team_name,
      at.abbreviation as away_team_abbreviation,
      at.team_logo_url as away_team_logo,
      at.primary_color as away_team_color,
      CASE
        WHEN g.home_score > g.away_score THEN ht.name
        WHEN g.away_score > g.home_score THEN at.name
        ELSE 'TIE'
      END as winner
    FROM games g
    LEFT JOIN teams ht ON ht.id = g.home_team_id
    LEFT JOIN teams at ON at.id = g.away_team_id
    WHERE g.id = $1`,
    [id]
  );

  if (gameResult.rows.length === 0) return null;

  const game = gameResult.rows[0];

  // Get the full box score
  const boxScoreResult = await query(
    `SELECT gs.*,
      p.first_name,
      p.last_name,
      p.position,
      p.overall_rating,
      p.headshot_url,
      t.name as team_name,
      t.abbreviation as team_abbreviation,
      t.team_logo_url,
      t.primary_color
     FROM game_stats gs
     LEFT JOIN players p ON p.id = gs.player_id
     LEFT JOIN teams t ON t.id = gs.team_id
     WHERE gs.game_id = $1
     ORDER BY
       CASE p.position
         WHEN 'QB' THEN 1
         WHEN 'RB' THEN 2
         WHEN 'WR' THEN 3
         WHEN 'TE' THEN 4
         WHEN 'OL' THEN 5
         WHEN 'DL' THEN 6
         WHEN 'LB' THEN 7
         WHEN 'CB' THEN 8
         WHEN 'S'  THEN 9
         ELSE 10
       END,
       gs.pass_yards DESC,
       gs.rush_yards DESC,
       gs.receiving_yards DESC`,
    [id]
  );

  // Split box score by team
  game.home_stats = boxScoreResult.rows.filter(
    (s: any) => s.team_id === game.home_team_id
  );
  game.away_stats = boxScoreResult.rows.filter(
    (s: any) => s.team_id === game.away_team_id
  );

  return game;
};

// Update game score
export const updateGameScore = async (
  id: string,
  home_score: number,
  away_score: number
): Promise<Game | null> => {
  const result = await query(
    `UPDATE games
     SET home_score = $1,
         away_score = $2
     WHERE id = $3
     RETURNING *`,
    [home_score, away_score, id]
  );
  return result.rows[0] || null;
};

// Submit player stats for a game
export const submitGameStats = async (
  game_id: string,
  stats: PlayerStatInput[]
): Promise<void> => {
  // Process each player's stats
  for (const stat of stats) {
    await query(
      `INSERT INTO game_stats (
        id, game_id, player_id, team_id,
        pass_attempts, pass_completions,
        pass_yards, pass_touchdowns,
        interceptions, rush_attempts,
        rush_yards, rush_touchdowns,
        receptions, receiving_yards,
        receiving_touchdowns, tackles,
        sacks, forced_fumbles
      )
      VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18
      )
      ON CONFLICT (game_id, player_id)
      DO UPDATE SET
        pass_attempts         = EXCLUDED.pass_attempts,
        pass_completions      = EXCLUDED.pass_completions,
        pass_yards            = EXCLUDED.pass_yards,
        pass_touchdowns       = EXCLUDED.pass_touchdowns,
        interceptions         = EXCLUDED.interceptions,
        rush_attempts         = EXCLUDED.rush_attempts,
        rush_yards            = EXCLUDED.rush_yards,
        rush_touchdowns       = EXCLUDED.rush_touchdowns,
        receptions            = EXCLUDED.receptions,
        receiving_yards       = EXCLUDED.receiving_yards,
        receiving_touchdowns  = EXCLUDED.receiving_touchdowns,
        tackles               = EXCLUDED.tackles,
        sacks                 = EXCLUDED.sacks,
        forced_fumbles        = EXCLUDED.forced_fumbles`,
      [
        uuidv4(),
        game_id,
        stat.player_id,
        stat.team_id,
        stat.pass_attempts || 0,
        stat.pass_completions || 0,
        stat.pass_yards || 0,
        stat.pass_touchdowns || 0,
        stat.interceptions || 0,
        stat.rush_attempts || 0,
        stat.rush_yards || 0,
        stat.rush_touchdowns || 0,
        stat.receptions || 0,
        stat.receiving_yards || 0,
        stat.receiving_touchdowns || 0,
        stat.tackles || 0,
        stat.sacks || 0,
        stat.forced_fumbles || 0
      ]
    );
  }
};

// Get season stats for a player
export const getPlayerSeasonStats = async (
  player_id: string,
  season: number
): Promise<any> => {
  const result = await query(
    `SELECT
      p.first_name,
      p.last_name,
      p.position,
      p.overall_rating,
      p.headshot_url,
      t.name as team_name,
      t.abbreviation as team_abbreviation,
      t.team_logo_url,
      COUNT(DISTINCT gs.game_id)    as games_played,
      SUM(gs.pass_attempts)         as pass_attempts,
      SUM(gs.pass_completions)      as pass_completions,
      SUM(gs.pass_yards)            as pass_yards,
      SUM(gs.pass_touchdowns)       as pass_touchdowns,
      SUM(gs.interceptions)         as interceptions,
      SUM(gs.rush_attempts)         as rush_attempts,
      SUM(gs.rush_yards)            as rush_yards,
      SUM(gs.rush_touchdowns)       as rush_touchdowns,
      SUM(gs.receptions)            as receptions,
      SUM(gs.receiving_yards)       as receiving_yards,
      SUM(gs.receiving_touchdowns)  as receiving_touchdowns,
      SUM(gs.tackles)               as tackles,
      SUM(gs.sacks)                 as sacks,
      SUM(gs.forced_fumbles)        as forced_fumbles,
      -- Calculated stats
      CASE
        WHEN SUM(gs.pass_attempts) > 0
        THEN ROUND(
          SUM(gs.pass_completions)::decimal /
          SUM(gs.pass_attempts) * 100, 1
        )
        ELSE 0
      END as completion_percentage,
      CASE
        WHEN SUM(gs.rush_attempts) > 0
        THEN ROUND(
          SUM(gs.rush_yards)::decimal /
          SUM(gs.rush_attempts), 1
        )
        ELSE 0
      END as yards_per_carry,
      CASE
        WHEN SUM(gs.receptions) > 0
        THEN ROUND(
          SUM(gs.receiving_yards)::decimal /
          SUM(gs.receptions), 1
        )
        ELSE 0
      END as yards_per_reception
    FROM game_stats gs
    LEFT JOIN players p ON p.id = gs.player_id
    LEFT JOIN teams t ON t.id = gs.team_id
    LEFT JOIN games g ON g.id = gs.game_id
    WHERE gs.player_id = $1
    AND g.season = $2
    GROUP BY
      p.first_name, p.last_name,
      p.position, p.overall_rating,
      p.headshot_url,
      t.name, t.abbreviation,
      t.team_logo_url`,
    [player_id, season]
  );
  return result.rows[0] || null;
};

// Get league leaders for a stat category
export const getLeagueLeaders = async (
  league_id: string,
  season: number,
  stat: string,
  limit: number = 10
): Promise<any[]> => {
  // Whitelist allowed stat columns
  // This prevents SQL injection
  const allowedStats = [
    'pass_yards', 'pass_touchdowns',
    'rush_yards', 'rush_touchdowns',
    'receiving_yards', 'receptions',
    'receiving_touchdowns', 'tackles',
    'sacks', 'forced_fumbles',
    'interceptions'
  ];

  if (!allowedStats.includes(stat)) {
    throw new Error(`Invalid stat column: ${stat}`);
  }

  const result = await query(
    `SELECT
      p.id as player_id,
      p.first_name,
      p.last_name,
      p.position,
      p.overall_rating,
      p.headshot_url,
      t.name as team_name,
      t.abbreviation as team_abbreviation,
      t.team_logo_url,
      t.primary_color,
      SUM(gs.${stat}) as stat_total,
      COUNT(DISTINCT gs.game_id) as games_played
    FROM game_stats gs
    LEFT JOIN players p ON p.id = gs.player_id
    LEFT JOIN teams t ON t.id = p.team_id
    LEFT JOIN games g ON g.id = gs.game_id
    WHERE g.league_id = $1
    AND g.season = $2
    GROUP BY
      p.id, p.first_name, p.last_name,
      p.position, p.overall_rating,
      p.headshot_url,
      t.name, t.abbreviation,
      t.team_logo_url, t.primary_color
    ORDER BY stat_total DESC
    LIMIT $3`,
    [league_id, season, limit]
  );
  return result.rows;
};