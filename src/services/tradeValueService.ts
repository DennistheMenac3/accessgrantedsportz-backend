import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

// =============================================
// MACRO POSITION RESOLVER
// =============================================
export const getMacroPosition = (pos: string): string => {
  const p = (pos || '').toUpperCase().trim();
  const olPositions = ['LT', 'LG', 'C', 'RG', 'RT'];
  const dlPositions = ['LE', 'RE', 'DT', 'LEDG', 'REDG', 'LEDGE', 'REDGE'];
  const lbPositions = ['LOLB', 'MLB', 'ROLB', 'SAM', 'MIKE', 'WILL'];
  const sPositions  = ['FS', 'SS'];

  if (olPositions.includes(p)) return 'OL';
  if (dlPositions.includes(p)) return 'DL';
  if (lbPositions.includes(p)) return 'LB';
  if (sPositions.includes(p))  return 'S';
  if (p === 'HB' || p === 'FB') return 'RB';
  return p;
};

// =============================================
// 1. NON-LINEAR OVR CURVE
// =============================================
const calculateBaseAV = (ovr: number): number => {
  return Math.round(Math.pow(ovr / 10, 2.8) * 10) / 10;
};

// =============================================
// 2. AGE BONUS
// =============================================
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

// =============================================
// 3. DEV TRAIT BONUS
// =============================================
const getDevBonus = (dev: string): number => {
  const devMap: { [key: string]: number } = {
    'normal':    0,
    'star':      40,
    'superstar': 120,
    'xfactor':   250
  };
  return devMap[dev?.toLowerCase()] || 0;
};

// =============================================
// 4. SPEED BONUS
// =============================================
const calculateSpeedBonus = (pos: string, spd: number): number => {
  if (pos === 'LB') {
    if (spd >= 92) return 60;
    if (spd >= 90) return 30;
    if (spd >= 88) return 10;
    if (spd >= 85) return 0;
    return -40;
  }
  if (pos === 'DL') {
    if (spd >= 85) return 50;
    if (spd >= 80) return 25;
    if (spd >= 75) return 0;
    return -20;
  }
  return 0;
};

// =============================================
// 5. PLAYER TRAJECTORY
// Used by trade advisor for context
// =============================================
export const getPlayerTrajectory = (age: number): string => {
  if (age <= 22) return 'ASCENDING — has not reached prime yet';
  if (age <= 25) return 'ASCENDING — approaching prime window';
  if (age <= 27) return 'PEAK — in prime window';
  if (age <= 29) return 'DECLINING — leaving prime';
  if (age <= 31) return 'LATE CAREER — significant decline expected';
  return 'VETERAN — limited elite seasons remaining';
};

// =============================================
// 6. POSITIONAL SCARCITY SCORE
// Pure SQL math — no AI tokens needed
// Measures how irreplaceable a player is
// within their position group in the league
// =============================================
export const getPositionalScarcity = async (
  playerId: string,
  leagueId: string
): Promise<{
  position_rank:       number;
  position_total:      number;
  position_percentile: number;
  speed_rank:          number;
  speed_percentile:    number;
  scarcity_score:      number;
  scarcity_label:      string;
  replacement_quality: string;
  ovr_drop_to_next:    number;
}> => {
  const playerResult = await query(
    `SELECT p.*
     FROM players p
     WHERE p.id = $1
     LIMIT 1`,
    [playerId]
  );

  const defaultResult = {
    position_rank: 0, position_total: 0,
    position_percentile: 0, speed_rank: 0,
    speed_percentile: 0, scarcity_score: 0,
    scarcity_label: 'UNKNOWN',
    replacement_quality: 'UNKNOWN',
    ovr_drop_to_next: 0
  };

  if (playerResult.rows.length === 0) return defaultResult;

  const player   = playerResult.rows[0];
  const macroPos = getMacroPosition(player.position);

  // Get all players at same macro position in league
  const positionResult = await query(
    `SELECT
      p.id,
      p.overall_rating,
      p.speed,
      p.age,
      p.dev_trait,
      RANK() OVER (ORDER BY p.overall_rating DESC) as ovr_rank,
      RANK() OVER (ORDER BY p.speed DESC)          as speed_rank,
      COUNT(*) OVER ()                             as total_at_position
     FROM players p
     WHERE p.league_id = $1
     AND (
       CASE
         WHEN p.position IN ('LT','LG','C','RG','RT')               THEN 'OL'
         WHEN p.position IN ('LE','RE','DT','LEDGE','REDGE',
                             'LEDG','REDG')                          THEN 'DL'
         WHEN p.position IN ('LOLB','MLB','ROLB',
                             'SAM','MIKE','WILL')                    THEN 'LB'
         WHEN p.position IN ('FS','SS')                              THEN 'S'
         WHEN p.position IN ('HB','FB')                              THEN 'RB'
         ELSE p.position
       END
     ) = $2
     ORDER BY p.overall_rating DESC`,
    [leagueId, macroPos]
  );

  if (positionResult.rows.length === 0) return defaultResult;

  const playerRow = positionResult.rows.find(
    (r: any) => r.id === playerId
  );
  if (!playerRow) return defaultResult;

  const total     = parseInt(playerRow.total_at_position);
  const ovrRank   = parseInt(playerRow.ovr_rank);
  const speedRank = parseInt(playerRow.speed_rank);

  const ovrPercentile   = Math.round(((total - ovrRank)   / total) * 100);
  const speedPercentile = Math.round(((total - speedRank) / total) * 100);

  // Players within 3 OVR (comparable replacements)
  const nearPeers = positionResult.rows.filter(
    (r: any) =>
      Math.abs(r.overall_rating - player.overall_rating) <= 3 &&
      r.id !== playerId
  ).length;

  // Players within 2 speed (speed peers)
  const speedPeers = positionResult.rows.filter(
    (r: any) =>
      Math.abs((r.speed || 0) - (player.speed || 0)) <= 2 &&
      r.id !== playerId
  ).length;

  // XFactor / SS rarity at position
  const xfactorCount = positionResult.rows.filter(
    (r: any) => r.dev_trait === 'xfactor'
  ).length;
  const ssCount = positionResult.rows.filter(
    (r: any) => r.dev_trait === 'superstar'
  ).length;

  // =============================================
  // SCARCITY SCORE
  // =============================================
  let scarcityScore = 0;

  if      (ovrRank === 1) scarcityScore += 40;
  else if (ovrRank <= 3)  scarcityScore += 30;
  else if (ovrRank <= 5)  scarcityScore += 20;
  else if (ovrRank <= 8)  scarcityScore += 10;
  else if (ovrRank <= 12) scarcityScore += 5;

  if      (nearPeers === 0) scarcityScore += 25;
  else if (nearPeers <= 2)  scarcityScore += 15;
  else if (nearPeers <= 5)  scarcityScore += 8;
  else if (nearPeers <= 8)  scarcityScore += 3;

  if      (speedPeers === 0) scarcityScore += 20;
  else if (speedPeers <= 2)  scarcityScore += 12;
  else if (speedPeers <= 5)  scarcityScore += 6;
  else if (speedPeers <= 8)  scarcityScore += 2;

  if (player.dev_trait === 'xfactor') {
    if      (xfactorCount === 1) scarcityScore += 20;
    else if (xfactorCount <= 3)  scarcityScore += 12;
    else                         scarcityScore += 6;
  } else if (player.dev_trait === 'superstar') {
    if (ssCount <= 2) scarcityScore += 10;
    else              scarcityScore += 4;
  }

  scarcityScore = Math.min(100, scarcityScore);

  const scarcityLabel =
    scarcityScore >= 85 ? 'IRREPLACEABLE'   :
    scarcityScore >= 70 ? 'ELITE SCARCE'    :
    scarcityScore >= 55 ? 'HIGHLY SCARCE'   :
    scarcityScore >= 40 ? 'MODERATELY RARE' :
    scarcityScore >= 25 ? 'REPLACEABLE'     :
    'DEPTH PIECE';

  // Best available replacement and OVR drop
  const replacementRow = positionResult.rows.find(
    (r: any) => r.id !== playerId
  );
  const replacementOvr  = replacementRow ? replacementRow.overall_rating : 0;
  const ovrDrop         = player.overall_rating - replacementOvr;

  const replacementQuality =
    ovrDrop <= 1  ? 'Comparable replacement available'         :
    ovrDrop <= 3  ? 'Minor downgrade to replace'               :
    ovrDrop <= 6  ? 'Meaningful downgrade to replace'          :
    ovrDrop <= 10 ? 'Significant drop — hard to replace'       :
    'No viable replacement in the league';

  return {
    position_rank:       ovrRank,
    position_total:      total,
    position_percentile: ovrPercentile,
    speed_rank:          speedRank,
    speed_percentile:    speedPercentile,
    scarcity_score:      scarcityScore,
    scarcity_label:      scarcityLabel,
    replacement_quality: replacementQuality,
    ovr_drop_to_next:    ovrDrop
  };
};

// =============================================
// 7. SCARCITY MULTIPLIER
// Applied to total AV value
// =============================================
const getScarcityMultiplier = (scarcityScore: number): number => {
  if (scarcityScore >= 85) return 1.20;
  if (scarcityScore >= 70) return 1.12;
  if (scarcityScore >= 55) return 1.06;
  if (scarcityScore >= 40) return 1.02;
  return 1.00;
};

// =============================================
// 8. CORE CALCULATION
// =============================================
export const calculateTradeValue = async (
  playerId: string,
  leagueId: string,
  season:   number,
  week?:    number
): Promise<{ total_value: number; breakdown: any }> => {
  const playerResult = await query(
    `SELECT p.*, pt.weight_lbs, pt.strength
     FROM players p
     LEFT JOIN player_traits pt ON pt.player_id = p.id
     WHERE p.id = $1
     LIMIT 1`,
    [playerId]
  );

  if (playerResult.rows.length === 0) {
    throw new Error(`Player ${playerId} not found`);
  }

  const player   = playerResult.rows[0];
  const macroPos = getMacroPosition(player.position);

  const base     = calculateBaseAV(player.overall_rating);
  const ageB     = getAgeBonus(player.age);
  const devB     = getDevBonus(player.dev_trait);
  const spdB     = calculateSpeedBonus(macroPos, player.speed || 70);

  // Get scarcity
  const scarcity       = await getPositionalScarcity(playerId, leagueId);
  const scarcityMult   = getScarcityMultiplier(scarcity.scarcity_score);
  const rawValue       = base + ageB + devB + spdB;
  const totalValue     = Math.max(1, Math.round(rawValue * scarcityMult * 10) / 10);

  const breakdown = {
    base_value:          base,
    age_bonus:           ageB,
    dev_bonus:           devB,
    speed_bonus:         spdB,
    scarcity_score:      scarcity.scarcity_score,
    scarcity_label:      scarcity.scarcity_label,
    scarcity_multiplier: scarcityMult,
    position_rank:       scarcity.position_rank,
    position_total:      scarcity.position_total,
    replacement_quality: scarcity.replacement_quality,
    trajectory:          getPlayerTrajectory(player.age),
    speed_tier:
      player.speed >= 93 ? 'ELITE'        :
      player.speed >= 88 ? 'FAST'          :
      player.speed >= 83 ? 'AVERAGE'       :
      'BELOW AVERAGE'
  };

  await query(
    `INSERT INTO trade_value_history (
      id, player_id, league_id, season, week,
      total_value, value_breakdown
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT DO NOTHING`,
    [
      uuidv4(), playerId, leagueId,
      season, week || 0,
      totalValue, JSON.stringify(breakdown)
    ]
  );

  return { total_value: totalValue, breakdown };
};

// =============================================
// 9. LEAGUE ORCHESTRATOR
// =============================================
export const calculateLeagueTradeValues = async (
  leagueId: string,
  season:   number,
  week?:    number
): Promise<{ processed: number; results: any[] }> => {
  const players = await query(
    `SELECT id FROM players WHERE league_id = $1`,
    [leagueId]
  );
  const results = [];

  for (const row of players.rows) {
    try {
      const val = await calculateTradeValue(
        row.id, leagueId, season, week
      );
      results.push({
        player_id:   row.id,
        total_value: val.total_value
      });
    } catch (e) {
      console.error(e);
    }
  }

  return { processed: results.length, results };
};

// =============================================
// 10. ANALYZE TRADE PROPOSAL
// =============================================
export const analyzeTradeProposal = async (
  offeredPlayerIds:   string[],
  requestedPlayerIds: string[],
  leagueId:           string,
  season:             number
): Promise<any> => {
  const getPlayerValues = async (playerIds: string[]) => {
    const players = [];
    for (const id of playerIds) {
      const playerResult = await query(
        `SELECT p.* FROM players p WHERE p.id = $1`,
        [id]
      );
      if (playerResult.rows.length > 0) {
        const player = playerResult.rows[0];
        const { total_value, breakdown } = await calculateTradeValue(
          id, leagueId, season
        );
        player.total_value     = total_value;
        player.value_breakdown = breakdown;
        players.push(player);
      }
    }
    return players;
  };

  const offeredPlayers   = await getPlayerValues(offeredPlayerIds);
  const requestedPlayers = await getPlayerValues(requestedPlayerIds);

  const offeredValue   = offeredPlayers.reduce(
    (sum, p) => sum + p.total_value, 0
  );
  const requestedValue = requestedPlayers.reduce(
    (sum, p) => sum + p.total_value, 0
  );
  const difference = offeredValue - requestedValue;

  let fairness = 'FAIR';
  if (difference >  150) fairness = 'FAVORS_OFFER';
  if (difference < -150) fairness = 'FAVORS_RECEIVER';

  return {
    offered_value:    Math.round(offeredValue   * 100) / 100,
    requested_value:  Math.round(requestedValue * 100) / 100,
    value_difference: Math.round(difference     * 100) / 100,
    fairness,
    offered_players:   offeredPlayers,
    requested_players: requestedPlayers
  };
};