import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

// =============================================
// Helper Functions
// =============================================

// Convert Madden integer color to hex string
// eg 2365299 → #241773
const intToHex = (colorInt: number): string => {
  if (!colorInt) return '#000000';
  const hex = colorInt.toString(16).padStart(6, '0');
  return `#${hex}`;
};

// Convert Madden dev trait number to string
const devTraitToString = (trait: number): string => {
  const traits: { [key: number]: string } = {
    0: 'normal',
    1: 'star',
    2: 'superstar',
    3: 'xfactor'
  };
  return traits[trait] || 'normal';
};

// Build team logo URL from logoId
const buildLogoUrl = (logoId: number): string => {
  return `https://madden-assets-cdn.pulse.ea.com/madden25/logos/${logoId}.png`;
};

// Build player portrait URL from portraitId
const buildPortraitUrl = (portraitId: number): string => {
  return `https://madden-assets-cdn.pulse.ea.com/madden25/portraits/${portraitId}.png`;
};

// Convert Madden position string to our format
const normalizePosition = (position: string): string => {
  const positionMap: { [key: string]: string } = {
    'QB':  'QB',
    'HB':  'RB',
    'FB':  'RB',
    'WR':  'WR',
    'TE':  'TE',
    'LT':  'OL',
    'LG':  'OL',
    'C':   'OL',
    'RG':  'OL',
    'RT':  'OL',
    'LE':  'DL',
    'RE':  'DL',
    'DT':  'DL',
    'LOLB':'LB',
    'MLB': 'LB',
    'ROLB':'LB',
    'CB':  'CB',
    'FS':  'S',
    'SS':  'S',
    'K':   'K',
    'P':   'P'
  };
  return positionMap[position] || position;
};

// =============================================
// Main Ingestion Functions
// =============================================

// Process teams from Madden export
export const ingestTeams = async (
  leagueId: string,
  teamsData: any[]
): Promise<{
  created: number;
  updated: number;
  teamIdMap: Map<number, string>;
}> => {
  let created = 0;
  let updated = 0;

  // Map Madden teamId to our UUID
  // We need this to link players and games
  const teamIdMap = new Map<number, string>();

  for (const team of teamsData) {
    // Check if team already exists in our league
    const existing = await query(
      `SELECT id FROM teams
       WHERE league_id = $1
       AND abbreviation = $2`,
      [leagueId, team.abbrName]
    );

    if (existing.rows.length > 0) {
      // Update existing team
      const teamId = existing.rows[0].id;
      teamIdMap.set(team.teamId, teamId);

      await query(
        `UPDATE teams SET
          name            = $1,
          city            = $2,
          overall_rating  = $3,
          team_logo_url   = $4,
          primary_color   = $5,
          secondary_color = $6,
          updated_at      = CURRENT_TIMESTAMP
         WHERE id = $7`,
        [
          team.nickName,
          team.cityName,
          team.overallRating || 70,
          buildLogoUrl(team.logoId),
          intToHex(team.primaryColor),
          intToHex(team.secondaryColor),
          teamId
        ]
      );
      updated++;
    } else {
      // Create new team
      const newId = uuidv4();
      teamIdMap.set(team.teamId, newId);

      await query(
        `INSERT INTO teams (
          id, league_id, owner_id, name,
          abbreviation, city, overall_rating,
          team_logo_url, primary_color, secondary_color
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          newId,
          leagueId,
          // Get league owner as default team owner
          (await query(
            'SELECT owner_id FROM leagues WHERE id = $1',
            [leagueId]
          )).rows[0]?.owner_id,
          team.nickName,
          team.abbrName,
          team.cityName,
          team.overallRating || 70,
          buildLogoUrl(team.logoId),
          intToHex(team.primaryColor),
          intToHex(team.secondaryColor)
        ]
      );
      created++;
    }
  }

  return { created, updated, teamIdMap };
};

// Process players from Madden export
export const ingestPlayers = async (
  leagueId: string,
  season: number,
  rostersData: any[],
  teamIdMap: Map<number, string>
): Promise<{
  created: number;
  updated: number;
  playerIdMap: Map<number, string>;
}> => {
  let created = 0;
  let updated = 0;

  // Map Madden rosterId to our UUID
  const playerIdMap = new Map<number, string>();

  for (const player of rostersData) {
    const teamId = teamIdMap.get(player.teamId);
    if (!teamId) continue;

    const position = normalizePosition(player.position);
    const devTrait = devTraitToString(player.devTrait);
    const portraitUrl = player.portraitId
      ? buildPortraitUrl(player.portraitId)
      : null;

    // Check if player already exists
    const existing = await query(
      `SELECT id FROM players
       WHERE league_id = $1
       AND first_name = $2
       AND last_name = $3
       AND position = $4`,
      [leagueId, player.firstName, player.lastName, position]
    );

    let playerId: string;

    if (existing.rows.length > 0) {
      // Update existing player
      playerId = existing.rows[0].id;
      playerIdMap.set(player.rosterId, playerId);

      await query(
        `UPDATE players SET
          team_id        = $1,
          overall_rating = $2,
          age            = $3,
          speed          = $4,
          strength       = $5,
          awareness      = $6,
          dev_trait      = $7,
          years_pro      = $8,
          headshot_url   = $9,
          updated_at     = CURRENT_TIMESTAMP
         WHERE id = $10`,
        [
          teamId,
          player.overallRating || 70,
          player.age || 22,
          player.speed || 70,
          player.strength || 70,
          player.awareness || 70,
          devTrait,
          player.yearsPro || 0,
          portraitUrl,
          playerId
        ]
      );
      updated++;
    } else {
      // Create new player
      playerId = uuidv4();
      playerIdMap.set(player.rosterId, playerId);

      await query(
        `INSERT INTO players (
          id, team_id, league_id,
          first_name, last_name, position,
          overall_rating, age, speed,
          strength, awareness, dev_trait,
          years_pro, headshot_url
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12,
          $13, $14
        )`,
        [
          playerId,
          teamId,
          leagueId,
          player.firstName,
          player.lastName,
          position,
          player.overallRating || 70,
          player.age || 22,
          player.speed || 70,
          player.strength || 70,
          player.awareness || 70,
          devTrait,
          player.yearsPro || 0,
          portraitUrl
        ]
      );
      created++;
    }

    // Save full player traits
    await saveTraits(playerId, season, player);
  }

  return { created, updated, playerIdMap };
};

// Save all player traits from Madden data
const saveTraits = async (
  playerId: string,
  season: number,
  player: any
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
      $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15,
      $16, $17, $18, $19, $20, $21, $22,
      $23, $24, $25, $26, $27, $28, $29,
      $30, $31, $32, $33, $34, $35, $36,
      $37, $38, $39, $40, $41, $42, $43,
      $44, $45, $46, $47, $48,
      $49, $50, $51, $52, $53, $54,
      $55, $56, $57
    )
    ON CONFLICT (player_id, season)
    DO UPDATE SET
      height_inches        = EXCLUDED.height_inches,
      weight_lbs           = EXCLUDED.weight_lbs,
      speed                = EXCLUDED.speed,
      acceleration         = EXCLUDED.acceleration,
      agility              = EXCLUDED.agility,
      change_of_direction  = EXCLUDED.change_of_direction,
      jumping              = EXCLUDED.jumping,
      strength             = EXCLUDED.strength,
      stamina              = EXCLUDED.stamina,
      awareness            = EXCLUDED.awareness,
      injury               = EXCLUDED.injury,
      toughness            = EXCLUDED.toughness,
      throw_power          = EXCLUDED.throw_power,
      throw_accuracy_short = EXCLUDED.throw_accuracy_short,
      throw_accuracy_mid   = EXCLUDED.throw_accuracy_mid,
      throw_accuracy_deep  = EXCLUDED.throw_accuracy_deep,
      throw_on_run         = EXCLUDED.throw_on_run,
      play_action          = EXCLUDED.play_action,
      break_sack           = EXCLUDED.break_sack,
      carrying             = EXCLUDED.carrying,
      break_tackle         = EXCLUDED.break_tackle,
      trucking             = EXCLUDED.trucking,
      spin_move            = EXCLUDED.spin_move,
      juke_move            = EXCLUDED.juke_move,
      stiff_arm            = EXCLUDED.stiff_arm,
      ball_carrier_vision  = EXCLUDED.ball_carrier_vision,
      catching             = EXCLUDED.catching,
      catch_in_traffic     = EXCLUDED.catch_in_traffic,
      route_running_short  = EXCLUDED.route_running_short,
      route_running_mid    = EXCLUDED.route_running_mid,
      route_running_deep   = EXCLUDED.route_running_deep,
      spectacular_catch    = EXCLUDED.spectacular_catch,
      release              = EXCLUDED.release,
      pass_block           = EXCLUDED.pass_block,
      pass_block_power     = EXCLUDED.pass_block_power,
      pass_block_finesse   = EXCLUDED.pass_block_finesse,
      run_block            = EXCLUDED.run_block,
      run_block_power      = EXCLUDED.run_block_power,
      run_block_finesse    = EXCLUDED.run_block_finesse,
      impact_blocking      = EXCLUDED.impact_blocking,
      tackle               = EXCLUDED.tackle,
      hit_power            = EXCLUDED.hit_power,
      pursuit              = EXCLUDED.pursuit,
      play_recognition     = EXCLUDED.play_recognition,
      block_shedding       = EXCLUDED.block_shedding,
      power_move           = EXCLUDED.power_move,
      finesse_move         = EXCLUDED.finesse_move,
      man_coverage         = EXCLUDED.man_coverage,
      zone_coverage        = EXCLUDED.zone_coverage,
      press                = EXCLUDED.press,
      catch_allowed        = EXCLUDED.catch_allowed,
      kick_power           = EXCLUDED.kick_power,
      kick_accuracy        = EXCLUDED.kick_accuracy,
      kick_return          = EXCLUDED.kick_return,
      updated_at           = CURRENT_TIMESTAMP`,
    [
      uuidv4(), playerId, season,
      player.height        || null,
      player.weight        || null,
      player.speed         || null,
      player.acceleration  || null,
      player.agility       || null,
      player.changeOfDirection || player.agility || null,
      player.jumping       || null,
      player.strength      || null,
      player.stamina       || null,
      player.awareness     || null,
      player.injury        || null,
      player.toughness     || null,
      player.throwPower    || null,
      player.throwAccuracyShort || null,
      player.throwAccuracyMid   || null,
      player.throwAccuracyDeep  || null,
      player.throwOnRun    || null,
      player.playAction    || null,
      player.breakSack     || null,
      player.carrying      || null,
      player.breakTackle   || null,
      player.trucking      || null,
      player.spinMove      || null,
      player.jukeMove      || null,
      player.stiffArm      || null,
      player.ballCarrierVision || null,
      player.catching      || null,
      player.catchInTraffic || null,
      player.routeRunningShort || null,
      player.routeRunningMid   || null,
      player.routeRunningDeep  || null,
      player.spectacularCatch  || null,
      player.release       || null,
      player.passBlock     || null,
      player.passBlockPower || null,
      player.passBlockFinesse || null,
      player.runBlock      || null,
      player.runBlockPower || null,
      player.runBlockFinesse || null,
      player.impactBlocking || null,
      player.tackle        || null,
      player.hitPower      || null,
      player.pursuit       || null,
      player.playRecognition || null,
      player.blockShedding || null,
      player.powerMove     || null,
      player.finesseMove   || null,
      player.manCoverage   || null,
      player.zoneCoverage  || null,
      player.press         || null,
      player.catchAllowed  || null,
      player.kickPower     || null,
      player.kickAccuracy  || null,
      player.kickReturn    || null
    ]
  );
};

// Process games and stats from Madden export
export const ingestGames = async (
  leagueId: string,
  scoresData: any[],
  teamIdMap: Map<number, string>,
  playerIdMap: Map<number, string>
): Promise<{
  created: number;
  statsProcessed: number;
}> => {
  let created = 0;
  let statsProcessed = 0;

  for (const score of scoresData) {
    const homeTeamId = teamIdMap.get(score.homeTeamId);
    const awayTeamId = teamIdMap.get(score.awayTeamId);

    if (!homeTeamId || !awayTeamId) continue;

    // Check if game already exists
    const existing = await query(
      `SELECT id FROM games
       WHERE league_id = $1
       AND home_team_id = $2
       AND away_team_id = $3
       AND week = $4
       AND season = $5`,
      [
        leagueId,
        homeTeamId,
        awayTeamId,
        score.weekIndex,
        score.seasonIndex
      ]
    );

    let gameId: string;

    if (existing.rows.length > 0) {
      gameId = existing.rows[0].id;

      // Update score
      await query(
        `UPDATE games SET
          home_score = $1,
          away_score = $2
         WHERE id = $3`,
        [score.homeScore, score.awayScore, gameId]
      );
    } else {
      // Create new game
      gameId = uuidv4();

      await query(
        `INSERT INTO games (
          id, league_id, home_team_id,
          away_team_id, home_score, away_score,
          week, season, played_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          gameId,
          leagueId,
          homeTeamId,
          awayTeamId,
          score.homeScore,
          score.awayScore,
          score.weekIndex,
          score.seasonIndex
        ]
      );

      // Update team win/loss records
      if (score.homeScore > score.awayScore) {
        await query(
          `UPDATE teams SET wins = wins + 1 WHERE id = $1`,
          [homeTeamId]
        );
        await query(
          `UPDATE teams SET losses = losses + 1 WHERE id = $1`,
          [awayTeamId]
        );
      } else if (score.awayScore > score.homeScore) {
        await query(
          `UPDATE teams SET wins = wins + 1 WHERE id = $1`,
          [awayTeamId]
        );
        await query(
          `UPDATE teams SET losses = losses + 1 WHERE id = $1`,
          [homeTeamId]
        );
      }

      created++;
    }

    // Process player stats for this game
    if (score.playerStats && score.playerStats.length > 0) {
      for (const stat of score.playerStats) {
        const playerId = playerIdMap.get(stat.rosterId);
        const teamId = teamIdMap.get(stat.teamId);

        if (!playerId || !teamId) continue;

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
            pass_attempts        = EXCLUDED.pass_attempts,
            pass_completions     = EXCLUDED.pass_completions,
            pass_yards           = EXCLUDED.pass_yards,
            pass_touchdowns      = EXCLUDED.pass_touchdowns,
            interceptions        = EXCLUDED.interceptions,
            rush_attempts        = EXCLUDED.rush_attempts,
            rush_yards           = EXCLUDED.rush_yards,
            rush_touchdowns      = EXCLUDED.rush_touchdowns,
            receptions           = EXCLUDED.receptions,
            receiving_yards      = EXCLUDED.receiving_yards,
            receiving_touchdowns = EXCLUDED.receiving_touchdowns,
            tackles              = EXCLUDED.tackles,
            sacks                = EXCLUDED.sacks,
            forced_fumbles       = EXCLUDED.forced_fumbles`,
          [
            uuidv4(),
            gameId,
            playerId,
            teamId,
            stat.passAtt      || 0,
            stat.passComp     || 0,
            stat.passYds      || 0,
            stat.passTDs      || 0,
            stat.passInts     || 0,
            stat.rushAtt      || 0,
            stat.rushYds      || 0,
            stat.rushTDs      || 0,
            stat.recCatches   || 0,
            stat.recYds       || 0,
            stat.recTDs       || 0,
            stat.defTackles   || 0,
            stat.defSacks     || 0,
            stat.defForcedFum || 0
          ]
        );
        statsProcessed++;
      }
    }
  }

  return { created, statsProcessed };
};