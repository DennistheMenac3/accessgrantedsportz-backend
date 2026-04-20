import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { getDivisionInfo } from '../config/nflDivisions';

// =============================================
// HELPER FUNCTIONS
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
export const ingestTeams = async (
  leagueId: string,
  teamsData: any[]
): Promise<{ created: number; updated: number; teamIdMap: Map<number, string> }> => {
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
        madden_id = EXCLUDED.madden_id,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, (xmax = 0) AS inserted`,
      [
        uuidv4(), leagueId, team.nickName, team.abbrName, team.cityName, 
        team.overallRating || 70, buildLogoUrl(team.logoId), 
        intToHex(team.primaryColor), intToHex(team.secondaryColor), 
        div?.conference || null, div?.division || null, team.teamId
      ]
    );

    teamIdMap.set(team.teamId, result.rows[0].id);
    if (result.rows[0].inserted) created++; else updated++;
  }

  return { created, updated, teamIdMap };
};

// =============================================
// INGEST PLAYERS
// =============================================
export const ingestPlayers = async (leagueId: string, season: number, rostersData: any[], teamIdMap: Map<number, string>) => {
  let created = 0;
  let updated = 0;
  const playerIdMap = new Map<number, string>();

  for (const player of rostersData) {
    const isFreeAgent = !player.teamId || player.teamId === 0;
    const teamUuid = isFreeAgent ? null : teamIdMap.get(player.teamId);

    if (!isFreeAgent && !teamUuid) continue;

    // EA Payload Mapping Definitions
    const playerOvr = player.playerBestOvr || player.ovr || player.overallRating || 70;
    const playerSpd = player.speed || player.speedRating || 70;
    const playerAge = player.age || 22;

    const upsertResult = await query(
      `INSERT INTO players (
        id, team_id, league_id, madden_id, first_name, last_name, position, 
        overall_rating, age, speed, dev_trait, is_free_agent, is_practice_squad
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (league_id, madden_id) DO UPDATE SET 
        team_id = EXCLUDED.team_id, 
        overall_rating = EXCLUDED.overall_rating,
        age = EXCLUDED.age,
        speed = EXCLUDED.speed, 
        is_free_agent = EXCLUDED.is_free_agent,
        is_practice_squad = EXCLUDED.is_practice_squad,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, (xmax = 0) AS inserted`,
      [
        uuidv4(), teamUuid, leagueId, player.rosterId, player.firstName, player.lastName, 
        normalizePosition(player.position), playerOvr, playerAge, playerSpd, 
        devTraitToString(player.devTrait), isFreeAgent, player.isOnPracticeSquad === true
      ]
    );

    const playerId = upsertResult.rows[0].id;
    playerIdMap.set(player.rosterId, playerId);
    
    if (upsertResult.rows[0].inserted) created++; else updated++;
    await saveTraits(playerId, season, player);
  }
  return { created, updated, playerIdMap, statsProcessed: updated }; 
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

    await query(
      `INSERT INTO games (id, league_id, home_team_id, away_team_id, home_score, away_score, week, season)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (league_id, home_team_id, away_team_id, week, season) DO NOTHING`,
      [uuidv4(), leagueId, homeId, awayId, score.homeScore, score.awayScore, score.weekIndex, score.seasonIndex]
    );

    created++;
    if (score.playerStats) {
      statsProcessed += score.playerStats.length;
    }
  }
  return { created, statsProcessed };
};

// =============================================
// SAVE PLAYER TRAITS
// =============================================
const saveTraits = async (playerId: string, season: number, player: any) => {
  // EA Payload Mapping Definitions
  const playerSpd = player.speed || player.speedRating || 70;
  const playerAwr = player.awareness || player.awarenessRating || 70;
  const playerStr = player.strength || player.strengthRating || 70;

  await query(
    `INSERT INTO player_traits (id, player_id, season, speed, awareness, strength)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (player_id, season) DO UPDATE SET 
        speed = EXCLUDED.speed,
        awareness = EXCLUDED.awareness,
        strength = EXCLUDED.strength,
        updated_at = CURRENT_TIMESTAMP`,
    [uuidv4(), playerId, season, playerSpd, playerAwr, playerStr]
  );
};