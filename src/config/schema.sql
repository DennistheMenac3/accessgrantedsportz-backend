-- =============================================
-- AccessGrantedSportz Database Schema
-- =============================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Leagues table
CREATE TABLE IF NOT EXISTS leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  owner_id UUID REFERENCES users(id),
  sport VARCHAR(50) DEFAULT 'NFL',
  season INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  abbreviation VARCHAR(10),
  city VARCHAR(100),
  overall_rating INTEGER,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Players table
CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  league_id UUID REFERENCES leagues(id),
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  position VARCHAR(10) NOT NULL,
  overall_rating INTEGER,
  age INTEGER,
  speed INTEGER,
  strength INTEGER,
  awareness INTEGER,
  dev_trait VARCHAR(20),
  years_pro INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Games table
CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id),
  home_team_id UUID REFERENCES teams(id),
  away_team_id UUID REFERENCES teams(id),
  home_score INTEGER DEFAULT 0,
  away_score INTEGER DEFAULT 0,
  week INTEGER,
  season INTEGER,
  played_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Game Stats table
CREATE TABLE IF NOT EXISTS game_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  player_id UUID REFERENCES players(id),
  team_id UUID REFERENCES teams(id),
  pass_attempts INTEGER DEFAULT 0,
  pass_completions INTEGER DEFAULT 0,
  pass_yards INTEGER DEFAULT 0,
  pass_touchdowns INTEGER DEFAULT 0,
  interceptions INTEGER DEFAULT 0,
  rush_attempts INTEGER DEFAULT 0,
  rush_yards INTEGER DEFAULT 0,
  rush_touchdowns INTEGER DEFAULT 0,
  receptions INTEGER DEFAULT 0,
  receiving_yards INTEGER DEFAULT 0,
  receiving_touchdowns INTEGER DEFAULT 0,
  tackles INTEGER DEFAULT 0,
  sacks DECIMAL(4,1) DEFAULT 0,
  forced_fumbles INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- Player Physical Traits
-- =============================================
CREATE TABLE IF NOT EXISTS player_traits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES players(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  -- Physical Measurements
  height_inches INTEGER,
  weight_lbs INTEGER,
  -- Universal Athletic Traits
  speed INTEGER,
  acceleration INTEGER,
  agility INTEGER,
  change_of_direction INTEGER,
  jumping INTEGER,
  strength INTEGER,
  stamina INTEGER,
  awareness INTEGER,
  injury INTEGER,
  toughness INTEGER,
  -- QB Traits
  throw_power INTEGER,
  throw_accuracy_short INTEGER,
  throw_accuracy_mid INTEGER,
  throw_accuracy_deep INTEGER,
  throw_on_run INTEGER,
  play_action INTEGER,
  break_sack INTEGER,
  -- RB Traits
  carrying INTEGER,
  break_tackle INTEGER,
  trucking INTEGER,
  spin_move INTEGER,
  juke_move INTEGER,
  stiff_arm INTEGER,
  ball_carrier_vision INTEGER,
  -- WR/TE Receiving Traits
  catching INTEGER,
  catch_in_traffic INTEGER,
  route_running_short INTEGER,
  route_running_mid INTEGER,
  route_running_deep INTEGER,
  spectacular_catch INTEGER,
  release INTEGER,
  -- Blocking Traits
  pass_block INTEGER,
  pass_block_power INTEGER,
  pass_block_finesse INTEGER,
  run_block INTEGER,
  run_block_power INTEGER,
  run_block_finesse INTEGER,
  impact_blocking INTEGER,
  -- Defensive Traits
  tackle INTEGER,
  hit_power INTEGER,
  pursuit INTEGER,
  play_recognition INTEGER,
  block_shedding INTEGER,
  power_move INTEGER,
  finesse_move INTEGER,
  man_coverage INTEGER,
  zone_coverage INTEGER,
  press INTEGER,
  catch_allowed INTEGER,
  -- Kicking Traits
  kick_power INTEGER,
  kick_accuracy INTEGER,
  kick_return INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(player_id, season)
);

-- =============================================
-- Position Physical Benchmarks
-- =============================================
CREATE TABLE IF NOT EXISTS position_physical_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position VARCHAR(10) NOT NULL,
  ideal_height_min_inches INTEGER,
  ideal_height_max_inches INTEGER,
  ideal_weight_min_lbs INTEGER,
  ideal_weight_max_lbs INTEGER,
  height_weight INTEGER DEFAULT 5,
  weight_weight INTEGER DEFAULT 5,
  cod_weight INTEGER DEFAULT 5,
  jumping_weight INTEGER DEFAULT 5,
  acceleration_weight INTEGER DEFAULT 5,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(position)
);

-- =============================================
-- Awards System
-- =============================================
CREATE TABLE IF NOT EXISTS award_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL,
  position_eligible VARCHAR(255),
  formula TEXT,
  is_custom BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS award_winners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  award_id UUID REFERENCES award_definitions(id),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  player_id UUID REFERENCES players(id),
  team_id UUID REFERENCES teams(id),
  award_score DECIMAL(10,2),
  stats_snapshot JSONB,
  ai_announcement TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(award_id, league_id, season)
);

-- =============================================
-- Records System
-- =============================================
CREATE TABLE IF NOT EXISTS record_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  stat_column VARCHAR(100) NOT NULL,
  record_type VARCHAR(20) NOT NULL,
  scope VARCHAR(20) DEFAULT 'league',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_definition_id UUID REFERENCES record_definitions(id),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  player_id UUID REFERENCES players(id),
  team_id UUID REFERENCES teams(id),
  value DECIMAL(10,2) NOT NULL,
  season INTEGER,
  week INTEGER,
  game_id UUID REFERENCES games(id),
  previous_value DECIMAL(10,2),
  previous_player_id UUID REFERENCES players(id),
  previous_season INTEGER,
  ai_announcement TEXT,
  set_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- Milestones System
-- =============================================
CREATE TABLE IF NOT EXISTS milestone_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  stat_column VARCHAR(100) NOT NULL,
  threshold DECIMAL(10,2) NOT NULL,
  milestone_type VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS player_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID REFERENCES milestone_definitions(id),
  player_id UUID REFERENCES players(id),
  league_id UUID REFERENCES leagues(id),
  season INTEGER NOT NULL,
  week INTEGER,
  game_id UUID REFERENCES games(id),
  value_achieved DECIMAL(10,2),
  ai_announcement TEXT,
  achieved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- Custom League Awards
-- =============================================
CREATE TABLE IF NOT EXISTS custom_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50),
  formula JSONB,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS custom_award_winners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_award_id UUID REFERENCES custom_awards(id),
  league_id UUID REFERENCES leagues(id),
  season INTEGER NOT NULL,
  player_id UUID REFERENCES players(id),
  team_id UUID REFERENCES teams(id),
  award_score DECIMAL(10,2),
  stats_snapshot JSONB,
  ai_announcement TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- Trade Value System
-- =============================================
CREATE TABLE IF NOT EXISTS position_trait_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position VARCHAR(10) NOT NULL,
  trait_name VARCHAR(50) NOT NULL,
  weight DECIMAL(5,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(position, trait_name)
);

CREATE TABLE IF NOT EXISTS dev_trait_multipliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dev_trait VARCHAR(20) NOT NULL UNIQUE,
  multiplier DECIMAL(4,2) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trade_value_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES players(id),
  league_id UUID REFERENCES leagues(id),
  season INTEGER NOT NULL,
  week INTEGER,
  base_value DECIMAL(10,2),
  trait_bonus DECIMAL(10,2),
  award_bonus DECIMAL(10,2),
  statistical_trend_bonus DECIMAL(10,2),
  dev_trait_multiplier DECIMAL(4,2),
  total_value DECIMAL(10,2),
  value_breakdown JSONB,
  calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trade_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id),
  proposing_team_id UUID REFERENCES teams(id),
  receiving_team_id UUID REFERENCES teams(id),
  status VARCHAR(20) DEFAULT 'pending',
  total_value_offered DECIMAL(10,2),
  total_value_requested DECIMAL(10,2),
  ai_analysis TEXT,
  proposed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trade_proposal_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID REFERENCES trade_proposals(id) ON DELETE CASCADE,
  direction VARCHAR(10) NOT NULL,
  player_id UUID REFERENCES players(id),
  trade_value_at_time DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS award_trade_bonuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  award_definition_id UUID REFERENCES award_definitions(id),
  bonus_value DECIMAL(10,2) NOT NULL,
  bonus_description TEXT,
  is_stackable BOOLEAN DEFAULT false,
  seasons_valid INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS comeback_eligibility_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES players(id),
  league_id UUID REFERENCES leagues(id),
  season INTEGER NOT NULL,
  is_eligible BOOLEAN DEFAULT false,
  years_pro INTEGER,
  prev_season_score DECIMAL(10,2),
  curr_season_score DECIMAL(10,2),
  decline_percentage DECIMAL(5,2),
  ineligibility_reason TEXT,
  calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(player_id, league_id, season)
);

-- =============================================
-- Indexes for Performance
-- =============================================
CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_players_league ON players(league_id);
CREATE INDEX IF NOT EXISTS idx_games_league ON games(league_id);
CREATE INDEX IF NOT EXISTS idx_game_stats_game ON game_stats(game_id);
CREATE INDEX IF NOT EXISTS idx_game_stats_player ON game_stats(player_id);
CREATE INDEX IF NOT EXISTS idx_award_winners_league ON award_winners(league_id);
CREATE INDEX IF NOT EXISTS idx_award_winners_season ON award_winners(season);
CREATE INDEX IF NOT EXISTS idx_records_league ON records(league_id);
CREATE INDEX IF NOT EXISTS idx_milestones_player ON player_milestones(player_id);
CREATE INDEX IF NOT EXISTS idx_player_traits_player ON player_traits(player_id);
CREATE INDEX IF NOT EXISTS idx_trade_value_player ON trade_value_history(player_id);
CREATE INDEX IF NOT EXISTS idx_trade_value_league ON trade_value_history(league_id);
CREATE INDEX IF NOT EXISTS idx_trade_proposals_league ON trade_proposals(league_id);
CREATE INDEX IF NOT EXISTS idx_comeback_eligibility ON comeback_eligibility_log(player_id, league_id, season);