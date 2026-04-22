import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

/**
 * ASSET VALUE (AV) LOGIC ENGINE
 * Replaces the old TVS system with non-linear scaling and flat bonuses.
 */

export const getMacroPosition = (pos: string): string => {
  const p = (pos || '').toUpperCase().trim();
  const olPositions = ['LT', 'LG', 'C', 'RG', 'RT'];
  const dlPositions = ['LE', 'RE', 'DT', 'LEDG', 'REDG', 'LEDGE', 'REDGE'];
  const lbPositions = ['LOLB', 'MLB', 'ROLB', 'SAM', 'MIKE', 'WILL', 'MIKE', 'WILL'];
  const sPositions  = ['FS', 'SS'];

  if (olPositions.includes(p)) return 'OL';
  if (dlPositions.includes(p)) return 'DL';
  if (lbPositions.includes(p)) return 'LB';
  if (sPositions.includes(p))  return 'S';
  return p;
};

// 1. NON-LINEAR OVR CURVE (The "Star Factor")
const calculateBaseAV = (ovr: number): number => {
  return Math.round(Math.pow(ovr / 10, 2.8) * 10) / 10;
};

// 2. FLAT AGE BONUSES
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

// 3. DEV TRAIT FLAT BONUSES
const getDevBonus = (dev: string): number => {
  const devMap: { [key: string]: number } = {
    'normal': 0,
    'star': 40,
    'superstar': 120,
    'xfactor': 250
  };
  return devMap[dev?.toLowerCase()] || 0;
};

// 4. SPEED THRESHOLD BONUSES
const calculateSpeedBonus = (pos: string, spd: number): number => {
  if (pos === 'LB') {
    if (spd >= 92) return 60;
    if (spd >= 90) return 30;
    if (spd >= 88) return 10;
    if (spd >= 85) return 0;
    return -40; // Penalty for 84 and below (The Mike Tyson Fix)
  }
  if (pos === 'DL') {
    if (spd >= 85) return 50;
    if (spd >= 80) return 25;
    if (spd >= 75) return 0;
    return -20;
  }
  return 0;
};

// 5. CORE CALCULATION (Exports 4 args for compatibility)
export const calculateTradeValue = async (
  playerId: string,
  leagueId: string,
  season:   number,
  week?:    number
): Promise<{ total_value: number; breakdown: any }> => {
  const playerResult = await query(
    `SELECT p.*, pt.weight_lbs, pt.strength FROM players p 
     LEFT JOIN player_traits pt ON pt.player_id = p.id 
     WHERE p.id = $1 LIMIT 1`, [playerId]
  );

  if (playerResult.rows.length === 0) throw new Error(`Player ${playerId} not found`);
  const player = playerResult.rows[0];
  const macroPos = getMacroPosition(player.position);

  const base = calculateBaseAV(player.overall_rating);
  const ageB = getAgeBonus(player.age);
  const devB = getDevBonus(player.dev_trait);
  const spdB = calculateSpeedBonus(macroPos, player.speed || 70);

  const totalValue = Math.max(1, base + ageB + devB + spdB);

  const breakdown = {
    base_value: base,
    age_bonus: ageB,
    dev_bonus: devB,
    speed_bonus: spdB,
    speed_tier: player.speed >= 90 ? 'ELITE' : 'AVERAGE' // Simplified for logging
  };

  // Log to history as the original code did
  await query(
    `INSERT INTO trade_value_history (id, player_id, league_id, season, week, total_value, value_breakdown)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
    [uuidv4(), playerId, leagueId, season, week || 0, totalValue, JSON.stringify(breakdown)]
  );

  return { total_value: totalValue, breakdown };
};

// 6. LEAGUE ORCHESTRATOR (Restored for ingestionRoutes)
export const calculateLeagueTradeValues = async (
  leagueId: string,
  season:   number,
  week?:    number
): Promise<{ processed: number; results: any[] }> => {
  const players = await query(`SELECT id FROM players WHERE league_id = $1`, [leagueId]);
  const results = [];

  for (const row of players.rows) {
    try {
      const val = await calculateTradeValue(row.id, leagueId, season, week);
      results.push({ player_id: row.id, total_value: val.total_value });
    } catch (e) { console.error(e); }
  }
  return { processed: results.length, results };
};

// =============================================
// ANALYZE TRADE PROPOSAL (AV VERSION)
// Forces fresh calculations, ignores DB cache
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
      // Just get the base player data, ignore the old trade_value_history
      const playerResult = await query(
        `SELECT p.* FROM players p WHERE p.id = $1`,
        [id]
      );
      
      if (playerResult.rows.length > 0) {
        const player = playerResult.rows[0];
        // FORCE a fresh calculation using the new AV logic
        const { total_value, breakdown } = await calculateTradeValue(id, leagueId, season);
        
        player.total_value = total_value;
        player.value_breakdown = breakdown;
        players.push(player);
      }
    }
    return players;
  };

  const offeredPlayers   = await getPlayerValues(offeredPlayerIds);
  const requestedPlayers = await getPlayerValues(requestedPlayerIds);

  const offeredValue   = offeredPlayers.reduce((sum, p) => sum + p.total_value, 0);
  const requestedValue = requestedPlayers.reduce((sum, p) => sum + p.total_value, 0);

  const difference  = offeredValue - requestedValue;
  
  // Set fairness thresholds based on the new 1st Round Pick value (~450 AV)
  let fairness = 'FAIR';
  if (difference > 150) fairness = 'FAVORS_OFFER';
  if (difference < -150) fairness = 'FAVORS_RECEIVER';

  return {
    offered_value:    Math.round(offeredValue * 100) / 100,
    requested_value:  Math.round(requestedValue * 100) / 100,
    value_difference: Math.round(difference * 100) / 100,
    fairness,
    offered_players:   offeredPlayers,
    requested_players: requestedPlayers
  };
};