import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

// Shape of a Player object
export interface Player {
  id: string;
  team_id: string;
  league_id: string;
  first_name: string;
  last_name: string;
  position: string;
  overall_rating: number;
  age: number;
  speed: number;
  strength: number;
  awareness: number;
  dev_trait: string;
  years_pro: number;
  headshot_url: string | null;
  player_card_url: string | null;
  created_at: Date;
  updated_at: Date;
}

// What we need to create a player
export interface CreatePlayerInput {
  team_id: string;
  league_id: string;
  first_name: string;
  last_name: string;
  position: string;
  overall_rating?: number;
  age?: number;
  speed?: number;
  strength?: number;
  awareness?: number;
  dev_trait?: string;
  years_pro?: number;
  headshot_url?: string;
  player_card_url?: string;
}

// What we need to update a player
export interface UpdatePlayerInput {
  team_id?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  overall_rating?: number;
  age?: number;
  speed?: number;
  strength?: number;
  awareness?: number;
  dev_trait?: string;
  years_pro?: number;
  headshot_url?: string;
  player_card_url?: string;
}

// Create a new player
export const createPlayer = async (
  input: CreatePlayerInput
): Promise<Player> => {
  const result = await query(
    `INSERT INTO players (
      id, team_id, league_id, first_name, last_name,
      position, overall_rating, age, speed, strength,
      awareness, dev_trait, years_pro,
      headshot_url, player_card_url
    )
    VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15
    )
    RETURNING *`,
    [
      uuidv4(),
      input.team_id,
      input.league_id,
      input.first_name,
      input.last_name,
      input.position.toUpperCase(),
      input.overall_rating || 70,
      input.age || 22,
      input.speed || 70,
      input.strength || 70,
      input.awareness || 70,
      input.dev_trait || 'normal',
      input.years_pro || 0,
      input.headshot_url || null,
      input.player_card_url || null
    ]
  );
  return result.rows[0];
};

// Get all players on a team
export const getPlayersByTeam = async (
  team_id: string
): Promise<Player[]> => {
  const result = await query(
    `SELECT p.*,
      t.name as team_name,
      t.abbreviation as team_abbreviation,
      t.team_logo_url,
      t.primary_color,
      pt.height_inches,
      pt.weight_lbs,
      pt.acceleration,
      pt.agility,
      pt.change_of_direction,
      pt.jumping,
      tvh.total_value as trade_value
     FROM players p
     LEFT JOIN teams t ON t.id = p.team_id
     LEFT JOIN player_traits pt ON pt.player_id = p.id
     LEFT JOIN trade_value_history tvh ON tvh.player_id = p.id
     WHERE p.team_id = $1
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
         WHEN 'K'  THEN 10
         WHEN 'P'  THEN 11
         ELSE 12
       END,
       p.overall_rating DESC`,
    [team_id]
  );
  return result.rows;
};

// Get all players in a league
export const getPlayersByLeague = async (
  league_id: string
): Promise<Player[]> => {
  const result = await query(
    `SELECT p.*,
      t.name as team_name,
      t.abbreviation as team_abbreviation,
      t.team_logo_url,
      t.primary_color,
      pt.height_inches,
      pt.weight_lbs,
      tvh.total_value as trade_value
     FROM players p
     LEFT JOIN teams t ON t.id = p.team_id
     LEFT JOIN player_traits pt ON pt.player_id = p.id
     LEFT JOIN trade_value_history tvh ON tvh.player_id = p.id
     WHERE p.league_id = $1
     ORDER BY p.overall_rating DESC`,
    [league_id]
  );
  return result.rows;
};

// Get a single player with full details
export const getPlayerById = async (
  id: string
): Promise<any | null> => {
  // Get player basic info
  const playerResult = await query(
    `SELECT p.*,
      t.name as team_name,
      t.abbreviation as team_abbreviation,
      t.team_logo_url,
      t.primary_color,
      t.secondary_color
     FROM players p
     LEFT JOIN teams t ON t.id = p.team_id
     WHERE p.id = $1`,
    [id]
  );

  if (playerResult.rows.length === 0) return null;

  const player = playerResult.rows[0];

  // Get player traits
  const traitsResult = await query(
    `SELECT * FROM player_traits
     WHERE player_id = $1
     ORDER BY season DESC
     LIMIT 1`,
    [id]
  );

  // Get trade value history
  const tradeValueResult = await query(
    `SELECT * FROM trade_value_history
     WHERE player_id = $1
     ORDER BY calculated_at DESC
     LIMIT 5`,
    [id]
  );

  // Get career stats
  const careerStatsResult = await query(
    `SELECT
      SUM(pass_yards)           as career_pass_yards,
      SUM(pass_touchdowns)      as career_pass_tds,
      SUM(interceptions)        as career_interceptions,
      SUM(rush_yards)           as career_rush_yards,
      SUM(rush_touchdowns)      as career_rush_tds,
      SUM(receptions)           as career_receptions,
      SUM(receiving_yards)      as career_receiving_yards,
      SUM(receiving_touchdowns) as career_receiving_tds,
      SUM(tackles)              as career_tackles,
      SUM(sacks)                as career_sacks,
      SUM(forced_fumbles)       as career_forced_fumbles,
      COUNT(DISTINCT gs.game_id) as games_played
     FROM game_stats gs
     WHERE gs.player_id = $1`,
    [id]
  );

  // Get awards won
  const awardsResult = await query(
    `SELECT aw.*, ad.name as award_name, ad.category
     FROM award_winners aw
     JOIN award_definitions ad ON ad.id = aw.award_id
     WHERE aw.player_id = $1
     ORDER BY aw.season DESC`,
    [id]
  );

  // Get milestones achieved
  const milestonesResult = await query(
    `SELECT pm.*, md.name as milestone_name
     FROM player_milestones pm
     JOIN milestone_definitions md ON md.id = pm.milestone_id
     WHERE pm.player_id = $1
     ORDER BY pm.achieved_at DESC`,
    [id]
  );

  // Combine everything into one player object
  player.traits         = traitsResult.rows[0] || null;
  player.trade_value    = tradeValueResult.rows[0]?.total_value || null;
  player.trade_history  = tradeValueResult.rows;
  player.career_stats   = careerStatsResult.rows[0];
  player.awards         = awardsResult.rows;
  player.milestones     = milestonesResult.rows;

  return player;
};

// Update a player
export const updatePlayer = async (
  id: string,
  input: UpdatePlayerInput
): Promise<Player | null> => {
  const result = await query(
    `UPDATE players
     SET
       team_id        = COALESCE($1,  team_id),
       first_name     = COALESCE($2,  first_name),
       last_name      = COALESCE($3,  last_name),
       position       = COALESCE($4,  position),
       overall_rating = COALESCE($5,  overall_rating),
       age            = COALESCE($6,  age),
       speed          = COALESCE($7,  speed),
       strength       = COALESCE($8,  strength),
       awareness      = COALESCE($9,  awareness),
       dev_trait      = COALESCE($10, dev_trait),
       years_pro      = COALESCE($11, years_pro),
       headshot_url   = COALESCE($12, headshot_url),
       player_card_url = COALESCE($13, player_card_url),
       updated_at     = CURRENT_TIMESTAMP
     WHERE id = $14
     RETURNING *`,
    [
      input.team_id,
      input.first_name,
      input.last_name,
      input.position?.toUpperCase(),
      input.overall_rating,
      input.age,
      input.speed,
      input.strength,
      input.awareness,
      input.dev_trait,
      input.years_pro,
      input.headshot_url,
      input.player_card_url,
      id
    ]
  );
  return result.rows[0] || null;
};

// Delete a player
export const deletePlayer = async (id: string): Promise<boolean> => {
  const result = await query(
    `DELETE FROM players WHERE id = $1`,
    [id]
  );
  return (result.rowCount ?? 0) > 0;
};

// Search players in a league
// Used for trade search and scouting
export const searchPlayers = async (
  league_id: string,
  filters: {
    position?: string;
    min_overall?: number;
    max_overall?: number;
    dev_trait?: string;
    min_age?: number;
    max_age?: number;
    search?: string;
  }
): Promise<Player[]> => {
  let queryText = `
    SELECT p.*,
      t.name as team_name,
      t.abbreviation as team_abbreviation,
      t.team_logo_url,
      t.primary_color,
      pt.height_inches,
      pt.weight_lbs,
      pt.speed as trait_speed,
      pt.acceleration,
      pt.change_of_direction,
      pt.jumping,
      tvh.total_value as trade_value
     FROM players p
     LEFT JOIN teams t ON t.id = p.team_id
     LEFT JOIN player_traits pt ON pt.player_id = p.id
     LEFT JOIN trade_value_history tvh ON tvh.player_id = p.id
     WHERE p.league_id = $1
  `;

  const params: any[] = [league_id];
  let paramCount = 1;

  // Dynamically add filters
  if (filters.position) {
    paramCount++;
    queryText += ` AND p.position = $${paramCount}`;
    params.push(filters.position.toUpperCase());
  }

  if (filters.min_overall) {
    paramCount++;
    queryText += ` AND p.overall_rating >= $${paramCount}`;
    params.push(filters.min_overall);
  }

  if (filters.max_overall) {
    paramCount++;
    queryText += ` AND p.overall_rating <= $${paramCount}`;
    params.push(filters.max_overall);
  }

  if (filters.dev_trait) {
    paramCount++;
    queryText += ` AND p.dev_trait = $${paramCount}`;
    params.push(filters.dev_trait.toLowerCase());
  }

  if (filters.min_age) {
    paramCount++;
    queryText += ` AND p.age >= $${paramCount}`;
    params.push(filters.min_age);
  }

  if (filters.max_age) {
    paramCount++;
    queryText += ` AND p.age <= $${paramCount}`;
    params.push(filters.max_age);
  }

  if (filters.search) {
    paramCount++;
    queryText += ` AND (
      LOWER(p.first_name) LIKE LOWER($${paramCount})
      OR LOWER(p.last_name) LIKE LOWER($${paramCount})
    )`;
    params.push(`%${filters.search}%`);
  }

  queryText += ` ORDER BY p.overall_rating DESC LIMIT 50`;

  const result = await query(queryText, params);
  return result.rows;
};

// Get top players by position in a league
// Used for the War Room scouting report
export const getTopPlayersByPosition = async (
  league_id: string,
  position: string,
  limit: number = 10
): Promise<Player[]> => {
  const result = await query(
    `SELECT p.*,
      t.name as team_name,
      t.abbreviation as team_abbreviation,
      t.team_logo_url,
      t.primary_color,
      pt.height_inches,
      pt.weight_lbs,
      tvh.total_value as trade_value
     FROM players p
     LEFT JOIN teams t ON t.id = p.team_id
     LEFT JOIN player_traits pt ON pt.player_id = p.id
     LEFT JOIN trade_value_history tvh ON tvh.player_id = p.id
     WHERE p.league_id = $1
     AND p.position = $2
     ORDER BY p.overall_rating DESC
     LIMIT $3`,
    [league_id, position.toUpperCase(), limit]
  );
  return result.rows;
};

// Save player traits
// Called every time Madden data is imported
export const savePlayerTraits = async (
  player_id: string,
  season: number,
  traits: any
): Promise<void> => {
  await query(
    `INSERT INTO player_traits (
      id, player_id, season,
      height_inches, weight_lbs,
      speed, acceleration, agility,
      change_of_direction, jumping,
      strength, stamina, awareness,
      injury, toughness,
      throw_power, throw_accuracy_short,
      throw_accuracy_mid, throw_accuracy_deep,
      throw_on_run, play_action, break_sack,
      carrying, break_tackle, trucking,
      spin_move, juke_move, stiff_arm,
      ball_carrier_vision,
      catching, catch_in_traffic,
      route_running_short, route_running_mid,
      route_running_deep, spectacular_catch,
      release,
      pass_block, pass_block_power,
      pass_block_finesse, run_block,
      run_block_power, run_block_finesse,
      impact_blocking,
      tackle, hit_power, pursuit,
      play_recognition, block_shedding,
      power_move, finesse_move,
      man_coverage, zone_coverage,
      press, catch_allowed,
      kick_power, kick_accuracy, kick_return
    )
    VALUES (
      $1, $2, $3,
      $4, $5,
      $6, $7, $8,
      $9, $10,
      $11, $12, $13,
      $14, $15,
      $16, $17,
      $18, $19,
      $20, $21, $22,
      $23, $24, $25,
      $26, $27, $28,
      $29,
      $30, $31,
      $32, $33,
      $34, $35,
      $36,
      $37, $38,
      $39, $40,
      $41, $42,
      $43,
      $44, $45, $46,
      $47, $48,
      $49, $50,
      $51, $52,
      $53, $54,
      $55, $56, $57
    )
    ON CONFLICT (player_id, season)
    DO UPDATE SET
      height_inches          = EXCLUDED.height_inches,
      weight_lbs             = EXCLUDED.weight_lbs,
      speed                  = EXCLUDED.speed,
      acceleration           = EXCLUDED.acceleration,
      agility                = EXCLUDED.agility,
      change_of_direction    = EXCLUDED.change_of_direction,
      jumping                = EXCLUDED.jumping,
      strength               = EXCLUDED.strength,
      stamina                = EXCLUDED.stamina,
      awareness              = EXCLUDED.awareness,
      injury                 = EXCLUDED.injury,
      toughness              = EXCLUDED.toughness,
      throw_power            = EXCLUDED.throw_power,
      throw_accuracy_short   = EXCLUDED.throw_accuracy_short,
      throw_accuracy_mid     = EXCLUDED.throw_accuracy_mid,
      throw_accuracy_deep    = EXCLUDED.throw_accuracy_deep,
      throw_on_run           = EXCLUDED.throw_on_run,
      play_action            = EXCLUDED.play_action,
      break_sack             = EXCLUDED.break_sack,
      carrying               = EXCLUDED.carrying,
      break_tackle           = EXCLUDED.break_tackle,
      trucking               = EXCLUDED.trucking,
      spin_move              = EXCLUDED.spin_move,
      juke_move              = EXCLUDED.juke_move,
      stiff_arm              = EXCLUDED.stiff_arm,
      ball_carrier_vision    = EXCLUDED.ball_carrier_vision,
      catching               = EXCLUDED.catching,
      catch_in_traffic       = EXCLUDED.catch_in_traffic,
      route_running_short    = EXCLUDED.route_running_short,
      route_running_mid      = EXCLUDED.route_running_mid,
      route_running_deep     = EXCLUDED.route_running_deep,
      spectacular_catch      = EXCLUDED.spectacular_catch,
      release                = EXCLUDED.release,
      pass_block             = EXCLUDED.pass_block,
      pass_block_power       = EXCLUDED.pass_block_power,
      pass_block_finesse     = EXCLUDED.pass_block_finesse,
      run_block              = EXCLUDED.run_block,
      run_block_power        = EXCLUDED.run_block_power,
      run_block_finesse      = EXCLUDED.run_block_finesse,
      impact_blocking        = EXCLUDED.impact_blocking,
      tackle                 = EXCLUDED.tackle,
      hit_power              = EXCLUDED.hit_power,
      pursuit                = EXCLUDED.pursuit,
      play_recognition       = EXCLUDED.play_recognition,
      block_shedding         = EXCLUDED.block_shedding,
      power_move             = EXCLUDED.power_move,
      finesse_move           = EXCLUDED.finesse_move,
      man_coverage           = EXCLUDED.man_coverage,
      zone_coverage          = EXCLUDED.zone_coverage,
      press                  = EXCLUDED.press,
      catch_allowed          = EXCLUDED.catch_allowed,
      kick_power             = EXCLUDED.kick_power,
      kick_accuracy          = EXCLUDED.kick_accuracy,
      kick_return            = EXCLUDED.kick_return,
      updated_at             = CURRENT_TIMESTAMP`,
    [
      uuidv4(), player_id, season,
      traits.height_inches, traits.weight_lbs,
      traits.speed, traits.acceleration, traits.agility,
      traits.change_of_direction, traits.jumping,
      traits.strength, traits.stamina, traits.awareness,
      traits.injury, traits.toughness,
      traits.throw_power, traits.throw_accuracy_short,
      traits.throw_accuracy_mid, traits.throw_accuracy_deep,
      traits.throw_on_run, traits.play_action, traits.break_sack,
      traits.carrying, traits.break_tackle, traits.trucking,
      traits.spin_move, traits.juke_move, traits.stiff_arm,
      traits.ball_carrier_vision,
      traits.catching, traits.catch_in_traffic,
      traits.route_running_short, traits.route_running_mid,
      traits.route_running_deep, traits.spectacular_catch,
      traits.release,
      traits.pass_block, traits.pass_block_power,
      traits.pass_block_finesse, traits.run_block,
      traits.run_block_power, traits.run_block_finesse,
      traits.impact_blocking,
      traits.tackle, traits.hit_power, traits.pursuit,
      traits.play_recognition, traits.block_shedding,
      traits.power_move, traits.finesse_move,
      traits.man_coverage, traits.zone_coverage,
      traits.press, traits.catch_allowed,
      traits.kick_power, traits.kick_accuracy, traits.kick_return
    ]
  );
};