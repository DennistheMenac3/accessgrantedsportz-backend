import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

// =============================================
// DRAFT PICK VALUE CHART
// Based on Madden community trade standards
// =============================================
export const getDraftPickValue = (
  round:      number,
  pickNumber: number | null
): number => {
  if (round === 1) {
    if (!pickNumber) return 110;
    if (pickNumber <= 3)  return 180;
    if (pickNumber <= 8)  return 150;
    if (pickNumber <= 16) return 120;
    if (pickNumber <= 24) return 95;
    return 75;
  }
  if (round === 2) {
    if (!pickNumber) return 50;
    if (pickNumber <= 8)  return 65;
    if (pickNumber <= 16) return 55;
    if (pickNumber <= 24) return 45;
    return 35;
  }
  if (round === 3) {
    if (!pickNumber) return 24;
    if (pickNumber <= 16) return 28;
    return 20;
  }
  if (round === 4) return 15;
  if (round === 5) return 10;
  if (round === 6) return 7;
  if (round === 7) return 4;
  return 0;
};

// =============================================
// GET PICK LABEL
// Returns human readable pick description
// =============================================
export const getPickLabel = (
  round:       number,
  pickNumber:  number | null,
  teamAbbr:    string,
  season:      number
): string => {
  const roundLabel = 
    round === 1 ? '1st' :
    round === 2 ? '2nd' :
    round === 3 ? '3rd' : `${round}th`;

  const pickLabel = pickNumber
    ? `#${pickNumber}`
    : 'Unknown slot';

  const tier =
    round === 1 && pickNumber && pickNumber <= 3   ? ' (TOP 3)' :
    round === 1 && pickNumber && pickNumber <= 8   ? ' (TOP 10)' :
    round === 1 && pickNumber && pickNumber <= 16  ? ' (TOP 16)' :
    '';

  return `${season} ${teamAbbr} ${roundLabel} Round ${pickLabel}${tier}`;
};

// =============================================
// GENERATE DRAFT PICKS FOR A SEASON
// Creates all 32 picks per round for a league
// =============================================
export const generateSeasonDraftPicks = async (
  leagueId: string,
  season:   number
): Promise<void> => {
  // Get all teams in league
  const teamsResult = await query(
    `SELECT id FROM teams WHERE league_id = $1`,
    [leagueId]
  );

  const teams = teamsResult.rows;

  // Generate 7 rounds of picks
  for (let round = 1; round <= 7; round++) {
    for (let i = 0; i < teams.length; i++) {
      const teamId    = teams[i].id;
      const pickNum   = i + 1;
      const pickValue = getDraftPickValue(round, pickNum);

      await query(
        `INSERT INTO draft_picks (
          id, league_id, season, round,
          pick_number, original_team_id,
          current_team_id, trade_value
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT DO NOTHING`,
        [
          uuidv4(),
          leagueId,
          season,
          round,
          pickNum,
          teamId,
          teamId,
          pickValue
        ]
      );
    }
  }

  console.log(
    `✅ Generated ${teams.length * 7} draft picks for season ${season}`
  );
};

// =============================================
// GET TEAM DRAFT PICKS
// Returns all picks a team currently owns
// =============================================
export const getTeamDraftPicks = async (
  teamId:   string,
  leagueId: string,
  season:   number
): Promise<any[]> => {
  const result = await query(
    `SELECT dp.*,
      ot.abbreviation as original_team_abbr,
      ot.name         as original_team_name,
      ct.abbreviation as current_team_abbr
     FROM draft_picks dp
     JOIN teams ot ON ot.id = dp.original_team_id
     JOIN teams ct ON ct.id = dp.current_team_id
     WHERE dp.current_team_id = $1
     AND dp.league_id          = $2
     AND dp.season              = $3
     AND dp.is_used             = false
     ORDER BY dp.round ASC, dp.pick_number ASC`,
    [teamId, leagueId, season]
  );
  return result.rows;
};

// =============================================
// TRADE DRAFT PICK
// Transfers pick from one team to another
// =============================================
export const tradeDraftPick = async (
  pickId:       string,
  newTeamId:    string
): Promise<void> => {
  await query(
    `UPDATE draft_picks
     SET current_team_id = $1,
         is_traded       = true,
         updated_at      = NOW()
     WHERE id = $2`,
    [newTeamId, pickId]
  );
};

// =============================================
// GET ALL LEAGUE DRAFT PICKS
// Shows full draft board
// =============================================
export const getLeagueDraftPicks = async (
  leagueId: string,
  season:   number
): Promise<any[]> => {
  const result = await query(
    `SELECT dp.*,
      ot.abbreviation as original_team_abbr,
      ot.name         as original_team_name,
      ct.abbreviation as current_team_abbr,
      ct.name         as current_team_name
     FROM draft_picks dp
     JOIN teams ot ON ot.id = dp.original_team_id
     JOIN teams ct ON ct.id = dp.current_team_id
     WHERE dp.league_id = $1
     AND dp.season      = $2
     AND dp.is_used     = false
     ORDER BY dp.round ASC, dp.pick_number ASC`,
    [leagueId, season]
  );
  return result.rows;
};