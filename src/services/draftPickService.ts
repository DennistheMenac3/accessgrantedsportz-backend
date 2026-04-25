// src/services/draftPickService.ts
import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

// =============================================
// SHARED AV MATH
// Re-implemented here so draft picks scale exactly
// like real players without needing circular dependencies
// =============================================
const calculateBaseAV = (ovr: number): number => {
  return Math.round(Math.pow(ovr / 10, 2.8) * 10) / 10;
};

const getAgeBonus = (age: number): number => {
  if (age <= 21) return 80;
  if (age === 22) return 65;
  if (age === 23) return 50;
  if (age === 24) return 35;
  if (age === 25) return 20;
  if (age === 26) return 10;
  if (age === 27) return 0;
  return (27 - age) * 15;
};

const getDevBonus = (dev: string): number => {
  const devMap: { [key: string]: number } = {
    'normal':    0,
    'star':      40,
    'superstar': 120,
    'xfactor':   250
  };
  return devMap[dev?.toLowerCase()] || 0;
};

export interface GhostPlayer {
  overall_rating: number;
  age: number;
  dev_trait: 'normal' | 'star' | 'superstar' | 'xfactor';
}

// =============================================
// 1. GENERATE THE EQUIVALENT "GHOST PLAYER"
// =============================================
export const getEquivalentGhostPlayer = (round: number, pick: number = 16): GhostPlayer => {
  let ovr = 75;
  let age = 21;
  let dev: 'normal' | 'star' | 'superstar' | 'xfactor' = 'normal';

  if (round === 1) {
    if (pick <= 3) {
      ovr = 85; dev = 'xfactor';
    } else if (pick <= 5) {
      ovr = 82; dev = 'superstar';
    } else if (pick <= 10) {
      const drop = Math.floor((pick - 4) / 2);
      ovr = 82 - drop; 
      dev = 'superstar';
    } else if (pick <= 15) {
      if (pick === 11) {
        ovr = 77; dev = 'superstar';
      } else if (pick <= 13) {
        ovr = 76; dev = 'star';
      } else {
        ovr = 75; dev = 'star';
      }
    } else {
      ovr = 75; dev = 'star';
    }
  } else if (round === 2) {
    age = 22; ovr = 75; dev = pick <= 10 ? 'star' : 'normal';
  } else if (round === 3) {
    age = 23; ovr = 74; dev = 'normal';
  } else if (round === 4) {
    age = 22; ovr = 70; dev = 'normal';
  } else if (round === 5) {
    age = 22; ovr = 67; dev = 'normal';
  } else if (round === 6) {
    age = 24; ovr = 65; dev = 'normal';
  } else { 
    age = 24; ovr = 60; dev = 'normal';
  }

  return { overall_rating: ovr, age, dev_trait: dev };
};

// =============================================
// 2. DRAFT PICK VALUE CHART (GHOST PLAYER LOGIC)
// =============================================
export const getDraftPickValue = (
  round:      number,
  pickNumber: number | null,
  yearsOut:   number = 0
): number => {
  const actualPick = pickNumber || 16;
  const ghost = getEquivalentGhostPlayer(round, actualPick);

  const baseAV = calculateBaseAV(ghost.overall_rating);
  const ageB   = getAgeBonus(ghost.age);
  const devB   = getDevBonus(ghost.dev_trait);

  const rawAV  = baseAV + ageB + devB;
  const YEAR_DEPRECIATION_RATE = 0.80; 
  const depreciatedAV = rawAV * Math.pow(YEAR_DEPRECIATION_RATE, yearsOut);

  return Math.max(1, Math.round(depreciatedAV));
};

// =============================================
// 3. UI LABELS & DATABASE FUNCTIONS
// =============================================
export const getPickLabel = (
  round:      number,
  pickNumber: number | null,
  teamAbbr:   string,
  season:     number,
  yearsOut:   number = 0
): string => {
  const roundLabel = round === 1 ? '1st' : round === 2 ? '2nd' : round === 3 ? '3rd' : `${round}th`;
  const pickLabel = pickNumber ? `#${pickNumber}` : 'Unknown slot';
  const yearPrefix = yearsOut === 0 ? season : season + yearsOut;
  return `${yearPrefix} ${teamAbbr} ${roundLabel} Round ${pickLabel}`;
};

export const generateSeasonDraftPicks = async (leagueId: string, season: number): Promise<void> => {
  const teamsResult = await query(`SELECT id FROM teams WHERE league_id = $1`, [leagueId]);
  const teams = teamsResult.rows;

  for (let round = 1; round <= 7; round++) {
    for (let i = 0; i < teams.length; i++) {
      const teamId = teams[i].id;
      const pickNum = i + 1;
      const pickValue = getDraftPickValue(round, pickNum);

      await query(
        `INSERT INTO draft_picks (id, league_id, season, round, pick_number, original_team_id, current_team_id, trade_value)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
        [uuidv4(), leagueId, season, round, pickNum, teamId, teamId, pickValue]
      );
    }
  }
};

export const getTeamDraftPicks = async (teamId: string, leagueId: string, season: number): Promise<any[]> => {
  const result = await query(
    `SELECT dp.*, ot.abbreviation as original_team_abbr, ct.abbreviation as current_team_abbr
     FROM draft_picks dp
     JOIN teams ot ON ot.id = dp.original_team_id
     JOIN teams ct ON ct.id = dp.current_team_id
     WHERE dp.current_team_id = $1 AND dp.league_id = $2 AND dp.season = $3 AND dp.is_used = false
     ORDER BY dp.round ASC, dp.pick_number ASC`,
    [teamId, leagueId, season]
  );
  return result.rows;
};

export const tradeDraftPick = async (pickId: string, newTeamId: string): Promise<void> => {
  await query(
    `UPDATE draft_picks SET current_team_id = $1, is_traded = true, updated_at = NOW() WHERE id = $2`,
    [newTeamId, pickId]
  );
};

export const getLeagueDraftPicks = async (leagueId: string, season: number): Promise<any[]> => {
  const result = await query(
    `SELECT dp.*, ot.abbreviation as original_team_abbr, ct.abbreviation as current_team_abbr
     FROM draft_picks dp
     JOIN teams ot ON ot.id = dp.original_team_id
     JOIN teams ct ON ct.id = dp.current_team_id
     WHERE dp.league_id = $1 AND dp.season = $2 AND dp.is_used = false
     ORDER BY dp.round ASC, dp.pick_number ASC`,
    [leagueId, season]
  );
  return result.rows;
};