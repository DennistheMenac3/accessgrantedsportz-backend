-- =============================================
-- Migration 001 — Add Image Fields
-- =============================================

-- Add image fields to teams table
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS team_logo_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS team_banner_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS primary_color VARCHAR(7) DEFAULT '#000000',
  ADD COLUMN IF NOT EXISTS secondary_color VARCHAR(7) DEFAULT '#FFFFFF';

-- Add image fields to players table
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS headshot_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS player_card_url VARCHAR(500);

-- Add image fields to leagues table
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS league_logo_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS league_banner_url VARCHAR(500);

  -- Migration 002 — Add unique constraint to game_stats
ALTER TABLE game_stats
  ADD CONSTRAINT unique_game_player
  UNIQUE (game_id, player_id);

  -- Migration 004 — Add contract fields to players
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS contract_years INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS contract_salary DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contract_year_current INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_on_rookie_deal BOOLEAN DEFAULT false;

-- Storylines table to store all AI generated content
CREATE TABLE IF NOT EXISTS storylines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  storyline_type VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_storylines_league 
  ON storylines(league_id, season, week);
CREATE INDEX IF NOT EXISTS idx_storylines_type 
  ON storylines(storyline_type);

  -- Migration 005 — Add Discord guild ID to leagues
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS discord_guild_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS discord_channel_id VARCHAR(100);

  -- Migration 006 — League invite system
CREATE TABLE IF NOT EXISTS league_invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id    UUID REFERENCES leagues(id) ON DELETE CASCADE,
  invite_code  VARCHAR(20) UNIQUE NOT NULL,
  created_by   UUID REFERENCES users(id),
  max_uses     INTEGER DEFAULT 32,
  uses         INTEGER DEFAULT 0,
  expires_at   TIMESTAMP DEFAULT (NOW() + INTERVAL '30 days'),
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_league_invites_code
  ON league_invites(invite_code);

CREATE INDEX IF NOT EXISTS idx_league_invites_league
  ON league_invites(league_id);

-- Add owner_id to teams so members can claim teams
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS owner_username VARCHAR(100),
  ADD COLUMN IF NOT EXISTS discord_user_id VARCHAR(100);

-- Add league_role to users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS discord_user_id VARCHAR(100);

  -- Migration 006b — League members table
CREATE TABLE IF NOT EXISTS league_members (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  user_id   UUID REFERENCES users(id)   ON DELETE CASCADE,
  role      VARCHAR(20) DEFAULT 'member',
  team_id   UUID REFERENCES teams(id),
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(league_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_league_members_league
  ON league_members(league_id);
CREATE INDEX IF NOT EXISTS idx_league_members_user
  ON league_members(user_id);