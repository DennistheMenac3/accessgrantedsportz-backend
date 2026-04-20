import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { getDivisionInfo } from '../config/nflDivisions';

// =============================================
// Helper Functions
// =============================================
const intToHex = (colorInt: number): string => {
  if (!colorInt) return '#000000';
  const hex = colorInt.toString(16).padStart(6, '0');
  return `#${hex}`;
};

const devTraitToString = (trait: number | string): string => {
  const traitMap: { [key: string]: string } = {
    '0': 'normal', '1': 'star', '2': 'superstar', '3': 'xfactor'
  };
  return traitMap[trait.toString()] || 'normal';
};

const buildLogoUrl = (logoId: number): string => `https://madden-assets-cdn.pulse.ea.com/madden25/logos/${logoId}.png`;
const buildPortraitUrl = (portraitId: number): string => `https://madden-assets-cdn.pulse.ea.com/madden25/portraits/${portraitId}.png`;

const normalizePosition = (position: string): string => {
  const positionMap: { [key: string]: string } = {
    'QB': 'QB', 'HB': 'RB', 'FB': 'RB', 'WR': 'WR', 'TE': 'TE',
    'LT': 'OL', 'LG': 'OL', 'C': 'OL', 'RG': 'OL', 'RT': 'OL',
    'LE': 'DL', 'RE': 'DL', 'DT': 'DL', 'LOLB': 'LB', 'MLB': 'LB',
    'ROLB': 'LB', 'CB': 'CB', 'FS': 'S', 'SS': 'S', 'K': 'K', 'P': 'P'
  };
  return positionMap[position] || position;
};

// =============================================
// INGEST TEAMS
// =============================================
export const ingestTeams = async (leagueId: string, teamsData: any[]) => {
  const teamIdMap = new Map<number, string>();
  let created = 0;
  let updated = 0;

  for (const team of teamsData) {
    const div = getDivisionInfo(team.abbrName || '', `${team.cityName} ${team.nickName}`);
    const result = await query(
      `INSERT INTO teams (
        id, league_id, name, abbreviation, city, overall_rating, 
        team_logo_url, primary_color, secondary_color, conference, division, madden_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (league_id, abbreviation) DO UPDATE SET 
        overall_rating = EXCLUDED.overall_rating, 
        team_logo_url = EXCLUDED.team_logo_url, 
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, (xmax = 0) AS inserted`,
      [uuidv4(), leagueId, team.nickName, team.abbrName, team.cityName, team.overallRating || 70, buildLogoUrl(team.logoId), intToHex(team.primaryColor), intToHex(team.secondaryColor), div?.conference || null, div?.division || null, team.teamId]
    );

    teamIdMap.set(team.teamId, result.rows[0].id);
    if (result.rows[0].inserted) created++; else updated++;
  }
  return { created, updated, teamIdMap, unassigned: [] };
};

// =============================================
// INGEST PLAYERS
// =============================================
export const ingestPlayers = async (leagueId: string, season: number, rostersData: any[], teamIdMap: Map<number, string>) => {
  let created = 0;
  let statsProcessed = 0; // Renamed from 'updated' to satisfy the controller's type check

  for (const player of rostersData) {
    const isFreeAgent = !player.teamId || player.teamId === 0;
    const teamUuid = isFreeAgent ? null : teamIdMap.get(player.teamId);

    if (!isFreeAgent && !teamUuid) continue;

    const upsertResult = await query(
      `INSERT INTO players (
        id, team_id, league_id, madden_id, first_name, last_name, position, 
        overall_rating, age, speed, dev_trait, is_free_agent, is_practice_squad
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (league_id, madden_id) DO UPDATE SET 
        team_id = EXCLUDED.team_id, 
        overall_rating = EXCLUDED.overall_rating, 
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, (xmax = 0) AS inserted`,
      [uuidv4(), teamUuid, leagueId, player.rosterId, player.firstName, player.lastName, normalizePosition(player.position), player.overallRating || 70, player.age || 22, player.speed || 70, devTraitToString(player.devTrait), isFreeAgent, player.isOnPracticeSquad === true]
    );

    if (upsertResult.rows[0].inserted) created++; else statsProcessed++;
    await saveTraits(upsertResult.rows[0].id, season, player);
  }
  return { created, statsProcessed, playerIdMap: new Map() };
};

// =============================================
// INGEST GAMES & STATS
// =============================================
export const ingestGames = async (leagueId: string, scoresData: any[], teamIdMap: Map<number, string>, playerIdMap: Map<number, string>) => {
  let created = 0;
  let statsProcessed = 0;

  for (const score of scoresData) {
    const homeId = teamIdMap.get(score.homeTeamId);
    const awayId = teamIdMap.get(score.awayTeamId);
    if (!homeId || !awayId) continue;

    const gameId = uuidv4();
    await query(
      `INSERT INTO games (id, league_id, home_team_id, away_team_id, home_score, away_score, week, season)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (league_id, home_team_id, away_team_id, week, season) DO NOTHING`,
      [gameId, leagueId, homeId, awayId, score.homeScore, score.awayScore, score.weekIndex, score.seasonIndex]
    );

    created++;
    if (score.playerStats) statsProcessed += score.playerStats.length;
  }
  return { created, statsProcessed };
};

// =============================================
// SAVE PLAYER TRAITS
// =============================================
const saveTraits = async (playerId: string, season: number, player: any) => {
  await query(
    `INSERT INTO player_traits (id, player_id, season, speed, awareness, strength)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (player_id, season) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
    [uuidv4(), playerId, season, player.speed || 70, player.awareness || 70, player.strength || 70]
  );
};