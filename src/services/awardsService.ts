import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

// =============================================
// HELPER — Get award definition by name
// =============================================
const getAwardByName = async (
  name: string
): Promise<any | null> => {
  const result = await query(
    `SELECT * FROM award_definitions WHERE name = $1`,
    [name]
  );
  return result.rows[0] || null;
};

// =============================================
// HELPER — Save award winner
// =============================================
const saveAwardWinner = async (
  awardId:       string,
  leagueId:      string,
  season:        number,
  playerId:      string | null,
  teamId:        string | null,
  awardScore:    number,
  statsSnapshot: any
): Promise<void> => {
  await query(
    `INSERT INTO award_winners (
      id, award_id, league_id, season,
      player_id, team_id, award_score,
      stats_snapshot
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (award_id, league_id, season)
    DO UPDATE SET
      player_id      = EXCLUDED.player_id,
      team_id        = EXCLUDED.team_id,
      award_score    = EXCLUDED.award_score,
      stats_snapshot = EXCLUDED.stats_snapshot`,
    [
      uuidv4(),
      awardId,
      leagueId,
      season,
      playerId,
      teamId,
      awardScore,
      JSON.stringify(statsSnapshot)
    ]
  );
};

// =============================================
// LEAGUE MVP
// =============================================
const calculateMVP = async (
  leagueId: string,
  season:   number
): Promise<void> => {
  const award = await getAwardByName('League MVP');
  if (!award) return;

  const result = await query(
    `SELECT
      p.id as player_id,
      p.first_name,
      p.last_name,
      p.position,
      p.overall_rating,
      p.age,
      p.dev_trait,
      t.id as team_id,
      t.name as team_name,
      SUM(gs.pass_yards)           as pass_yards,
      SUM(gs.pass_touchdowns)      as pass_tds,
      SUM(gs.interceptions)        as interceptions,
      SUM(gs.rush_yards)           as rush_yards,
      SUM(gs.rush_touchdowns)      as rush_tds,
      SUM(gs.receiving_yards)      as receiving_yards,
      SUM(gs.receiving_touchdowns) as rec_tds,
      SUM(gs.tackles)              as tackles,
      SUM(gs.sacks)                as sacks,
      COUNT(DISTINCT gs.game_id)   as games_played,
      (
        SUM(gs.pass_yards)           * 0.04 +
        SUM(gs.pass_touchdowns)      * 6    +
        SUM(gs.rush_yards)           * 0.1  +
        SUM(gs.rush_touchdowns)      * 6    +
        SUM(gs.receiving_yards)      * 0.1  +
        SUM(gs.receiving_touchdowns) * 6    +
        SUM(gs.tackles)              * 0.5  +
        SUM(gs.sacks)                * 2    -
        SUM(gs.interceptions)        * 3
      ) as mvp_score
     FROM game_stats gs
     JOIN games g ON g.id = gs.game_id
     JOIN players p ON p.id = gs.player_id
     JOIN teams t ON t.id = p.team_id
     WHERE g.league_id = $1
     AND g.season = $2
     GROUP BY
       p.id, p.first_name, p.last_name,
       p.position, p.overall_rating,
       p.age, p.dev_trait,
       t.id, t.name
     HAVING COUNT(DISTINCT gs.game_id) >= 1
     ORDER BY mvp_score DESC
     LIMIT 1`,
    [leagueId, season]
  );

  if (result.rows.length === 0) return;
  const winner = result.rows[0];

  await saveAwardWinner(
    award.id, leagueId, season,
    winner.player_id, winner.team_id,
    parseFloat(winner.mvp_score), winner
  );

  console.log(`🏆 MVP: ${winner.first_name} ${winner.last_name} (${winner.team_name})`);
};

// =============================================
// OFFENSIVE PLAYER OF THE YEAR
// RB, WR, TE only
// =============================================
const calculateOffensivePOY = async (
  leagueId: string,
  season:   number
): Promise<void> => {
  const award = await getAwardByName('Offensive Player of the Year');
  if (!award) return;

  const result = await query(
    `SELECT
      p.id as player_id,
      p.first_name,
      p.last_name,
      p.position,
      p.overall_rating,
      t.id as team_id,
      t.name as team_name,
      SUM(gs.rush_yards)           as rush_yards,
      SUM(gs.rush_touchdowns)      as rush_tds,
      SUM(gs.receiving_yards)      as receiving_yards,
      SUM(gs.receiving_touchdowns) as rec_tds,
      SUM(gs.receptions)           as receptions,
      COUNT(DISTINCT gs.game_id)   as games_played,
      (
        SUM(gs.rush_yards)           * 0.1 +
        SUM(gs.rush_touchdowns)      * 6   +
        SUM(gs.receiving_yards)      * 0.1 +
        SUM(gs.receiving_touchdowns) * 6   +
        SUM(gs.receptions)           * 0.5
      ) as opoy_score
     FROM game_stats gs
     JOIN games g ON g.id = gs.game_id
     JOIN players p ON p.id = gs.player_id
     JOIN teams t ON t.id = p.team_id
     WHERE g.league_id = $1
     AND g.season = $2
     AND p.position IN ('RB', 'WR', 'TE')
     GROUP BY
       p.id, p.first_name, p.last_name,
       p.position, p.overall_rating,
       t.id, t.name
     HAVING COUNT(DISTINCT gs.game_id) >= 1
     ORDER BY opoy_score DESC
     LIMIT 1`,
    [leagueId, season]
  );

  if (result.rows.length === 0) return;
  const winner = result.rows[0];

  await saveAwardWinner(
    award.id, leagueId, season,
    winner.player_id, winner.team_id,
    parseFloat(winner.opoy_score), winner
  );

  console.log(`🏆 OPOY: ${winner.first_name} ${winner.last_name} (${winner.team_name})`);
};

// =============================================
// DEFENSIVE PLAYER OF THE YEAR
// DL, LB, CB, S only
// =============================================
const calculateDefensivePOY = async (
  leagueId: string,
  season:   number
): Promise<void> => {
  const award = await getAwardByName('Defensive Player of the Year');
  if (!award) return;

  const result = await query(
    `SELECT
      p.id as player_id,
      p.first_name,
      p.last_name,
      p.position,
      p.overall_rating,
      t.id as team_id,
      t.name as team_name,
      SUM(gs.tackles)            as tackles,
      SUM(gs.sacks)              as sacks,
      SUM(gs.forced_fumbles)     as forced_fumbles,
      SUM(gs.interceptions)      as interceptions,
      COUNT(DISTINCT gs.game_id) as games_played,
      (
        SUM(gs.tackles)        * 1 +
        SUM(gs.sacks)          * 5 +
        SUM(gs.forced_fumbles) * 4 +
        SUM(gs.interceptions)  * 6
      ) as dpoy_score
     FROM game_stats gs
     JOIN games g ON g.id = gs.game_id
     JOIN players p ON p.id = gs.player_id
     JOIN teams t ON t.id = p.team_id
     WHERE g.league_id = $1
     AND g.season = $2
     AND p.position IN ('DL', 'LB', 'CB', 'S')
     GROUP BY
       p.id, p.first_name, p.last_name,
       p.position, p.overall_rating,
       t.id, t.name
     HAVING COUNT(DISTINCT gs.game_id) >= 1
     ORDER BY dpoy_score DESC
     LIMIT 1`,
    [leagueId, season]
  );

  if (result.rows.length === 0) return;
  const winner = result.rows[0];

  await saveAwardWinner(
    award.id, leagueId, season,
    winner.player_id, winner.team_id,
    parseFloat(winner.dpoy_score), winner
  );

  console.log(`🏆 DPOY: ${winner.first_name} ${winner.last_name} (${winner.team_name})`);
};

// =============================================
// OFFENSIVE ROOKIE OF THE YEAR
// years_pro = 0 only
// =============================================
const calculateOffensiveROY = async (
  leagueId: string,
  season:   number
): Promise<void> => {
  const award = await getAwardByName('Offensive Rookie of the Year');
  if (!award) return;

  const result = await query(
    `SELECT
      p.id as player_id,
      p.first_name,
      p.last_name,
      p.position,
      p.overall_rating,
      p.years_pro,
      t.id as team_id,
      t.name as team_name,
      SUM(gs.pass_yards)           as pass_yards,
      SUM(gs.pass_touchdowns)      as pass_tds,
      SUM(gs.rush_yards)           as rush_yards,
      SUM(gs.rush_touchdowns)      as rush_tds,
      SUM(gs.receiving_yards)      as receiving_yards,
      SUM(gs.receiving_touchdowns) as rec_tds,
      COUNT(DISTINCT gs.game_id)   as games_played,
      (
        SUM(gs.pass_yards)           * 0.04 +
        SUM(gs.pass_touchdowns)      * 6    +
        SUM(gs.rush_yards)           * 0.1  +
        SUM(gs.rush_touchdowns)      * 6    +
        SUM(gs.receiving_yards)      * 0.1  +
        SUM(gs.receiving_touchdowns) * 6
      ) as roy_score
     FROM game_stats gs
     JOIN games g ON g.id = gs.game_id
     JOIN players p ON p.id = gs.player_id
     JOIN teams t ON t.id = p.team_id
     WHERE g.league_id = $1
     AND g.season = $2
     AND p.position IN ('QB', 'RB', 'WR', 'TE')
     AND p.years_pro = 0
     GROUP BY
       p.id, p.first_name, p.last_name,
       p.position, p.overall_rating,
       p.years_pro, t.id, t.name
     HAVING COUNT(DISTINCT gs.game_id) >= 1
     ORDER BY roy_score DESC
     LIMIT 1`,
    [leagueId, season]
  );

  if (result.rows.length === 0) return;
  const winner = result.rows[0];

  await saveAwardWinner(
    award.id, leagueId, season,
    winner.player_id, winner.team_id,
    parseFloat(winner.roy_score), winner
  );

  console.log(`🏆 OROY: ${winner.first_name} ${winner.last_name} (${winner.team_name})`);
};

// =============================================
// DEFENSIVE ROOKIE OF THE YEAR
// years_pro = 0 only
// =============================================
const calculateDefensiveROY = async (
  leagueId: string,
  season:   number
): Promise<void> => {
  const award = await getAwardByName('Defensive Rookie of the Year');
  if (!award) return;

  const result = await query(
    `SELECT
      p.id as player_id,
      p.first_name,
      p.last_name,
      p.position,
      p.overall_rating,
      p.years_pro,
      t.id as team_id,
      t.name as team_name,
      SUM(gs.tackles)            as tackles,
      SUM(gs.sacks)              as sacks,
      SUM(gs.forced_fumbles)     as forced_fumbles,
      SUM(gs.interceptions)      as interceptions,
      COUNT(DISTINCT gs.game_id) as games_played,
      (
        SUM(gs.tackles)        * 1 +
        SUM(gs.sacks)          * 5 +
        SUM(gs.forced_fumbles) * 4 +
        SUM(gs.interceptions)  * 6
      ) as droy_score
     FROM game_stats gs
     JOIN games g ON g.id = gs.game_id
     JOIN players p ON p.id = gs.player_id
     JOIN teams t ON t.id = p.team_id
     WHERE g.league_id = $1
     AND g.season = $2
     AND p.position IN ('DL', 'LB', 'CB', 'S')
     AND p.years_pro = 0
     GROUP BY
       p.id, p.first_name, p.last_name,
       p.position, p.overall_rating,
       p.years_pro, t.id, t.name
     HAVING COUNT(DISTINCT gs.game_id) >= 1
     ORDER BY droy_score DESC
     LIMIT 1`,
    [leagueId, season]
  );

  if (result.rows.length === 0) return;
  const winner = result.rows[0];

  await saveAwardWinner(
    award.id, leagueId, season,
    winner.player_id, winner.team_id,
    parseFloat(winner.droy_score), winner
  );

  console.log(`🏆 DROY: ${winner.first_name} ${winner.last_name} (${winner.team_name})`);
};

// =============================================
// COMEBACK PLAYER OF THE YEAR
// years_pro > 1, no rookies
// Must have previous season stats
// Must show improvement over previous season
// =============================================
const calculateComebackPOY = async (
  leagueId: string,
  season:   number
): Promise<void> => {
  const award = await getAwardByName('Comeback Player of the Year');
  if (!award) return;

  const currentResult = await query(
    `SELECT
      p.id as player_id,
      p.first_name,
      p.last_name,
      p.position,
      p.overall_rating,
      p.years_pro,
      p.age,
      t.id as team_id,
      t.name as team_name,
      SUM(gs.pass_yards)           as pass_yards,
      SUM(gs.pass_touchdowns)      as pass_tds,
      SUM(gs.rush_yards)           as rush_yards,
      SUM(gs.rush_touchdowns)      as rush_tds,
      SUM(gs.receiving_yards)      as receiving_yards,
      SUM(gs.receiving_touchdowns) as rec_tds,
      SUM(gs.tackles)              as tackles,
      SUM(gs.sacks)                as sacks,
      COUNT(DISTINCT gs.game_id)   as games_played
     FROM game_stats gs
     JOIN games g ON g.id = gs.game_id
     JOIN players p ON p.id = gs.player_id
     JOIN teams t ON t.id = p.team_id
     WHERE g.league_id = $1
     AND g.season = $2
     AND p.years_pro > 1
     GROUP BY
       p.id, p.first_name, p.last_name,
       p.position, p.overall_rating,
       p.years_pro, p.age,
       t.id, t.name
     HAVING COUNT(DISTINCT gs.game_id) >= 1`,
    [leagueId, season]
  );

  if (currentResult.rows.length === 0) return;

  const getScore = (row: any): number => {
    switch (row.position) {
      case 'QB':
        return (
          (row.pass_yards * 0.04) + (row.pass_tds * 6) +
          (row.rush_yards * 0.1)  + (row.rush_tds * 6)
        );
      case 'RB':
        return (
          (row.rush_yards * 0.1)      + (row.rush_tds * 6) +
          (row.receiving_yards * 0.1) + (row.rec_tds  * 6)
        );
      case 'WR':
      case 'TE':
        return (row.receiving_yards * 0.1) + (row.rec_tds * 6);
      case 'DL':
      case 'LB':
        return (row.tackles * 1) + (row.sacks * 4);
      case 'CB':
      case 'S':
        return row.tackles * 1;
      default:
        return 0;
    }
  };

  let bestComebackScore = -Infinity;
  let bestCandidate: any = null;

  for (const player of currentResult.rows) {
    const prevResult = await query(
      `SELECT
        SUM(gs.pass_yards)           as pass_yards,
        SUM(gs.pass_touchdowns)      as pass_tds,
        SUM(gs.rush_yards)           as rush_yards,
        SUM(gs.rush_touchdowns)      as rush_tds,
        SUM(gs.receiving_yards)      as receiving_yards,
        SUM(gs.receiving_touchdowns) as rec_tds,
        SUM(gs.tackles)              as tackles,
        SUM(gs.sacks)                as sacks,
        COUNT(DISTINCT gs.game_id)   as games_played
       FROM game_stats gs
       JOIN games g ON g.id = gs.game_id
       WHERE gs.player_id = $1
       AND g.league_id = $2
       AND g.season = $3`,
      [player.player_id, leagueId, season - 1]
    );

    const prevStats = prevResult.rows[0];
    if (!prevStats || prevStats.games_played === '0') {
      await query(
        `INSERT INTO comeback_eligibility_log (
          id, player_id, league_id, season,
          is_eligible, years_pro, ineligibility_reason
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (player_id, league_id, season) DO NOTHING`,
        [
          uuidv4(), player.player_id, leagueId, season,
          false, player.years_pro,
          'No previous season stats found'
        ]
      );
      continue;
    }

    const currentScore = getScore(player);
    const prevScore    = getScore({
      ...player,
      pass_yards:      prevStats.pass_yards,
      pass_tds:        prevStats.pass_tds,
      rush_yards:      prevStats.rush_yards,
      rush_tds:        prevStats.rush_tds,
      receiving_yards: prevStats.receiving_yards,
      rec_tds:         prevStats.rec_tds,
      tackles:         prevStats.tackles,
      sacks:           prevStats.sacks
    });

    if (prevScore === 0) continue;

    const declinePct   = ((prevScore - currentScore) / prevScore) * 100;
    const comebackScore = currentScore - prevScore;

    await query(
      `INSERT INTO comeback_eligibility_log (
        id, player_id, league_id, season,
        is_eligible, years_pro,
        prev_season_score, curr_season_score,
        decline_percentage, ineligibility_reason
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (player_id, league_id, season)
      DO UPDATE SET
        is_eligible          = EXCLUDED.is_eligible,
        prev_season_score    = EXCLUDED.prev_season_score,
        curr_season_score    = EXCLUDED.curr_season_score,
        decline_percentage   = EXCLUDED.decline_percentage,
        ineligibility_reason = EXCLUDED.ineligibility_reason`,
      [
        uuidv4(), player.player_id, leagueId, season,
        comebackScore > 0, player.years_pro,
        prevScore, currentScore, declinePct,
        comebackScore > 0 ? null : 'Did not improve over previous season'
      ]
    );

    if (comebackScore > bestComebackScore && comebackScore > 0) {
      bestComebackScore = comebackScore;
      bestCandidate     = player;
    }
  }

  if (!bestCandidate) return;

  await saveAwardWinner(
    award.id, leagueId, season,
    bestCandidate.player_id, bestCandidate.team_id,
    bestComebackScore, bestCandidate
  );

  console.log(`🏆 CPOY: ${bestCandidate.first_name} ${bestCandidate.last_name} (${bestCandidate.team_name})`);
};

// =============================================
// MOST IMPROVED PLAYER
// Minimum 2 seasons required
// =============================================
const calculateMostImproved = async (
  leagueId: string,
  season:   number
): Promise<void> => {
  const award = await getAwardByName('Most Improved Player');
  if (!award) return;
  if (season < 2) return;

  const result = await query(
    `WITH current_season AS (
      SELECT
        gs.player_id,
        SUM(gs.pass_yards + gs.rush_yards + gs.receiving_yards) as total_yards,
        SUM(gs.pass_touchdowns + gs.rush_touchdowns + gs.receiving_touchdowns) as total_tds,
        COUNT(DISTINCT gs.game_id) as games_played
       FROM game_stats gs
       JOIN games g ON g.id = gs.game_id
       WHERE g.league_id = $1 AND g.season = $2
       GROUP BY gs.player_id
     ),
     prev_season AS (
       SELECT
         gs.player_id,
         SUM(gs.pass_yards + gs.rush_yards + gs.receiving_yards) as total_yards,
         SUM(gs.pass_touchdowns + gs.rush_touchdowns + gs.receiving_touchdowns) as total_tds,
         COUNT(DISTINCT gs.game_id) as games_played
        FROM game_stats gs
        JOIN games g ON g.id = gs.game_id
        WHERE g.league_id = $1 AND g.season = $3
        GROUP BY gs.player_id
     )
     SELECT
       p.id as player_id,
       p.first_name, p.last_name,
       p.position, p.overall_rating,
       t.id as team_id, t.name as team_name,
       cs.total_yards as current_yards,
       ps.total_yards as prev_yards,
       cs.total_tds as current_tds,
       ps.total_tds as prev_tds,
       (
         (cs.total_yards - ps.total_yards) * 0.1 +
         (cs.total_tds   - ps.total_tds)   * 6
       ) as improvement_score
      FROM current_season cs
      JOIN prev_season ps ON ps.player_id = cs.player_id
      JOIN players p ON p.id = cs.player_id
      JOIN teams t ON t.id = p.team_id
      WHERE cs.total_yards > ps.total_yards
      ORDER BY improvement_score DESC
      LIMIT 1`,
    [leagueId, season, season - 1]
  );

  if (result.rows.length === 0) return;
  const winner = result.rows[0];

  await saveAwardWinner(
    award.id, leagueId, season,
    winner.player_id, winner.team_id,
    parseFloat(winner.improvement_score), winner
  );

  console.log(`🏆 MIP: ${winner.first_name} ${winner.last_name} (${winner.team_name})`);
};

// =============================================
// STATISTICAL TITLES
// =============================================
const calculateStatTitle = async (
  leagueId:   string,
  season:     number,
  awardName:  string,
  statColumn: string,
  positions:  string[],
  minGames:   number = 1
): Promise<void> => {
  const award = await getAwardByName(awardName);
  if (!award) return;

  const positionFilter = positions
    .map((_, i) => `$${i + 3}`)
    .join(', ');

  const result = await query(
    `SELECT
      p.id as player_id,
      p.first_name, p.last_name,
      p.position, p.overall_rating,
      t.id as team_id, t.name as team_name,
      SUM(gs.${statColumn}) as stat_total,
      COUNT(DISTINCT gs.game_id) as games_played
     FROM game_stats gs
     JOIN games g ON g.id = gs.game_id
     JOIN players p ON p.id = gs.player_id
     JOIN teams t ON t.id = p.team_id
     WHERE g.league_id = $1
     AND g.season = $2
     AND p.position IN (${positionFilter})
     GROUP BY
       p.id, p.first_name, p.last_name,
       p.position, p.overall_rating,
       t.id, t.name
     HAVING COUNT(DISTINCT gs.game_id) >= ${minGames}
     ORDER BY stat_total DESC
     LIMIT 1`,
    [leagueId, season, ...positions]
  );

  if (result.rows.length === 0) return;
  const winner = result.rows[0];

  await saveAwardWinner(
    award.id, leagueId, season,
    winner.player_id, winner.team_id,
    parseFloat(winner.stat_total), winner
  );

  console.log(`🏆 ${awardName}: ${winner.first_name} ${winner.last_name} (${winner.team_name}) - ${winner.stat_total}`);
};

// =============================================
// TEAM AWARDS
// Best Offense, Best Defense
// =============================================
const calculateTeamAwards = async (
  leagueId: string,
  season:   number
): Promise<void> => {
  // Best Offense
  const offenseAward = await getAwardByName('Best Offense');
  if (offenseAward) {
    const result = await query(
      `SELECT
        t.id as team_id, t.name as team_name,
        SUM(
          CASE
            WHEN g.home_team_id = t.id THEN g.home_score
            ELSE g.away_score
          END
        ) as total_points
       FROM teams t
       JOIN games g ON
         (g.home_team_id = t.id OR g.away_team_id = t.id)
       WHERE t.league_id = $1 AND g.season = $2
       GROUP BY t.id, t.name
       ORDER BY total_points DESC
       LIMIT 1`,
      [leagueId, season]
    );

    if (result.rows.length > 0) {
      const winner = result.rows[0];
      await saveAwardWinner(
        offenseAward.id, leagueId, season,
        null, winner.team_id,
        parseFloat(winner.total_points), winner
      );
      console.log(`🏆 Best Offense: ${winner.team_name} - ${winner.total_points} points`);
    }
  }

  // Best Defense
  const defenseAward = await getAwardByName('Best Defense');
  if (defenseAward) {
    const result = await query(
      `SELECT
        t.id as team_id, t.name as team_name,
        SUM(
          CASE
            WHEN g.home_team_id = t.id THEN g.away_score
            ELSE g.home_score
          END
        ) as points_allowed
       FROM teams t
       JOIN games g ON
         (g.home_team_id = t.id OR g.away_team_id = t.id)
       WHERE t.league_id = $1 AND g.season = $2
       GROUP BY t.id, t.name
       ORDER BY points_allowed ASC
       LIMIT 1`,
      [leagueId, season]
    );

    if (result.rows.length > 0) {
      const winner = result.rows[0];
      await saveAwardWinner(
        defenseAward.id, leagueId, season,
        null, winner.team_id,
        parseFloat(winner.points_allowed), winner
      );
      console.log(`🏆 Best Defense: ${winner.team_name} - ${winner.points_allowed} points allowed`);
    }
  }
};

// =============================================
// TEAM LEADER STATS
// Tracks team leaders for narrative context
// Identifies trapped gems and hidden talent
// A player dominating a bad team is often
// more valuable than their raw stats suggest
// =============================================
export const calculateTeamLeaderStats = async (
  leagueId: string,
  season:   number
): Promise<{
  processed: number;
  trapped_gems: any[];
  team_leaders: any[];
}> => {
  console.log('\n📊 Calculating team leader stats...');

  // Get all teams in the league
  const teamsResult = await query(
    `SELECT
      t.id,
      t.name,
      t.abbreviation,
      t.wins,
      t.losses,
      t.overall_rating,
      t.team_logo_url,
      t.primary_color,
      -- Team quality score
      CASE
        WHEN t.wins + t.losses = 0 THEN 50
        ELSE ROUND(
          t.wins::decimal / (t.wins + t.losses) * 100
        )
      END as win_percentage
     FROM teams t
     WHERE t.league_id = $1`,
    [leagueId]
  );

  const allTeamLeaders: any[] = [];
  const trappedGems: any[]    = [];

  for (const team of teamsResult.rows) {
    // Get all stat leaders for this team
    const teamStatsResult = await query(
      `SELECT
        p.id as player_id,
        p.first_name,
        p.last_name,
        p.position,
        p.overall_rating,
        p.age,
        p.dev_trait,
        p.headshot_url,
        p.years_pro,
        -- Passing stats
        SUM(gs.pass_yards)           as pass_yards,
        SUM(gs.pass_touchdowns)      as pass_tds,
        SUM(gs.interceptions)        as interceptions,
        SUM(gs.pass_completions)     as completions,
        SUM(gs.pass_attempts)        as attempts,
        -- Rushing stats
        SUM(gs.rush_yards)           as rush_yards,
        SUM(gs.rush_touchdowns)      as rush_tds,
        SUM(gs.rush_attempts)        as rush_attempts,
        -- Receiving stats
        SUM(gs.receiving_yards)      as receiving_yards,
        SUM(gs.receiving_touchdowns) as receiving_tds,
        SUM(gs.receptions)           as receptions,
        -- Defensive stats
        SUM(gs.tackles)              as tackles,
        SUM(gs.sacks)                as sacks,
        SUM(gs.forced_fumbles)       as forced_fumbles,
        COUNT(DISTINCT gs.game_id)   as games_played
       FROM game_stats gs
       JOIN games g ON g.id = gs.game_id
       JOIN players p ON p.id = gs.player_id
       WHERE p.team_id = $1
       AND g.season = $2
       GROUP BY
         p.id, p.first_name, p.last_name,
         p.position, p.overall_rating,
         p.age, p.dev_trait, p.headshot_url,
         p.years_pro
       ORDER BY p.position, p.overall_rating DESC`,
      [team.id, season]
    );

    if (teamStatsResult.rows.length === 0) continue;

    // Calculate team totals for dominance scoring
    const teamTotals = teamStatsResult.rows.reduce(
      (acc: any, player: any) => {
        acc.pass_yards      += parseFloat(player.pass_yards      || 0);
        acc.rush_yards      += parseFloat(player.rush_yards      || 0);
        acc.receiving_yards += parseFloat(player.receiving_yards || 0);
        acc.tackles         += parseFloat(player.tackles         || 0);
        acc.sacks           += parseFloat(player.sacks           || 0);
        return acc;
      },
      {
        pass_yards: 0, rush_yards: 0,
        receiving_yards: 0, tackles: 0, sacks: 0
      }
    );

    // Find team leaders per stat category
    const getTeamLeader = (
      players: any[],
      statKey: string
    ) => {
      return [...players].sort(
        (a, b) =>
          parseFloat(b[statKey] || 0) -
          parseFloat(a[statKey] || 0)
      )[0];
    };

    const passLeader     = getTeamLeader(teamStatsResult.rows, 'pass_yards');
    const rushLeader     = getTeamLeader(teamStatsResult.rows, 'rush_yards');
    const receivingLeader = getTeamLeader(teamStatsResult.rows, 'receiving_yards');
    const tackleLeader   = getTeamLeader(teamStatsResult.rows, 'tackles');
    const sackLeader     = getTeamLeader(teamStatsResult.rows, 'sacks');

    // Calculate dominance scores
    // How much of the team's total does this player account for?
    const getDominanceScore = (
      playerStat: number,
      teamTotal:  number
    ): number => {
      if (teamTotal === 0) return 0;
      return Math.round((playerStat / teamTotal) * 100);
    };

    // Build team leaders object
    const teamLeaderData = {
      team: {
        id:             team.id,
        name:           team.name,
        abbreviation:   team.abbreviation,
        wins:           team.wins,
        losses:         team.losses,
        overall_rating: team.overall_rating,
        team_logo_url:  team.team_logo_url,
        primary_color:  team.primary_color,
        win_percentage: parseFloat(team.win_percentage),
        team_quality:   getTeamQuality(
          parseFloat(team.win_percentage),
          team.overall_rating
        )
      },
      leaders: {
        passing: buildLeaderEntry(
          passLeader,
          'pass_yards',
          getDominanceScore(
            parseFloat(passLeader?.pass_yards || 0),
            teamTotals.pass_yards
          ),
          team
        ),
        rushing: buildLeaderEntry(
          rushLeader,
          'rush_yards',
          getDominanceScore(
            parseFloat(rushLeader?.rush_yards || 0),
            teamTotals.rush_yards
          ),
          team
        ),
        receiving: buildLeaderEntry(
          receivingLeader,
          'receiving_yards',
          getDominanceScore(
            parseFloat(receivingLeader?.receiving_yards || 0),
            teamTotals.receiving_yards
          ),
          team
        ),
        tackles: buildLeaderEntry(
          tackleLeader,
          'tackles',
          getDominanceScore(
            parseFloat(tackleLeader?.tackles || 0),
            teamTotals.tackles
          ),
          team
        ),
        sacks: buildLeaderEntry(
          sackLeader,
          'sacks',
          getDominanceScore(
            parseFloat(sackLeader?.sacks || 0),
            teamTotals.sacks
          ),
          team
        )
      },
      team_totals: teamTotals
    };

    allTeamLeaders.push(teamLeaderData);

    // =============================================
    // TRAPPED GEM DETECTION
    // Find elite players on bad teams
    // These are the most valuable trade targets
    // =============================================
    for (const player of teamStatsResult.rows) {
      const isTrappedGem = detectTrappedGem(
        player,
        team,
        teamTotals,
        getDominanceScore
      );

      if (isTrappedGem) {
        trappedGems.push({
          ...isTrappedGem,
          team_context: {
            team_name:      team.name,
            team_wins:      team.wins,
            team_losses:    team.losses,
            team_quality:   getTeamQuality(
              parseFloat(team.win_percentage),
              team.overall_rating
            ),
            win_percentage: parseFloat(team.win_percentage)
          }
        });
      }
    }
  }

  // Sort trapped gems by gem score
  trappedGems.sort(
    (a, b) => b.trapped_gem_score - a.trapped_gem_score
  );

  console.log(
    `✅ Team leaders calculated for ${allTeamLeaders.length} teams`
  );
  console.log(
    `💎 ${trappedGems.length} trapped gems identified`
  );

  return {
    processed:    allTeamLeaders.length,
    trapped_gems: trappedGems,
    team_leaders: allTeamLeaders
  };
};

// =============================================
// HELPER — Build leader entry object
// =============================================
const buildLeaderEntry = (
  player:          any,
  primaryStat:     string,
  dominanceScore:  number,
  team:            any
): any => {
  if (!player) return null;

  return {
    player_id:        player.player_id,
    name:             `${player.first_name} ${player.last_name}`,
    position:         player.position,
    overall_rating:   player.overall_rating,
    age:              player.age,
    dev_trait:        player.dev_trait,
    headshot_url:     player.headshot_url,
    years_pro:        player.years_pro,
    primary_stat:     parseFloat(player[primaryStat] || 0),
    dominance_score:  dominanceScore,
    // How dominant is this player on their team?
    dominance_label:  getDominanceLabel(dominanceScore),
    games_played:     parseInt(player.games_played || 0),
    // Full stats for context
    stats: {
      pass_yards:      parseFloat(player.pass_yards      || 0),
      pass_tds:        parseFloat(player.pass_tds        || 0),
      rush_yards:      parseFloat(player.rush_yards      || 0),
      rush_tds:        parseFloat(player.rush_tds        || 0),
      receiving_yards: parseFloat(player.receiving_yards || 0),
      receiving_tds:   parseFloat(player.receiving_tds   || 0),
      receptions:      parseFloat(player.receptions      || 0),
      tackles:         parseFloat(player.tackles         || 0),
      sacks:           parseFloat(player.sacks           || 0)
    }
  };
};

// =============================================
// HELPER — Get team quality label
// =============================================
const getTeamQuality = (
  winPct:        number,
  overallRating: number
): string => {
  if (winPct >= 75 && overallRating >= 85) return 'ELITE';
  if (winPct >= 60 && overallRating >= 80) return 'GOOD';
  if (winPct >= 45 && overallRating >= 75) return 'AVERAGE';
  if (winPct >= 30 && overallRating >= 70) return 'BELOW_AVERAGE';
  return 'REBUILDING';
};

// =============================================
// HELPER — Get dominance label
// =============================================
const getDominanceLabel = (score: number): string => {
  if (score >= 60) return 'CARRYING_THE_TEAM';
  if (score >= 45) return 'CLEAR_LEADER';
  if (score >= 30) return 'SOLID_CONTRIBUTOR';
  if (score >= 15) return 'ROLE_PLAYER';
  return 'DEPTH';
};

// =============================================
// HELPER — Detect trapped gem
// Elite player on a bad or mediocre team
// Most valuable trade targets in the league
// =============================================
const detectTrappedGem = (
  player:          any,
  team:            any,
  teamTotals:      any,
  getDominance:    Function
): any | null => {
  const winPct = parseFloat(team.win_percentage);

  // Only flag players on struggling teams
  if (winPct > 50) return null;

  // Must be a meaningful contributor
  const gamesPlayed = parseInt(player.games_played || 0);
  if (gamesPlayed === 0) return null;

  let gemScore    = 0;
  let gemReasons: string[] = [];

  // Age bonus — young trapped gems are the most valuable
  if (player.age <= 22) {
    gemScore += 30;
    gemReasons.push('Young age with high upside');
  } else if (player.age <= 25) {
    gemScore += 20;
    gemReasons.push('Prime age with years ahead');
  } else if (player.age <= 27) {
    gemScore += 10;
    gemReasons.push('Peak age range');
  }

  // Dev trait bonus
  if (player.dev_trait === 'xfactor') {
    gemScore += 25;
    gemReasons.push('X-Factor dev trait');
  } else if (player.dev_trait === 'superstar') {
    gemScore += 15;
    gemReasons.push('Superstar dev trait');
  } else if (player.dev_trait === 'star') {
    gemScore += 5;
    gemReasons.push('Star dev trait');
  }

  // Overall rating bonus
  if (player.overall_rating >= 90) {
    gemScore += 20;
    gemReasons.push(`Elite ${player.overall_rating} overall`);
  } else if (player.overall_rating >= 85) {
    gemScore += 12;
    gemReasons.push(`High ${player.overall_rating} overall`);
  } else if (player.overall_rating >= 80) {
    gemScore += 6;
    gemReasons.push(`Solid ${player.overall_rating} overall`);
  }

  // Team dominance bonus
  // Leading a bad team means real talent
  const pos = player.position;
  let dominanceScore = 0;

  if (['QB'].includes(pos)) {
    dominanceScore = getDominance(
      parseFloat(player.pass_yards || 0),
      teamTotals.pass_yards
    );
  } else if (['RB'].includes(pos)) {
    dominanceScore = getDominance(
      parseFloat(player.rush_yards || 0),
      teamTotals.rush_yards
    );
  } else if (['WR', 'TE'].includes(pos)) {
    dominanceScore = getDominance(
      parseFloat(player.receiving_yards || 0),
      teamTotals.receiving_yards
    );
  } else if (['DL', 'LB', 'CB', 'S'].includes(pos)) {
    dominanceScore = getDominance(
      parseFloat(player.tackles || 0),
      teamTotals.tackles
    );
  }

  if (dominanceScore >= 40) {
    gemScore += 15;
    gemReasons.push(
      `Accounts for ${dominanceScore}% of team production`
    );
  }

  // Team quality penalty context
  // Worse team = gem is more impressive
  if (winPct <= 25) {
    gemScore += 15;
    gemReasons.push('Performing on a struggling team');
  } else if (winPct <= 40) {
    gemScore += 8;
    gemReasons.push('Team has losing record');
  }

  // Only flag genuine gems
  if (gemScore < 30) return null;

  // Determine gem tier
  const gemTier =
    gemScore >= 80 ? 'ELITE_GEM'   :
    gemScore >= 60 ? 'STRONG_GEM'  :
    gemScore >= 45 ? 'SOLID_GEM'   :
    'POTENTIAL_GEM';

  return {
    player_id:          player.player_id,
    name:               `${player.first_name} ${player.last_name}`,
    position:           player.position,
    overall_rating:     player.overall_rating,
    age:                player.age,
    dev_trait:          player.dev_trait,
    headshot_url:       player.headshot_url,
    trapped_gem_score:  gemScore,
    gem_tier:           gemTier,
    gem_reasons:        gemReasons,
    dominance_score:    dominanceScore,
    stats: {
      pass_yards:      parseFloat(player.pass_yards      || 0),
      rush_yards:      parseFloat(player.rush_yards      || 0),
      receiving_yards: parseFloat(player.receiving_yards || 0),
      tackles:         parseFloat(player.tackles         || 0),
      sacks:           parseFloat(player.sacks           || 0),
      games_played:    parseInt(player.games_played      || 0)
    }
  };
};

// =============================================
// MAIN FUNCTION
// Run all awards for a league and season
// Called after every game sync
// =============================================
export const calculateAllAwards = async (
  leagueId: string,
  season:   number
): Promise<{
  awards_calculated: number;
  winners:      any[];
  team_leaders: any[];
  trapped_gems: any[];
}> => {
  console.log(`\n🏆 Calculating awards for league ${leagueId} Season ${season}...`);

  await calculateMVP(leagueId, season);
  await calculateOffensivePOY(leagueId, season);
  await calculateDefensivePOY(leagueId, season);
  await calculateOffensiveROY(leagueId, season);
  await calculateDefensiveROY(leagueId, season);
  await calculateComebackPOY(leagueId, season);
  await calculateMostImproved(leagueId, season);

  await calculateStatTitle(leagueId, season, 'Passing Title',       'pass_yards',      ['QB']);
  await calculateStatTitle(leagueId, season, 'Rushing Title',       'rush_yards',      ['QB', 'RB', 'WR', 'TE']);
  await calculateStatTitle(leagueId, season, 'Receiving Title',     'receiving_yards', ['RB', 'WR', 'TE']);
  await calculateStatTitle(leagueId, season, 'Sack Leader',         'sacks',           ['DL', 'LB']);
  await calculateStatTitle(leagueId, season, 'Interception Leader', 'interceptions',   ['LB', 'CB', 'S']);

  await calculateTeamAwards(leagueId, season);

  const winnersResult = await query(
    `SELECT
      aw.*,
      ad.name as award_name,
      ad.category,
      p.first_name, p.last_name,
      p.position, p.headshot_url,
      t.name as team_name,
      t.team_logo_url, t.primary_color
     FROM award_winners aw
     JOIN award_definitions ad ON ad.id = aw.award_id
     LEFT JOIN players p ON p.id = aw.player_id
     LEFT JOIN teams t ON t.id = COALESCE(aw.team_id, p.team_id)
     WHERE aw.league_id = $1
     AND aw.season = $2
     ORDER BY ad.category, ad.name`,
    [leagueId, season]
  );
// Calculate team leader stats and trapped gems
const teamLeaderData = await calculateTeamLeaderStats(
  leagueId,
  season
);

console.log(`✅ Awards complete — ${winnersResult.rows.length} awards calculated\n`);

return {
  awards_calculated: winnersResult.rows.length,
  winners:           winnersResult.rows,
  team_leaders:      teamLeaderData.team_leaders,
  trapped_gems:      teamLeaderData.trapped_gems
};

};

// =============================================
// GET CURRENT AWARD LEADERS
// =============================================
export const getAwardLeaders = async (
  leagueId: string,
  season:   number
): Promise<any[]> => {
  const result = await query(
    `SELECT
      aw.*,
      ad.name as award_name,
      ad.category,
      ad.description,
      p.first_name, p.last_name,
      p.position, p.overall_rating,
      p.headshot_url, p.dev_trait,
      t.name as team_name,
      t.abbreviation as team_abbreviation,
      t.team_logo_url, t.primary_color
     FROM award_winners aw
     JOIN award_definitions ad ON ad.id = aw.award_id
     LEFT JOIN players p ON p.id = aw.player_id
     LEFT JOIN teams t ON t.id = COALESCE(aw.team_id, p.team_id)
     WHERE aw.league_id = $1
     AND aw.season = $2
     ORDER BY ad.category, ad.name`,
    [leagueId, season]
  );

  return result.rows;
};