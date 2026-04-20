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
    '0': 'normal',
    '1': 'star',
    '2': 'superstar',
    '3': 'xfactor'
  };
  return traitMap[trait.toString()] || 'normal';
};

const buildLogoUrl = (logoId: number): string => {
  return `https://madden-assets-cdn.pulse.ea.com/madden25/logos/${logoId}.png`;
};

const buildPortraitUrl = (portraitId: number): string => {
  return `https://madden-assets-cdn.pulse.ea.com/madden25/portraits/${portraitId}.png`;
};

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

  for (const team of teamsData) {
    const divisionInfo = getDivisionInfo(team.abbrName || '', `${team.cityName} ${team.nickName}`);
    const newId = uuidv4();

    const result = await query(
      `INSERT INTO teams (
        id, league_id, name, abbreviation, city, 
        overall_rating, team_logo_url, primary_color, 
        secondary_color, conference, division, madden_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (league_id, abbreviation) DO UPDATE SET
        overall_rating = EXCLUDED.overall_rating,
        team_logo_url = EXCLUDED.team_logo_url,
        madden_id = EXCLUDED.madden_id,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id`,
      [
        newId, leagueId, team.nickName, team.abbrName, team.cityName,
        team.overallRating || 70, buildLogoUrl(team.logoId),
        intToHex(team.primaryColor), intToHex(team.secondaryColor),
        divisionInfo?.conference || null, divisionInfo?.division || null,
        team.teamId
      ]
    );

    teamIdMap.set(team.teamId, result.rows[0].id);
  }

  return { created: 0, updated: teamsData.length, teamIdMap };
};

// =============================================
// INGEST PLAYERS
// =============================================
export const ingestPlayers = async (
  leagueId: string,
  season: number,
  rostersData: any[],
  teamIdMap: Map<number, string>
): Promise<{ created: number; updated: number; playerIdMap: Map<number, string> }> => {
  let created = 0;
  let updated = 0;
  const playerIdMap = new Map<number, string>();

  for (const player of rostersData) {
    // 1. Determine Status (Free Agent vs Team Member)
    const isFreeAgent = !player.teamId || player.teamId === 0;
    const isPracticeSquad = player.isOnPracticeSquad === true;
    let teamUuid = isFreeAgent ? null : teamIdMap.get(player.teamId);

    // Skip if they are supposed to be on a team but we don't have that team yet
    if (!isFreeAgent && !teamUuid) continue;

    // 2. Format Data
    const position = normalizePosition(player.position);
    const devTrait = devTraitToString(player.devTrait);
    const portraitUrl = player.portraitId ? buildPortraitUrl(player.portraitId) : null;
    const currentContractYear = (player.contractLength && player.contractYearsLeft)
      ? (player.contractLength - player.contractYearsLeft + 1)
      : 1;

    // 3. TRUE Upsert
    const upsertResult = await query(
      `INSERT INTO players (
        id, team_id, league_id, madden_id, first_name, last_name, position,
        overall_rating, age, speed, strength, awareness, dev_trait, years_pro,
        headshot_url, contract_years, contract_salary, contract_bonus,
        contract_year_current, is_on_rookie_deal, is_free_agent, is_practice_squad
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      ON CONFLICT (league_id, madden_id) DO UPDATE SET
        team_id = EXCLUDED.team_id,
        overall_rating = EXCLUDED.overall_rating,
        position = EXCLUDED.position,
        age = EXCLUDED.age,
        dev_trait = EXCLUDED.dev_trait,
        is_free_agent = EXCLUDED.is_free_agent,
        is_practice_squad = EXCLUDED.is_practice_squad,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, (xmax = 0) AS inserted`,
      [
        uuidv4(), teamUuid, leagueId, player.rosterId, player.firstName, player.lastName,
        position, player.overallRating || 70, player.age || 22, player.speed || 70,
        player.strength || 70, player.awareness || 70, devTrait, player.yearsPro || 0,
        portraitUrl, player.contractLength || 1, player.contractSalary || 0,
        player.contractBonus || 0, currentContractYear, 
        (player.yearsPro <= 1), isFreeAgent, isPracticeSquad
      ]
    );

    const playerId = upsertResult.rows[0].id;
    playerIdMap.set(player.rosterId, playerId);

    if (upsertResult.rows[0].inserted) created++; else updated++;

    // Save detailed attributes
    await saveTraits(playerId, season, player);
  }

  return { created, updated, playerIdMap };
};

// =============================================
// SAVE PLAYER TRAITS (ATTRIBUTES)
// =============================================
const saveTraits = async (playerId: string, season: number, player: any) => {
  await query(
    `INSERT INTO player_traits (
      id, player_id, season, height_inches, weight_lbs, speed, acceleration, agility,
      jumping, strength, stamina, awareness, toughness, throw_power, tackle, hit_power
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    ON CONFLICT (player_id, season) DO UPDATE SET
      speed = EXCLUDED.speed, awareness = EXCLUDED.awareness, updated_at = CURRENT_TIMESTAMP`,
    [
      uuidv4(), playerId, season, player.height, player.weight, player.speed,
      player.acceleration, player.agility, player.jumping, player.strength,
      player.stamina, player.awareness, player.toughness, player.throwPower,
      player.tackle, player.hitPower
    ]
  );
};

// =============================================
// INGEST GAMES & STATS
// =============================================
export const ingestGames = async (
  leagueId: string,
  scoresData: any[],
  teamIdMap: Map<number, string>,
  playerIdMap: Map<number, string>
) => {
  for (const score of scoresData) {
    const homeId = teamIdMap.get(score.homeTeamId);
    const awayId = teamIdMap.get(score.awayTeamId);
    if (!homeId || !awayId) continue;

    await query(
      `INSERT INTO games (id, league_id, home_team_id, away_team_id, home_score, away_score, week, season)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (league_id, home_team_id, away_team_id, week, season) DO UPDATE SET
       home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score`,
      [uuidv4(), leagueId, homeId, awayId, score.homeScore, score.awayScore, score.weekIndex, score.seasonIndex]
    );
  }
  return { created: 0, updated: scoresData.length };
};