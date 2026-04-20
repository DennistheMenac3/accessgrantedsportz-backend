import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

// =============================================
// MACRO POSITION RESOLVER
// Maps exact Madden sub-positions to TVS groups
// EA uses REDGE/LEDGE not REDG/LEDG
// =============================================
export const getMacroPosition = (pos: string): string => {
  const p = (pos || '').toUpperCase().trim();

  const olPositions = ['LT', 'LG', 'C', 'RG', 'RT'];
  const dlPositions = ['LE', 'RE', 'DT', 'LEDG', 'REDG', 'LEDGE', 'REDGE'];
  const lbPositions = ['LOLB', 'MLB', 'ROLB', 'SAM', 'MIKE', 'WILL'];
  const cbPositions = ['CB'];
  const sPositions  = ['FS', 'SS'];

  if (olPositions.includes(p)) return 'OL';
  if (dlPositions.includes(p)) return 'DL';
  if (lbPositions.includes(p)) return 'LB';
  if (cbPositions.includes(p)) return 'CB';
  if (sPositions.includes(p))  return 'S';

  return p;
};

// =============================================
// AGE CURVE MULTIPLIER
// =============================================
const getAgeCurveMultiplier = (age: number): number => {
  if (age <= 21) return 1.30;
  if (age === 22) return 1.25;
  if (age === 23) return 1.20;
  if (age === 24) return 1.15;
  if (age === 25) return 1.10;
  if (age === 26) return 1.05;
  if (age === 27) return 1.00;
  if (age === 28) return 0.95;
  if (age === 29) return 0.88;
  if (age === 30) return 0.80;
  if (age === 31) return 0.70;
  if (age === 32) return 0.60;
  if (age === 33) return 0.50;
  if (age === 34) return 0.40;
  return 0.30;
};

// =============================================
// DEV TRAIT AGE BONUS
// =============================================
const getDevTraitAgeBonus = (
  age:      number,
  devTrait: string
): number => {
  if (devTrait === 'normal') {
    if (age >= 30) return -5;
    if (age >= 27) return -2;
    return 0;
  }
  if (devTrait === 'star') {
    if (age <= 21) return 8;
    if (age <= 23) return 6;
    if (age <= 25) return 4;
    if (age <= 27) return 2;
    if (age <= 29) return 0;
    return -2;
  }
  if (devTrait === 'superstar') {
    if (age <= 21) return 20;
    if (age <= 23) return 16;
    if (age <= 25) return 12;
    if (age <= 27) return 8;
    if (age <= 29) return 4;
    if (age <= 31) return 2;
    return 0;
  }
  if (devTrait === 'xfactor') {
    if (age <= 21) return 35;
    if (age <= 23) return 28;
    if (age <= 25) return 22;
    if (age <= 27) return 16;
    if (age <= 29) return 10;
    if (age <= 31) return 5;
    return 2;
  }
  return 0;
};

// =============================================
// POSITION VALUE MULTIPLIER
// Uses MACRO positions for math
// =============================================
const getPositionMultiplier = (position: string): number => {
  const multipliers: { [key: string]: number } = {
    'QB': 1.40,
    'WR': 1.15,
    'CB': 1.15,
    'LB': 1.10,
    'RB': 1.10,
    'TE': 1.05,
    'S':  1.05,
    'DL': 1.00,
    'OL': 1.00,
    'K':  0.60,
    'P':  0.60,
    'LS': 0.40
  };
  return multipliers[position] || 1.00;
};

// =============================================
// SPEED BONUS — Uses MACRO positions
// =============================================
const calculateSpeedBonus = (
  position: string,
  speed:    number,
  strength: number,
  weight:   number
): number => {
  if (position === 'QB') {
    if (speed >= 90) return 20;
    if (speed >= 87) return 14;
    if (speed >= 83) return 8;
    if (speed >= 78) return 3;
    if (speed >= 73) return 0;
    return -3;
  }
  if (position === 'RB') {
    if (speed >= 97) return 30;
    if (speed >= 95) return 25;
    if (speed >= 93) return 20;
    if (speed >= 91) return 14;
    if (speed >= 90) return 8;
    if (speed >= 87) return 0;
    if (speed >= 83) return -8;
    return -15;
  }
  if (position === 'WR') {
    if (speed >= 98) return 35;
    if (speed >= 96) return 28;
    if (speed >= 94) return 20;
    if (speed >= 91) return 10;
    if (speed >= 88) return 2;
    if (speed >= 85) return -5;
    return -12;
  }
  if (position === 'TE') {
    if (speed >= 93) return 28;
    if (speed >= 90) return 22;
    if (speed >= 87) return 15;
    if (speed >= 84) return 7;
    if (speed >= 80) return 0;
    if (speed >= 76) return -5;
    return -10;
  }
  if (position === 'OL') {
    if (speed >= 75) return 12;
    if (speed >= 72) return 8;
    if (speed >= 69) return 4;
    if (speed >= 67) return 0;
    if (speed >= 64) return -3;
    return -6;
  }
  if (position === 'DL') {
    const isDT = weight >= 310;
    if (isDT) {
      const strengthBonus =
        strength >= 90 ? 12 :
        strength >= 85 ? 8  :
        strength >= 80 ? 4  : 0;
      const weightBonus =
        weight >= 340 ? 8 :
        weight >= 325 ? 5 :
        weight >= 310 ? 2 : 0;
      if (speed >= 83) return 15 + strengthBonus + weightBonus;
      if (speed >= 78) return 8  + strengthBonus + weightBonus;
      if (speed >= 74) return 3  + strengthBonus + weightBonus;
      if (speed >= 70) return 0  + strengthBonus + weightBonus;
      return -4 + strengthBonus + weightBonus;
    } else {
      if (speed >= 90) return 28;
      if (speed >= 87) return 20;
      if (speed >= 86) return 15;
      if (speed >= 83) return 8;
      if (speed >= 80) return 2;
      if (speed >= 77) return -3;
      return -8;
    }
  }
  if (position === 'LB') {
    if (speed >= 94) return 25;
    if (speed >= 92) return 18;
    if (speed >= 90) return 12;
    if (speed >= 89) return 7;
    if (speed >= 86) return 0;
    if (speed >= 83) return -5;
    return -10;
  }
  if (position === 'CB') {
    if (speed >= 98) return 35;
    if (speed >= 96) return 28;
    if (speed >= 94) return 20;
    if (speed >= 91) return 8;
    if (speed >= 88) return 0;
    if (speed >= 85) return -8;
    return -15;
  }
  if (position === 'S') {
    if (speed >= 96) return 28;
    if (speed >= 93) return 20;
    if (speed >= 90) return 10;
    if (speed >= 87) return 2;
    if (speed >= 84) return -5;
    return -12;
  }
  return 0;
};

// =============================================
// PHYSICAL TRAIT SCORE
// Uses MACRO position for benchmark lookups
// =============================================
const calculateTraitScore = async (
  playerId: string,
  macroPosition: string
): Promise<number> => {
  const traitsResult = await query(
    `SELECT pt.*,
      ppb.ideal_height_min_inches,
      ppb.ideal_height_max_inches,
      ppb.ideal_weight_min_lbs,
      ppb.ideal_weight_max_lbs
     FROM player_traits pt
     LEFT JOIN position_physical_benchmarks ppb
       ON ppb.position = $2
     WHERE pt.player_id = $1
     ORDER BY pt.season DESC
     LIMIT 1`,
    [playerId, macroPosition]
  );

  if (traitsResult.rows.length === 0) return 0;

  const traits = traitsResult.rows[0];

  const weightsResult = await query(
    `SELECT trait_name, weight
     FROM position_trait_weights
     WHERE position = $1`,
    [macroPosition]
  );

  if (weightsResult.rows.length === 0) return 0;

  let totalScore  = 0;
  let totalWeight = 0;

  for (const weightRow of weightsResult.rows) {
    const traitName  = weightRow.trait_name;
    const weight     = parseFloat(weightRow.weight);
    const traitValue = traits[traitName];

    if (traitValue !== null && traitValue !== undefined) {
      if (traitName === 'height_inches' && traits.ideal_height_min_inches) {
        const idealMid   = (traits.ideal_height_min_inches + traits.ideal_height_max_inches) / 2;
        const heightScore = Math.max(0, 100 - Math.abs(traitValue - idealMid) * 10);
        totalScore  += heightScore * weight;
        totalWeight += weight;
      } else if (traitName === 'weight_lbs' && traits.ideal_weight_min_lbs) {
        const idealMidW  = (traits.ideal_weight_min_lbs + traits.ideal_weight_max_lbs) / 2;
        const weightScore = Math.max(0, 100 - Math.abs(traitValue - idealMidW) * 2);
        totalScore  += weightScore * weight;
        totalWeight += weight;
      } else {
        totalScore  += traitValue * weight;
        totalWeight += weight;
      }
    }
  }

  return totalWeight > 0
    ? Math.round((totalScore / totalWeight) * 100) / 100
    : 0;
};

// =============================================
// AWARD BONUS
// =============================================
const calculateAwardBonus = async (
  playerId: string,
  leagueId: string
): Promise<number> => {
  const result = await query(
    `SELECT COALESCE(SUM(atb.bonus_value), 0) as total_bonus
     FROM award_winners aw
     JOIN award_trade_bonuses atb
       ON atb.award_definition_id = aw.award_id
     WHERE aw.player_id = $1
     AND aw.league_id   = $2`,
    [playerId, leagueId]
  );
  return parseFloat(result.rows[0]?.total_bonus || '0');
};

// =============================================
// STATISTICAL TREND BONUS
// Uses MACRO position for stat grouping
// =============================================
const calculateStatTrend = async (
  playerId:      string,
  macroPosition: string
): Promise<number> => {
  const result = await query(
    `SELECT
      g.season,
      SUM(gs.pass_yards)           as pass_yards,
      SUM(gs.rush_yards)           as rush_yards,
      SUM(gs.receiving_yards)      as receiving_yards,
      SUM(gs.pass_touchdowns)      as pass_tds,
      SUM(gs.rush_touchdowns)      as rush_tds,
      SUM(gs.receiving_touchdowns) as rec_tds,
      SUM(gs.tackles)              as tackles,
      SUM(gs.sacks)                as sacks,
      COUNT(DISTINCT gs.game_id)   as games_played
     FROM game_stats gs
     JOIN games g ON g.id = gs.game_id
     WHERE gs.player_id = $1
     GROUP BY g.season
     ORDER BY g.season DESC
     LIMIT 2`,
    [playerId]
  );

  if (result.rows.length < 2) return 0;

  const current  = result.rows[0];
  const previous = result.rows[1];

  const getProductionScore = (season: any, pos: string): number => {
    switch (pos) {
      case 'QB':
        return (season.pass_yards * 0.04) + (season.pass_tds * 6) +
               (season.rush_yards * 0.1)  + (season.rush_tds * 6);
      case 'RB':
        return (season.rush_yards * 0.1)      + (season.rush_tds * 6) +
               (season.receiving_yards * 0.1) + (season.rec_tds * 6);
      case 'WR':
      case 'TE':
        return (season.receiving_yards * 0.1) + (season.rec_tds * 6);
      case 'DL':
      case 'LB':
        return (season.tackles * 1) + (season.sacks * 4);
      case 'CB':
      case 'S':
        return season.tackles * 1;
      default:
        return 0;
    }
  };

  const currentScore  = getProductionScore(current,  macroPosition);
  const previousScore = getProductionScore(previous, macroPosition);

  if (previousScore === 0) return 0;

  const percentChange = ((currentScore - previousScore) / previousScore) * 100;
  return Math.max(-10, Math.min(10, percentChange / 10));
};

// =============================================
// SPEED TIER LABEL
// =============================================
const getSpeedTier = (macroPos: string, spd: number): string => {
  const tiers: { [key: string]: {
    elite: number; fast: number; average: number; slow: number;
  }} = {
    'QB':  { elite: 90, fast: 87, average: 78, slow: 73 },
    'RB':  { elite: 95, fast: 91, average: 90, slow: 87 },
    'WR':  { elite: 96, fast: 94, average: 91, slow: 88 },
    'TE':  { elite: 90, fast: 87, average: 84, slow: 80 },
    'OL':  { elite: 75, fast: 72, average: 69, slow: 64 },
    'DL':  { elite: 90, fast: 86, average: 83, slow: 77 },
    'LB':  { elite: 94, fast: 90, average: 89, slow: 86 },
    'CB':  { elite: 96, fast: 94, average: 91, slow: 88 },
    'S':   { elite: 96, fast: 93, average: 90, slow: 87 },
    'K':   { elite: 99, fast: 99, average: 70, slow: 60 },
    'P':   { elite: 99, fast: 99, average: 70, slow: 60 },
  };
  const tier = tiers[macroPos] || tiers['OL'];
  if (spd >= tier.elite)   return 'ELITE';
  if (spd >= tier.fast)    return 'FAST';
  if (spd >= tier.average) return 'AVERAGE';
  if (spd >= tier.slow)    return 'BELOW_AVERAGE';
  return 'SLOW';
};

// =============================================
// MAIN FUNCTION — Calculate Trade Value
// ALL math uses getMacroPosition()
// DB stores raw sub-position
// =============================================
export const calculateTradeValue = async (
  playerId: string,
  leagueId: string,
  season:   number,
  week?:    number
): Promise<{
  total_value: number;
  breakdown: {
    base_value:           number;
    speed_bonus:          number;
    dev_trait_age_bonus:  number;
    trait_bonus:          number;
    award_bonus:          number;
    trend_bonus:          number;
    age_multiplier:       number;
    position_multiplier:  number;
    dev_trait_multiplier: number;
    speed_rating:         number;
    speed_tier:           string;
  };
}> => {
  const playerResult = await query(
    `SELECT p.*,
      dtm.multiplier as dev_multiplier,
      pt.weight_lbs  as trait_weight,
      pt.strength    as trait_strength,
      pt.acceleration
     FROM players p
     LEFT JOIN dev_trait_multipliers dtm
       ON dtm.dev_trait = p.dev_trait
     LEFT JOIN player_traits pt
       ON pt.player_id = p.id
     WHERE p.id = $1
     ORDER BY pt.season DESC
     LIMIT 1`,
    [playerId]
  );

  if (playerResult.rows.length === 0) {
    throw new Error(`Player ${playerId} not found`);
  }

  const player = playerResult.rows[0];

  // =============================================
  // MACRO POSITION — used for ALL TVS math
  // Raw position stored in DB, macro used here
  // =============================================
  const macroPos = getMacroPosition(player.position);

  const speed    = player.speed          || 70;
  const strength = player.trait_strength || player.strength || 70;
  const weight   = player.trait_weight   || 0;

  const baseValue        = player.overall_rating;
  const devTraitAgeBonus = getDevTraitAgeBonus(player.age, player.dev_trait || 'normal');
  const speedBonus       = calculateSpeedBonus(macroPos, speed, strength, weight);
  const traitScore       = await calculateTraitScore(playerId, macroPos);
  const traitBonus       = (traitScore - 70) * 0.3;
  const awardBonus       = await calculateAwardBonus(playerId, leagueId);
  const trendBonus       = await calculateStatTrend(playerId, macroPos);

  const ageMult      = getAgeCurveMultiplier(player.age);
  const positionMult = getPositionMultiplier(macroPos);
  const devMult      = parseFloat(player.dev_multiplier || '1.0');

  const rawValue = (
    baseValue        +
    speedBonus       +
    devTraitAgeBonus +
    traitBonus       +
    awardBonus       +
    trendBonus
  );

  const totalValue = Math.round(
    rawValue * ageMult * positionMult * devMult * 100
  ) / 100;

  const breakdown = {
    base_value:           baseValue,
    speed_bonus:          speedBonus,
    dev_trait_age_bonus:  devTraitAgeBonus,
    trait_bonus:          Math.round(traitBonus * 100) / 100,
    award_bonus:          Math.round(awardBonus * 100) / 100,
    trend_bonus:          Math.round(trendBonus * 100) / 100,
    age_multiplier:       ageMult,
    position_multiplier:  positionMult,
    dev_trait_multiplier: devMult,
    speed_rating:         speed,
    speed_tier:           getSpeedTier(macroPos, speed)
  };

  await query(
    `INSERT INTO trade_value_history (
      id, player_id, league_id, season, week,
      base_value, trait_bonus, award_bonus,
      statistical_trend_bonus, dev_trait_multiplier,
      total_value, value_breakdown
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT DO NOTHING`,
    [
      uuidv4(), playerId, leagueId, season, week || 0,
      breakdown.base_value,
      breakdown.trait_bonus + breakdown.speed_bonus,
      breakdown.award_bonus,
      breakdown.trend_bonus,
      breakdown.dev_trait_multiplier,
      totalValue,
      JSON.stringify(breakdown)
    ]
  );

  return { total_value: totalValue, breakdown };
};

// =============================================
// CALCULATE ALL LEAGUE TRADE VALUES
// =============================================
export const calculateLeagueTradeValues = async (
  leagueId: string,
  season:   number,
  week?:    number
): Promise<{
  processed: number;
  results: Array<{
    player_id:   string;
    name:        string;
    position:    string;
    speed:       number;
    speed_tier:  string;
    total_value: number;
  }>;
}> => {
  const playersResult = await query(
    `SELECT id, first_name, last_name, position, speed
     FROM players
     WHERE league_id = $1`,
    [leagueId]
  );

  const results = [];

  for (const player of playersResult.rows) {
    try {
      const { total_value, breakdown } = await calculateTradeValue(
        player.id, leagueId, season, week
      );
      results.push({
        player_id:  player.id,
        name:       `${player.first_name} ${player.last_name}`,
        position:   player.position,
        speed:      player.speed,
        speed_tier: breakdown.speed_tier,
        total_value
      });
    } catch (error) {
      console.error(
        `Error calculating value for ${player.first_name} ${player.last_name}:`,
        error
      );
    }
  }

  results.sort((a, b) => b.total_value - a.total_value);
  return { processed: results.length, results };
};

// =============================================
// ANALYZE TRADE PROPOSAL
// =============================================
export const analyzeTradeProposal = async (
  offeredPlayerIds:   string[],
  requestedPlayerIds: string[],
  leagueId:           string,
  season:             number
): Promise<{
  offered_value:     number;
  requested_value:   number;
  value_difference:  number;
  fairness:          string;
  fairness_detail:   string;
  offered_players:   any[];
  requested_players: any[];
}> => {
  const getPlayerValues = async (playerIds: string[]) => {
    const players = [];
    for (const id of playerIds) {
      const playerResult = await query(
        `SELECT p.*,
          tvh.total_value,
          tvh.value_breakdown
         FROM players p
         LEFT JOIN trade_value_history tvh
           ON tvh.player_id  = p.id
           AND tvh.league_id = $2
         WHERE p.id = $1
         ORDER BY tvh.calculated_at DESC
         LIMIT 1`,
        [id, leagueId]
      );
      if (playerResult.rows.length > 0) {
        const player = playerResult.rows[0];
        if (!player.total_value) {
          const { total_value } = await calculateTradeValue(id, leagueId, season);
          player.total_value = total_value;
        }
        players.push(player);
      }
    }
    return players;
  };

  const offeredPlayers   = await getPlayerValues(offeredPlayerIds);
  const requestedPlayers = await getPlayerValues(requestedPlayerIds);

  const offeredValue   = offeredPlayers.reduce(
    (sum, p) => sum + parseFloat(p.total_value || 0), 0
  );
  const requestedValue = requestedPlayers.reduce(
    (sum, p) => sum + parseFloat(p.total_value || 0), 0
  );

  const difference  = offeredValue - requestedValue;
  const percentDiff = requestedValue > 0
    ? (difference / requestedValue) * 100
    : 0;

  let fairness:        string;
  let fairness_detail: string;

  if      (Math.abs(percentDiff) <= 5)  { fairness = 'FAIR';                   fairness_detail = 'This trade is relatively even in value.'; }
  else if (percentDiff > 25)            { fairness = 'HEAVILY_FAVORS_RECEIVER'; fairness_detail = 'The receiving team is getting significantly more value.'; }
  else if (percentDiff > 10)            { fairness = 'FAVORS_RECEIVER';         fairness_detail = 'The receiving team has a noticeable edge.'; }
  else if (percentDiff > 5)             { fairness = 'SLIGHTLY_FAVORS_RECEIVER';fairness_detail = 'The receiving team has a slight edge.'; }
  else if (percentDiff < -25)           { fairness = 'HEAVILY_FAVORS_PROPOSER'; fairness_detail = 'The proposing team is getting significantly more value.'; }
  else if (percentDiff < -10)           { fairness = 'FAVORS_PROPOSER';         fairness_detail = 'The proposing team has a noticeable edge.'; }
  else                                  { fairness = 'SLIGHTLY_FAVORS_PROPOSER';fairness_detail = 'The proposing team has a slight edge.'; }

  return {
    offered_value:    Math.round(offeredValue   * 100) / 100,
    requested_value:  Math.round(requestedValue * 100) / 100,
    value_difference: Math.round(difference     * 100) / 100,
    fairness,
    fairness_detail,
    offered_players:   offeredPlayers,
    requested_players: requestedPlayers
  };
};