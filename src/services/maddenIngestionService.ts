import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { getDivisionInfo } from '../config/nflDivisions';

const intToHex = (colorInt: number): string => {
  if (!colorInt) return '#000000';
  return `#${colorInt.toString(16).padStart(6, '0')}`;
};

const devTraitToString = (trait: number | string): string => {
  const traitMap: { [key: string]: string } = {
    '0': 'normal', '1': 'star', '2': 'superstar', '3': 'xfactor'
  };
  return traitMap[trait?.toString()] || 'normal';
};

const buildLogoUrl = (logoId: number): string =>
  `https://madden-assets-cdn.pulse.ea.com/madden25/logos/${logoId}.png`;

// =============================================
// POSITION NORMALIZATION
// Only normalize HB/FB -> RB
// ALL other positions stored exactly as EA sends
// =============================================
const normalizePosition = (position: string): string => {
  const pos = (position || '').toUpperCase().trim();
  const backfieldMap: { [key: string]: string } = {
    'HB': 'RB',
    'FB': 'RB'
  };
  return backfieldMap[pos] || pos;
};

// =============================================
// SAFE VALUE HELPERS
// Never default to 70 — use null if missing
// =============================================
const safeInt = (player: any, ...fields: string[]): number | null => {
  for (const field of fields) {
    const val = player[field];
    if (val !== undefined && val !== null && val !== '') {
      const parsed = parseInt(val);
      if (!isNaN(parsed)) return parsed;
    }
  }
  return null;
};

const safeStr = (player: any, ...fields: string[]): string | null => {
  for (const field of fields) {
    const val = player[field];
    if (val !== undefined && val !== null && val !== '') {
      return val.toString();
    }
  }
  return null;
};

// =============================================
// INGEST TEAMS
// =============================================
export const ingestTeams = async (
  leagueId: string,
  teamsData: any[]
): Promise<{
  created:    number;
  updated:    number;
  teamIdMap:  Map<number, string>;
  unassigned: any[];
}> => {
  const teamIdMap   = new Map<number, string>();
  const unassigned: any[] = [];
  let created = 0;
  let updated = 0;

  for (const team of teamsData) {
    const abbr     = team.abbrName  || team.abbreviation || '';
    const city     = team.cityName  || team.city         || '';
    const nickname = team.nickName  || team.name         || '';
    const div      = getDivisionInfo(abbr, `${city} ${nickname}`);

    const result = await query(
      `INSERT INTO teams (
        id, league_id, name, abbreviation, city,
        overall_rating, team_logo_url,
        primary_color, secondary_color,
        conference, division, madden_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (league_id, abbreviation) DO UPDATE SET
        overall_rating = EXCLUDED.overall_rating,
        team_logo_url  = EXCLUDED.team_logo_url,
        madden_id      = EXCLUDED.madden_id,
        updated_at     = CURRENT_TIMESTAMP
      RETURNING id, (xmax = 0) AS inserted`,
      [
        uuidv4(), leagueId, nickname, abbr, city,
        team.overallRating || 70,
        buildLogoUrl(team.logoId || 0),
        intToHex(team.primaryColor   || 0),
        intToHex(team.secondaryColor || 0),
        div?.conference || null,
        div?.division   || null,
        team.teamId     || null
      ]
    );

    const teamId = team.teamId || team.madden_id;
    teamIdMap.set(teamId, result.rows[0].id);

    if (result.rows[0].inserted) created++;
    else updated++;

    if (!div?.conference) unassigned.push({ abbr, nickname });
  }

  return { created, updated, teamIdMap, unassigned };
};

// =============================================
// INGEST PLAYERS
// =============================================
export const ingestPlayers = async (
  leagueId:    string,
  season:      number,
  rostersData: any[],
  teamIdMap:   Map<number, string>
): Promise<{
  created:        number;
  updated:        number;
  statsProcessed: number;
  playerIdMap:    Map<number, string>;
}> => {
  let created = 0;
  let updated = 0;
  const playerIdMap = new Map<number, string>();

  for (const player of rostersData) {
    try {
      const isFreeAgent =
        !player.teamId ||
        player.teamId === 0 ||
        player.teamId === -1;

      const teamUuid = isFreeAgent ? null : teamIdMap.get(player.teamId);
      if (!isFreeAgent && !teamUuid) continue;

      const maddenId = player.rosterId  ||
                       player.madden_id  ||
                       player.playerId   ||
                       null;

      if (!maddenId) {
        console.warn(`⚠️ Missing madden_id: ${player.firstName} ${player.lastName}`);
        continue;
      }

      const firstName = safeStr(player, 'firstName', 'first_name') || 'Unknown';
      const lastName  = safeStr(player, 'lastName',  'last_name')  || 'Player';

      // Store exact sub-position — only normalize HB/FB
      const position = normalizePosition(
        safeStr(player, 'position', 'pos') || 'QB'
      );

      // Never default overall or speed — use null
      const overall = safeInt(player,
        'playerBestOvr', 'overallRating', 'overall_rating', 'overall', 'ovr'
      );

      const speed = safeInt(player,
        'speedRating', 'speed_rating', 'speed', 'spd'
      );

      const age            = safeInt(player, 'age', 'playerAge');
      const devTrait       = devTraitToString(
        player.devTrait ?? player.dev_trait ??
        player.developmentTrait ?? 0
      );
      const yearsPro       = safeInt(player, 'yearsPro', 'years_pro', 'experience');
      const contractSalary = safeInt(player, 'contractSalary', 'salary', 'capHit');
      const contractYears  = safeInt(player, 'contractYears', 'yearsLeft');
      const isOnPracticeSquad =
        player.isOnPracticeSquad === true ||
        player.practiceSquad    === true;

      const upsertResult = await query(
        `INSERT INTO players (
          id, team_id, league_id, madden_id,
          first_name, last_name, position,
          overall_rating, age, speed,
          dev_trait, years_pro,
          contract_salary, contract_years,
          is_free_agent, is_practice_squad, portrait_url
        )
        VALUES (
          $1,  $2,  $3,  $4,  $5,  $6,  $7,
          $8,  $9,  $10, $11, $12, $13, $14,
          $15, $16, $17
        )
        ON CONFLICT (league_id, madden_id) DO UPDATE SET
          team_id           = EXCLUDED.team_id,
          position          = EXCLUDED.position,
          overall_rating    = EXCLUDED.overall_rating,
          age               = EXCLUDED.age,
          speed             = EXCLUDED.speed,
          dev_trait         = EXCLUDED.dev_trait,
          years_pro         = EXCLUDED.years_pro,
          contract_salary   = EXCLUDED.contract_salary,
          contract_years    = EXCLUDED.contract_years,
          is_free_agent     = EXCLUDED.is_free_agent,
          is_practice_squad = EXCLUDED.is_practice_squad,
          updated_at        = CURRENT_TIMESTAMP
        RETURNING id, (xmax = 0) AS inserted`,
        [
          uuidv4(), teamUuid, leagueId, maddenId,
          firstName, lastName, position,
          overall, age, speed,
          devTrait, yearsPro,
          contractSalary, contractYears,
          isFreeAgent, isOnPracticeSquad
        ]
      );

      const playerId = upsertResult.rows[0].id;
      playerIdMap.set(maddenId, playerId);

      if (upsertResult.rows[0].inserted) created++;
      else updated++;

      await saveTraits(playerId, season, player);

    } catch (err) {
      console.error(`❌ Error ingesting player:`, err);
    }
  }

  console.log(`✅ Players: ${created} created, ${updated} updated`);
  return { created, updated, statsProcessed: updated, playerIdMap };
};

// =============================================
// INGEST GAMES
// =============================================
export const ingestGames = async (
  leagueId:    string,
  scoresData:  any[],
  teamIdMap:   Map<number, string>,
  playerIdMap: Map<number, string>
): Promise<{ created: number; statsProcessed: number }> => {
  let created        = 0;
  let statsProcessed = 0;

  for (const score of scoresData) {
    const homeId = teamIdMap.get(score.homeTeamId);
    const awayId = teamIdMap.get(score.awayTeamId);
    if (!homeId || !awayId) continue;

    await query(
      `INSERT INTO games (
        id, league_id, home_team_id, away_team_id,
        home_score, away_score, week, season
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (league_id, home_team_id, away_team_id, week, season)
      DO NOTHING`,
      [
        uuidv4(), leagueId, homeId, awayId,
        score.homeScore, score.awayScore,
        score.weekIndex, score.seasonIndex
      ]
    );

    created++;
    if (score.playerStats) statsProcessed += score.playerStats.length;
  }

  return { created, statsProcessed };
};

// =============================================
// SAVE PLAYER TRAITS
// Full attribute set — never default to 70
// =============================================
const saveTraits = async (
  playerId: string,
  season:   number,
  player:   any
): Promise<void> => {
  const s = (...fields: string[]) => safeInt(player, ...fields);

  await query(
    `INSERT INTO player_traits (
      id, player_id, season,
      speed, acceleration, agility,
      strength, awareness, jumping,
      stamina, injury, toughness,
      throw_power, throw_accuracy_short,
      throw_accuracy_mid, throw_accuracy_deep,
      throw_on_run, play_action, break_sack,
      carrying, break_tackle, trucking,
      spin_move, juke_move, stiff_arm,
      ball_carrier_vision,
      catching, catch_in_traffic,
      route_running_short, route_running_mid,
      route_running_deep, spectacular_catch, release,
      pass_block, pass_block_power, pass_block_finesse,
      run_block, run_block_power, run_block_finesse,
      impact_blocking,
      tackle, hit_power, pursuit,
      play_recognition, block_shedding,
      power_move, finesse_move,
      man_coverage, zone_coverage, press,
      kick_power, kick_accuracy, kick_return,
      height_inches, weight_lbs, change_of_direction
    )
    VALUES (
      $1,  $2,  $3,  $4,  $5,  $6,  $7,  $8,  $9,  $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
      $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
      $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
      $41, $42, $43, $44, $45, $46, $47, $48, $49, $50,
      $51, $52, $53, $54, $55
    )
    ON CONFLICT (player_id, season) DO UPDATE SET
      portrait_url         = EXCLUDED.portrait_url,
      speed                = EXCLUDED.speed,
      acceleration         = EXCLUDED.acceleration,
      agility              = EXCLUDED.agility,
      strength             = EXCLUDED.strength,
      awareness            = EXCLUDED.awareness,
      throw_power          = EXCLUDED.throw_power,
      throw_accuracy_short = EXCLUDED.throw_accuracy_short,
      throw_accuracy_mid   = EXCLUDED.throw_accuracy_mid,
      throw_accuracy_deep  = EXCLUDED.throw_accuracy_deep,
      tackle               = EXCLUDED.tackle,
      hit_power            = EXCLUDED.hit_power,
      pursuit              = EXCLUDED.pursuit,
      play_recognition     = EXCLUDED.play_recognition,
      block_shedding       = EXCLUDED.block_shedding,
      power_move           = EXCLUDED.power_move,
      finesse_move         = EXCLUDED.finesse_move,
      man_coverage         = EXCLUDED.man_coverage,
      zone_coverage        = EXCLUDED.zone_coverage,
      catching             = EXCLUDED.catching,
      route_running_mid    = EXCLUDED.route_running_mid,
      updated_at           = CURRENT_TIMESTAMP`,
    [
      uuidv4(), playerId, season,
      s('speedRating',              'speed'),
      s('accelerationRating',       'acceleration', 'accel'),
      s('agilityRating',            'agility'),
      s('strengthRating',           'strength'),
      s('awarenessRating',          'awareness', 'awr'),
      s('jumpingRating',            'jumping'),
      s('staminaRating',            'stamina'),
      s('injuryRating',             'injury'),
      s('toughRating',              'toughness'),
      s('throwPowerRating',         'throwPower'),
      s('throwAccuracyShortRating', 'throwAccuracyShort'),
      s('throwAccuracyMidRating',   'throwAccuracyMid'),
      s('throwAccuracyDeepRating',  'throwAccuracyDeep'),
      s('throwOnRunRating',         'throwOnRun'),
      s('playActionRating',         'playAction'),
      s('breakSackRating',          'breakSack'),
      s('carryingRating',           'carrying'),
      s('breakTackleRating',        'breakTackle'),
      s('truckingRating',           'trucking'),
      s('spinMoveRating',           'spinMove'),
      s('jukeMoveRating',           'jukeMove'),
      s('stiffArmRating',           'stiffArm'),
      s('ballCarrierVisionRating',  'ballCarrierVision'),
      s('catchingRating',           'catching'),
      s('catchInTrafficRating',     'catchInTraffic'),
      s('shortRouteRunningRating',  'routeRunningShort'),
      s('mediumRouteRunningRating', 'routeRunningMid'),
      s('deepRouteRunningRating',   'routeRunningDeep'),
      s('spectacularCatchRating',   'spectacularCatch'),
      s('releaseRating',            'release'),
      s('passBlockRating',          'passBlock'),
      s('passBlockPowerRating',     'passBlockPower'),
      s('passBlockFinesseRating',   'passBlockFinesse'),
      s('runBlockRating',           'runBlock'),
      s('runBlockPowerRating',      'runBlockPower'),
      s('runBlockFinesseRating',    'runBlockFinesse'),
      s('impactBlockRating',        'impactBlocking'),
      s('tackleRating',             'tackle'),
      s('hitPowerRating',           'hitPower'),
      s('pursuitRating',            'pursuit'),
      s('playRecognitionRating',    'playRecognition'),
      s('blockSheddingRating',      'blockShedding'),
      s('powerMoveRating',          'powerMove'),
      s('finesseMoveRating',        'finesseMove'),
      s('manCoverageRating',        'manCoverage'),
      s('zoneCoverageRating',       'zoneCoverage'),
      s('pressRating',              'press'),
      s('kickPowerRating',          'kickPower'),
      s('kickAccuracyRating',       'kickAccuracy'),
      s('kickReturnRating',         'kickReturn'),
      player.height || player.heightInches || null,
      player.weight || player.weightPounds || null,
      s('changeOfDirectionRating',  'changeOfDirection', 'cod')
    ]
  );
};