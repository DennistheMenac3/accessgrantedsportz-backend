import Anthropic from '@anthropic-ai/sdk';
import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// =============================================
// HELPER — Get full league context
// =============================================
const getLeagueContext = async (
  leagueId: string,
  season:   number
): Promise<any> => {
  const leagueResult = await query(
    `SELECT l.*, u.username as owner_username
     FROM leagues l
     LEFT JOIN users u ON u.id = l.owner_id
     WHERE l.id = $1`,
    [leagueId]
  );

  const standingsResult = await query(
    `SELECT
      t.name, t.abbreviation,
      t.wins, t.losses,
      t.overall_rating,
      t.team_logo_url,
      CASE
        WHEN (t.wins + t.losses) = 0 THEN 0
        ELSE ROUND(
          t.wins::decimal / (t.wins + t.losses) * 100, 1
        )
      END as win_percentage
     FROM teams t
     WHERE t.league_id = $1
     ORDER BY t.wins DESC`,
    [leagueId]
  );

  const awardsResult = await query(
    `SELECT
      aw.award_score,
      ad.name as award_name,
      p.first_name, p.last_name,
      p.position, p.overall_rating,
      p.dev_trait, p.age,
      t.name as team_name,
      t.abbreviation
     FROM award_winners aw
     JOIN award_definitions ad ON ad.id = aw.award_id
     LEFT JOIN players p ON p.id = aw.player_id
     LEFT JOIN teams t ON t.id = COALESCE(aw.team_id, p.team_id)
     WHERE aw.league_id = $1
     AND aw.season = $2`,
    [leagueId, season]
  );

  const topPlayersResult = await query(
    `SELECT
      p.first_name, p.last_name,
      p.position, p.overall_rating,
      p.age, p.dev_trait, p.speed,
      t.name as team_name,
      t.abbreviation,
      t.wins, t.losses,
      tvh.total_value as trade_value,
      tvh.value_breakdown
     FROM players p
     LEFT JOIN teams t ON t.id = p.team_id
     LEFT JOIN trade_value_history tvh
       ON tvh.player_id = p.id
       AND tvh.league_id = $1
     WHERE p.league_id = $1
     ORDER BY tvh.total_value DESC NULLS LAST
     LIMIT 20`,
    [leagueId]
  );

  const recentGamesResult = await query(
    `SELECT
      g.week, g.season,
      g.home_score, g.away_score,
      ht.name as home_team,
      ht.abbreviation as home_abbr,
      at.name as away_team,
      at.abbreviation as away_abbr,
      CASE
        WHEN g.home_score > g.away_score THEN ht.name
        WHEN g.away_score > g.home_score THEN at.name
        ELSE 'TIE'
      END as winner
     FROM games g
     LEFT JOIN teams ht ON ht.id = g.home_team_id
     LEFT JOIN teams at ON at.id = g.away_team_id
     WHERE g.league_id = $1
     AND g.season = $2
     ORDER BY g.week DESC
     LIMIT 10`,
    [leagueId, season]
  );

  const statLeadersResult = await query(
    `SELECT
      p.first_name, p.last_name,
      p.position, p.age, p.dev_trait,
      t.name as team_name,
      t.abbreviation,
      t.wins, t.losses,
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
     GROUP BY
       p.first_name, p.last_name,
       p.position, p.age, p.dev_trait,
       t.name, t.abbreviation,
       t.wins, t.losses
     ORDER BY
       SUM(gs.pass_yards) +
       SUM(gs.rush_yards) +
       SUM(gs.receiving_yards) DESC
     LIMIT 15`,
    [leagueId, season]
  );

  const tradeTargetsResult = await query(
    `SELECT
      p.first_name, p.last_name,
      p.position, p.overall_rating,
      p.age, p.dev_trait, p.speed,
      t.name as team_name,
      t.abbreviation,
      t.wins, t.losses,
      tvh.total_value as trade_value
     FROM players p
     LEFT JOIN teams t ON t.id = p.team_id
     LEFT JOIN trade_value_history tvh
       ON tvh.player_id = p.id
       AND tvh.league_id = $1
     WHERE p.league_id = $1
     AND t.losses > t.wins
     ORDER BY tvh.total_value DESC NULLS LAST
     LIMIT 10`,
    [leagueId]
  );

  return {
    league:        leagueResult.rows[0],
    standings:     standingsResult.rows,
    awards:        awardsResult.rows,
    top_players:   topPlayersResult.rows,
    recent_games:  recentGamesResult.rows,
    stat_leaders:  statLeadersResult.rows,
    trade_targets: tradeTargetsResult.rows
  };
};

// =============================================
// HELPER — Call Claude API
// =============================================
const callClaude = async (
  systemPrompt: string,
  userPrompt:   string,
  maxTokens:    number = 1500
): Promise<string> => {
  const message = await anthropic.messages.create({
    model:      'claude-opus-4-5',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: userPrompt }],
    system: systemPrompt
  });

  const content = message.content[0];
  if (content.type === 'text') return content.text;
  return '';
};

// =============================================
// HELPER — Save storyline to database
// =============================================
export const saveStoryline = async (
  leagueId:      string,
  season:        number,
  week:          number,
  storylineType: string,
  content:       string,
  metadata?:     any
): Promise<void> => {
  await query(
    `INSERT INTO storylines (
      id, league_id, season, week,
      storyline_type, content, metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      uuidv4(), leagueId, season, week,
      storylineType, content,
      metadata ? JSON.stringify(metadata) : null
    ]
  );
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
// TEAM NEED ANALYZER
// Deep position-specific stat analysis
// Matches gem's specific strengths to each
// team's specific statistical weaknesses
// =============================================
export const findTeamNeeds = async (
  leagueId:  string,
  position:  string,
  gemScore:  number,
  playerId?: string
): Promise<any[]> => {

  // Get player's specific strengths if provided
  let playerStrengths: any = null;
  if (playerId) {
    const playerResult = await query(
      `SELECT p.*,
        pt.speed, pt.acceleration,
        pt.strength, pt.awareness,
        pt.tackle, pt.hit_power,
        pt.pursuit, pt.play_recognition,
        pt.block_shedding, pt.power_move,
        pt.finesse_move, pt.man_coverage,
        pt.zone_coverage, pt.press,
        pt.catching, pt.route_running_short,
        pt.route_running_mid, pt.route_running_deep,
        pt.throw_power, pt.throw_accuracy_short,
        pt.throw_accuracy_mid, pt.throw_accuracy_deep,
        pt.trucking, pt.break_tackle,
        pt.carrying, pt.ball_carrier_vision,
        pt.pass_block, pt.run_block,
        pt.height_inches, pt.weight_lbs,
        pt.change_of_direction, pt.jumping
       FROM players p
       LEFT JOIN player_traits pt ON pt.player_id = p.id
       WHERE p.id = $1
       ORDER BY pt.season DESC
       LIMIT 1`,
      [playerId]
    );
    playerStrengths = playerResult.rows[0] || null;
  }

  // Get all teams
  const teamsResult = await query(
    `SELECT
      t.id as team_id,
      t.name as team_name,
      t.abbreviation,
      t.wins, t.losses,
      t.overall_rating as team_overall,
      t.team_logo_url,
      t.primary_color,
      CASE
        WHEN (t.wins + t.losses) = 0 THEN 0
        ELSE ROUND(
          t.wins::decimal / (t.wins + t.losses) * 100, 1
        )
      END as win_percentage
     FROM teams t
     WHERE t.league_id = $1`,
    [leagueId]
  );

  const teamNeeds = [];

  for (const team of teamsResult.rows) {
    // Skip the gem's own team
    if (playerId) {
      const playerTeam = await query(
        `SELECT team_id FROM players WHERE id = $1`,
        [playerId]
      );
      if (playerTeam.rows[0]?.team_id === team.team_id) continue;
    }

    const winPct = parseFloat(team.win_percentage);
    let needScore = 0;
    const needReasons: string[] = [];

    // Get team's roster at this position
    const rosterResult = await query(
      `SELECT
        p.overall_rating, p.age,
        p.dev_trait, p.speed,
        pt.tackle, pt.hit_power,
        pt.pursuit, pt.play_recognition,
        pt.block_shedding, pt.power_move,
        pt.finesse_move, pt.man_coverage,
        pt.zone_coverage, pt.press,
        pt.pass_block, pt.run_block,
        pt.strength, pt.weight_lbs,
        pt.catching, pt.route_running_mid,
        pt.throw_power, pt.throw_accuracy_mid
       FROM players p
       LEFT JOIN player_traits pt ON pt.player_id = p.id
       WHERE p.team_id = $1
       AND p.position = $2
       ORDER BY p.overall_rating DESC`,
      [team.team_id, position]
    );

    const starter = rosterResult.rows[0] || null;
    const depth   = rosterResult.rows.length;

    // Get team's defensive stats per game
    const teamDefStats = await query(
      `SELECT
        SUM(gs.rush_yards)      as rush_yards_allowed,
        SUM(gs.receiving_yards) as pass_yards_allowed,
        SUM(gs.rush_touchdowns) as rush_tds_allowed,
        SUM(gs.pass_touchdowns) as pass_tds_allowed,
        SUM(gs.tackles)         as total_tackles,
        SUM(gs.sacks)           as total_sacks,
        COUNT(DISTINCT g.id)    as games_played
       FROM game_stats gs
       JOIN games g ON g.id = gs.game_id
       JOIN players p ON p.id = gs.player_id
       WHERE p.team_id = $1
       AND p.position IN ('DL', 'LB', 'CB', 'S')
       AND g.league_id = $2`,
      [team.team_id, leagueId]
    );

    const defStats     = teamDefStats.rows[0];
    const gamesPlayed  = parseInt(defStats?.games_played || 1);
    const rushPerGame  = gamesPlayed > 0
      ? parseFloat(defStats?.rush_yards_allowed || 0) / gamesPlayed : 0;
    const passPerGame  = gamesPlayed > 0
      ? parseFloat(defStats?.pass_yards_allowed || 0) / gamesPlayed : 0;
    const sacksPerGame = gamesPlayed > 0
      ? parseFloat(defStats?.total_sacks || 0) / gamesPlayed : 0;
    const tacklesPerGame = gamesPlayed > 0
      ? parseFloat(defStats?.total_tackles || 0) / gamesPlayed : 0;

    // =============================================
    // POSITION SPECIFIC NEED ANALYSIS
    // =============================================

    if (position === 'DL') {
      if (!starter) {
        needScore += 40;
        needReasons.push('No DL on roster — massive need');
      } else if (starter.overall_rating < 75) {
        needScore += 30;
        needReasons.push(`Weak DL starter at ${starter.overall_rating} overall`);
      } else if (starter.overall_rating < 82) {
        needScore += 18;
        needReasons.push(`Below average DL at ${starter.overall_rating} overall`);
      }

      // Run stopping check
      if (rushPerGame > 150) {
        needScore += 25;
        needReasons.push(
          `Giving up ${rushPerGame.toFixed(0)} rush yds/game — run D is broken`
        );
      } else if (rushPerGame > 120) {
        needScore += 15;
        needReasons.push(
          `Rush defense allowing ${rushPerGame.toFixed(0)} yds/game`
        );
      }

      // Pass rush weakness
      if (sacksPerGame < 1.0) {
        needScore += 20;
        needReasons.push(
          `Only ${sacksPerGame.toFixed(1)} sacks/game — QB has all day`
        );
      } else if (sacksPerGame < 1.5) {
        needScore += 10;
        needReasons.push('Below average pass rush production');
      }

      // Tackle for loss / run stuffing
      if (tacklesPerGame < 5) {
        needScore += 15;
        needReasons.push(
          'DL not making plays in backfield — need run stuffer'
        );
      }

      if (playerStrengths) {
        if (rushPerGame > 120 && playerStrengths.strength >= 85) {
          needScore += 15;
          needReasons.push(
            `Player's ${playerStrengths.strength} strength directly addresses run stopping need`
          );
        }
        if (sacksPerGame < 1.5 && playerStrengths.power_move >= 85) {
          needScore += 15;
          needReasons.push(
            `Player's ${playerStrengths.power_move} power move fills pass rush void`
          );
        }
        if (playerStrengths.block_shedding >= 85) {
          needScore += 10;
          needReasons.push(
            `${playerStrengths.block_shedding} block shedding solves their OL problem`
          );
        }
        if (playerStrengths.finesse_move >= 85 && sacksPerGame < 1.5) {
          needScore += 12;
          needReasons.push(
            `${playerStrengths.finesse_move} finesse move provides elite edge rushing`
          );
        }
        // DT size check
        if (
          playerStrengths.weight_lbs >= 310 &&
          (starter?.weight_lbs || 0) < 300
        ) {
          needScore += 12;
          needReasons.push(
            'Team needs heavy DT — player has ideal size for NT role'
          );
        }
        if (playerStrengths.pursuit >= 85) {
          needScore += 8;
          needReasons.push(
            `${playerStrengths.pursuit} pursuit rating chases down outside runs they give up`
          );
        }
      }

    } else if (position === 'LB') {
      if (!starter) {
        needScore += 40;
        needReasons.push('No LB on roster');
      } else if (starter.overall_rating < 75) {
        needScore += 28;
        needReasons.push(`Weak LB corps at ${starter.overall_rating} overall`);
      } else if (starter.overall_rating < 82) {
        needScore += 16;
        needReasons.push(`Below average LB at ${starter.overall_rating} overall`);
      }

      // Run stopping — LBs are first line vs run
      if (rushPerGame > 130) {
        needScore += 22;
        needReasons.push(
          `LBs can't stop the run — ${rushPerGame.toFixed(0)} rush yds/game`
        );
      } else if (rushPerGame > 110) {
        needScore += 12;
        needReasons.push(
          `Run defense giving up ${rushPerGame.toFixed(0)} yds/game — needs help`
        );
      }

      // TFL and tackle production check
      if (tacklesPerGame < 8) {
        needScore += 18;
        needReasons.push(
          `Only ${tacklesPerGame.toFixed(1)} tackles/game — LB unit missing run stuffer`
        );
      }

      // Coverage check
      if (passPerGame > 280) {
        needScore += 15;
        needReasons.push('Pass defense struggling — need coverage LB');
      }

      if (playerStrengths) {
        // High tackle count addresses run stopping
        if (rushPerGame > 130 && playerStrengths.tackle >= 85) {
          needScore += 20;
          needReasons.push(
            `Player's ${playerStrengths.tackle} tackle rating directly fixes run D — ` +
            `they're giving up ${rushPerGame.toFixed(0)} yds/game`
          );
        }
        // TFL ability
        if (tacklesPerGame < 8 && playerStrengths.hit_power >= 88) {
          needScore += 18;
          needReasons.push(
            `${playerStrengths.hit_power} hit power forces TFLs their LB corps desperately lacks`
          );
        }
        // Coverage ability
        if (passPerGame > 250 && playerStrengths.zone_coverage >= 80) {
          needScore += 15;
          needReasons.push(
            `${playerStrengths.zone_coverage} zone coverage fixes their coverage liability`
          );
        }
        // Speed for coverage viability
        if (
          playerStrengths.speed >= 89 &&
          (starter?.speed || 0) < 86
        ) {
          needScore += 15;
          needReasons.push(
            `Player's ${playerStrengths.speed} speed upgrades their slow LB corps ` +
            `— 89+ required to cover TEs and RBs`
          );
        }
        // Play recognition for run fits
        if (playerStrengths.play_recognition >= 85) {
          needScore += 10;
          needReasons.push(
            `${playerStrengths.play_recognition} play recognition gets them in position before the snap`
          );
        }
        if (playerStrengths.pursuit >= 85) {
          needScore += 8;
          needReasons.push(
            `${playerStrengths.pursuit} pursuit keeps runs from breaking big — ` +
            `they've been giving up chunk runs`
          );
        }
      }

    } else if (position === 'CB') {
      if (!starter) {
        needScore += 40;
        needReasons.push('No CB on roster — opposing QBs will have a field day');
      } else if (starter.overall_rating < 75) {
        needScore += 32;
        needReasons.push(
          `CB1 is only ${starter.overall_rating} overall — getting torched`
        );
      } else if (starter.overall_rating < 82) {
        needScore += 20;
        needReasons.push(
          `Below average CB at ${starter.overall_rating} overall`
        );
      }

      if (passPerGame > 300) {
        needScore += 28;
        needReasons.push(
          `Secondary allowing ${passPerGame.toFixed(0)} pass yds/game — NEED CB badly`
        );
      } else if (passPerGame > 250) {
        needScore += 18;
        needReasons.push(
          `Pass defense giving up ${passPerGame.toFixed(0)} yds/game`
        );
      }

      if (playerStrengths) {
        // Speed matchup — most critical for CB
        if (
          playerStrengths.speed >= 94 &&
          (starter?.speed || 0) < 90
        ) {
          needScore += 22;
          needReasons.push(
            `Player's ${playerStrengths.speed} speed is a MASSIVE upgrade ` +
            `over their ${starter?.speed || 'slow'} speed CB — ` +
            `94+ is baseline fast for CB`
          );
        } else if (
          playerStrengths.speed >= 91 &&
          (starter?.speed || 0) < 87
        ) {
          needScore += 14;
          needReasons.push(
            `Speed upgrade from ${starter?.speed || 'unknown'} to ${playerStrengths.speed}`
          );
        }
        // Man coverage
        if (passPerGame > 250 && playerStrengths.man_coverage >= 88) {
          needScore += 18;
          needReasons.push(
            `${playerStrengths.man_coverage} man coverage is exactly what their pass D needs`
          );
        }
        // Zone coverage
        if (passPerGame > 270 && playerStrengths.zone_coverage >= 85) {
          needScore += 14;
          needReasons.push(
            `${playerStrengths.zone_coverage} zone coverage tightens up the soft spots in their secondary`
          );
        }
        // Press coverage
        if (playerStrengths.press >= 85) {
          needScore += 12;
          needReasons.push(
            `${playerStrengths.press} press coverage disrupts timing routes they've been burned by`
          );
        }
        // COD — hip flip speed
        if (playerStrengths.change_of_direction >= 92) {
          needScore += 14;
          needReasons.push(
            `Elite COD (${playerStrengths.change_of_direction}) — ` +
            `mirrors route runners their current CB can't stay with`
          );
        }
        // Jumping for contested catches
        if (playerStrengths.jumping >= 90) {
          needScore += 10;
          needReasons.push(
            `${playerStrengths.jumping} jumping wins jump balls they've been losing`
          );
        }
      }

    } else if (position === 'S') {
      if (!starter) {
        needScore += 38;
        needReasons.push('No safety on roster');
      } else if (starter.overall_rating < 75) {
        needScore += 28;
        needReasons.push(
          `Safety is ${starter.overall_rating} overall — a liability`
        );
      } else if (starter.overall_rating < 82) {
        needScore += 16;
        needReasons.push(
          `Below average safety at ${starter.overall_rating} overall`
        );
      }

      if (rushPerGame > 140) {
        needScore += 18;
        needReasons.push('Run defense needs better run support safety in the box');
      }

      if (passPerGame > 270) {
        needScore += 18;
        needReasons.push('Deep coverage breakdowns — need range safety');
      }

      if (playerStrengths) {
        if (rushPerGame > 130 && playerStrengths.tackle >= 84) {
          needScore += 16;
          needReasons.push(
            `${playerStrengths.tackle} tackle rating provides run support they lack in the box`
          );
        }
        if (playerStrengths.hit_power >= 88) {
          needScore += 12;
          needReasons.push(
            `${playerStrengths.hit_power} hit power deters short routes they've been losing on`
          );
        }
        if (playerStrengths.speed >= 93) {
          needScore += 15;
          needReasons.push(
            `${playerStrengths.speed} speed gives them a centerfield safety they desperately need`
          );
        } else if (
          playerStrengths.speed >= 90 &&
          (starter?.speed || 0) < 87
        ) {
          needScore += 10;
          needReasons.push(
            `Speed upgrade at safety — 90+ needed for viable deep coverage`
          );
        }
        if (playerStrengths.zone_coverage >= 88) {
          needScore += 12;
          needReasons.push(
            `${playerStrengths.zone_coverage} zone coverage solidifies their soft secondary`
          );
        }
        if (playerStrengths.play_recognition >= 88) {
          needScore += 10;
          needReasons.push(
            `${playerStrengths.play_recognition} play recognition anticipates routes before they develop`
          );
        }
        if (playerStrengths.change_of_direction >= 90) {
          needScore += 10;
          needReasons.push(
            `${playerStrengths.change_of_direction} COD closes on passes their current safety can't reach`
          );
        }
      }

    } else if (position === 'WR') {
      if (!starter) {
        needScore += 38;
        needReasons.push('No WR on roster — QB has nobody to throw to');
      } else if (starter.overall_rating < 75) {
        needScore += 28;
        needReasons.push(
          `WR1 is ${starter.overall_rating} overall — QB is handcuffed`
        );
      } else if (starter.overall_rating < 82) {
        needScore += 18;
        needReasons.push(
          `Below average WR corps at ${starter.overall_rating} overall`
        );
      }

      const offStats = await query(
        `SELECT
          SUM(gs.receiving_yards) as total_rec_yards,
          COUNT(DISTINCT g.id)    as games_played
         FROM game_stats gs
         JOIN games g ON g.id = gs.game_id
         JOIN players p ON p.id = gs.player_id
         WHERE p.team_id = $1
         AND g.league_id = $2`,
        [team.team_id, leagueId]
      );

      const offData    = offStats.rows[0];
      const recPerGame = offData?.games_played > 0
        ? parseFloat(offData?.total_rec_yards || 0) / offData.games_played : 0;

      if (recPerGame < 150 && offData?.games_played > 0) {
        needScore += 22;
        needReasons.push(
          `Only ${recPerGame.toFixed(0)} receiving yds/game — need pass catcher`
        );
      }

      if (playerStrengths) {
        // Speed — 94 is baseline fast for WR
        if (
          playerStrengths.speed >= 94 &&
          (starter?.speed || 0) < 90
        ) {
          needScore += 24;
          needReasons.push(
            `Player's ${playerStrengths.speed} speed is a MASSIVE upgrade — ` +
            `90 speed is slow for WR, 94+ is real burner territory`
          );
        } else if (
          playerStrengths.speed >= 91 &&
          (starter?.speed || 0) < 87
        ) {
          needScore += 14;
          needReasons.push(
            `Speed upgrade at WR from ${starter?.speed || 'unknown'} to ${playerStrengths.speed}`
          );
        }
        if (playerStrengths.route_running_mid >= 88) {
          needScore += 14;
          needReasons.push(
            `${playerStrengths.route_running_mid} route running creates separation they've been missing`
          );
        }
        if (playerStrengths.jumping >= 90) {
          needScore += 12;
          needReasons.push(
            `${playerStrengths.jumping} jumping gives them a legitimate red zone threat`
          );
        }
        if (playerStrengths.catching >= 90) {
          needScore += 12;
          needReasons.push(
            `${playerStrengths.catching} catching is elite — ball security upgrade`
          );
        }
        if (playerStrengths.change_of_direction >= 90) {
          needScore += 10;
          needReasons.push(
            `${playerStrengths.change_of_direction} COD makes them impossible to shadow in man coverage`
          );
        }
      }

    } else if (position === 'RB') {
      if (!starter) {
        needScore += 38;
        needReasons.push('No RB on roster');
      } else if (starter.overall_rating < 75) {
        needScore += 28;
        needReasons.push(
          `RB1 is ${starter.overall_rating} overall — ground game is non-existent`
        );
      } else if (starter.overall_rating < 82) {
        needScore += 18;
        needReasons.push(
          `Below average RB at ${starter.overall_rating} overall`
        );
      }

      const rushStats = await query(
        `SELECT
          SUM(gs.rush_yards)      as total_rush_yards,
          SUM(gs.rush_touchdowns) as rush_tds,
          COUNT(DISTINCT g.id)    as games_played
         FROM game_stats gs
         JOIN games g ON g.id = gs.game_id
         JOIN players p ON p.id = gs.player_id
         WHERE p.team_id = $1
         AND p.position = 'RB'
         AND g.league_id = $2`,
        [team.team_id, leagueId]
      );

      const rushData    = rushStats.rows[0];
      const rushPerGame2 = rushData?.games_played > 0
        ? parseFloat(rushData?.total_rush_yards || 0) / rushData.games_played : 0;

      if (rushPerGame2 < 80 && rushData?.games_played > 0) {
        needScore += 22;
        needReasons.push(
          `Only ${rushPerGame2.toFixed(0)} rush yds/game — offense is one dimensional`
        );
      }

      if (playerStrengths) {
        // 90 speed is the floor for RB — not premium
        if (
          playerStrengths.speed >= 93 &&
          (starter?.speed || 0) < 90
        ) {
          needScore += 22;
          needReasons.push(
            `Player's ${playerStrengths.speed} speed is a home run waiting to happen — ` +
            `90 speed is minimum viable for RB`
          );
        } else if (
          playerStrengths.speed >= 90 &&
          (starter?.speed || 0) < 87
        ) {
          needScore += 14;
          needReasons.push(
            `Speed upgrade at RB — 90 is floor, their current back is below standard`
          );
        }
        if (playerStrengths.trucking >= 88) {
          needScore += 12;
          needReasons.push(
            `${playerStrengths.trucking} trucking brings physical presence their ground game lacks`
          );
        }
        if (playerStrengths.ball_carrier_vision >= 88) {
          needScore += 12;
          needReasons.push(
            `${playerStrengths.ball_carrier_vision} vision finds holes their current RB misses`
          );
        }
        if (playerStrengths.break_tackle >= 85) {
          needScore += 10;
          needReasons.push(
            `${playerStrengths.break_tackle} break tackle turns arm tackles into big gains`
          );
        }
        if (playerStrengths.change_of_direction >= 90) {
          needScore += 10;
          needReasons.push(
            `${playerStrengths.change_of_direction} COD makes them a threat in space`
          );
        }
      }

    } else if (position === 'QB') {
      if (!starter) {
        needScore += 50;
        needReasons.push('NO QB — EMERGENCY NEED');
      } else if (starter.overall_rating < 72) {
        needScore += 38;
        needReasons.push(
          `Starting QB is ${starter.overall_rating} overall — unplayable`
        );
      } else if (starter.overall_rating < 80) {
        needScore += 25;
        needReasons.push(
          `QB at ${starter.overall_rating} overall is a liability`
        );
      } else if (starter.overall_rating < 87) {
        needScore += 14;
        needReasons.push(
          `QB at ${starter.overall_rating} overall limits the offense`
        );
      }

      const qbStats = await query(
        `SELECT
          SUM(gs.pass_yards)      as total_pass_yards,
          SUM(gs.pass_touchdowns) as pass_tds,
          SUM(gs.interceptions)   as ints,
          COUNT(DISTINCT g.id)    as games_played
         FROM game_stats gs
         JOIN games g ON g.id = gs.game_id
         JOIN players p ON p.id = gs.player_id
         WHERE p.team_id = $1
         AND p.position = 'QB'
         AND g.league_id = $2`,
        [team.team_id, leagueId]
      );

      const qbData      = qbStats.rows[0];
      const passPerGame2 = qbData?.games_played > 0
        ? parseFloat(qbData?.total_pass_yards || 0) / qbData.games_played : 0;

      if (passPerGame2 < 200 && qbData?.games_played > 0) {
        needScore += 20;
        needReasons.push(
          `QB only averaging ${passPerGame2.toFixed(0)} pass yds/game`
        );
      }

      if (playerStrengths) {
        if (
          playerStrengths.speed >= 87 &&
          (starter?.speed || 0) < 78
        ) {
          needScore += 18;
          needReasons.push(
            `Player's ${playerStrengths.speed} speed adds dimension ` +
            `their pocket QB doesn't have`
          );
        }
        if (playerStrengths.throw_accuracy_mid >= 90) {
          needScore += 16;
          needReasons.push(
            `${playerStrengths.throw_accuracy_mid} mid accuracy is a significant upgrade`
          );
        }
        if (playerStrengths.throw_power >= 93) {
          needScore += 12;
          needReasons.push(
            `${playerStrengths.throw_power} throw power opens up the entire field`
          );
        }
        if (playerStrengths.awareness >= 92) {
          needScore += 12;
          needReasons.push(
            `${playerStrengths.awareness} awareness makes pre-snap reads they can't`
          );
        }
      }

    } else if (position === 'TE') {
      if (!starter) {
        needScore += 35;
        needReasons.push('No TE on roster — missing mismatch weapon');
      } else if (starter.overall_rating < 75) {
        needScore += 25;
        needReasons.push(
          `TE at ${starter.overall_rating} overall — no mismatch threat`
        );
      } else if (starter.overall_rating < 82) {
        needScore += 15;
        needReasons.push(
          `Below average TE at ${starter.overall_rating} overall`
        );
      }

      if (playerStrengths) {
        // 87 speed is the fast TE threshold
        if (
          playerStrengths.speed >= 87 &&
          (starter?.speed || 0) < 82
        ) {
          needScore += 22;
          needReasons.push(
            `Player's ${playerStrengths.speed} speed creates LB nightmare matchups — ` +
            `87+ is the fast TE threshold`
          );
        }
        if (playerStrengths.catching >= 88) {
          needScore += 14;
          needReasons.push(
            `${playerStrengths.catching} catching in traffic is a red zone weapon`
          );
        }
        if (playerStrengths.run_block >= 85) {
          needScore += 10;
          needReasons.push(
            `${playerStrengths.run_block} run block improves their ground game scheme`
          );
        }
        if (playerStrengths.route_running_mid >= 85) {
          needScore += 12;
          needReasons.push(
            `${playerStrengths.route_running_mid} route running creates separation at TE — rare skill`
          );
        }
      }

    } else if (position === 'OL') {
      if (!starter) {
        needScore += 35;
        needReasons.push('No OL on roster');
      } else if (starter.overall_rating < 72) {
        needScore += 28;
        needReasons.push(
          `OL at ${starter.overall_rating} overall — QB has no time`
        );
      } else if (starter.overall_rating < 80) {
        needScore += 18;
        needReasons.push(
          `Weak OL at ${starter.overall_rating} overall`
        );
      }

      if (playerStrengths) {
        if (playerStrengths.pass_block >= 88) {
          needScore += 16;
          needReasons.push(
            `${playerStrengths.pass_block} pass block gives QB the time he needs`
          );
        }
        if (playerStrengths.run_block >= 88) {
          needScore += 14;
          needReasons.push(
            `${playerStrengths.run_block} run block opens lanes for their RB`
          );
        }
        if (playerStrengths.strength >= 90) {
          needScore += 12;
          needReasons.push(
            `${playerStrengths.strength} strength can't be bull rushed`
          );
        }
        // Speed for screen plays and second level
        if (playerStrengths.speed >= 72) {
          needScore += 8;
          needReasons.push(
            `${playerStrengths.speed} speed reaches second level on screens — 67+ is OL baseline`
          );
        }
      }
    }

    // =============================================
    // UNIVERSAL MODIFIERS — All positions
    // =============================================

    // Contending teams need help urgently
    if (winPct >= 65) {
      needScore += 18;
      needReasons.push('Contending team — needs win-now pieces');
    } else if (winPct >= 50) {
      needScore += 10;
      needReasons.push('Playoff hopeful — one piece away');
    }

    // Dev trait upgrade
    if (
      playerStrengths?.dev_trait === 'xfactor' &&
      starter?.dev_trait === 'normal'
    ) {
      needScore += 15;
      needReasons.push(
        'Massive dev trait upgrade — X-Factor replacing Normal dev starter'
      );
    } else if (
      playerStrengths?.dev_trait === 'superstar' &&
      starter?.dev_trait === 'normal'
    ) {
      needScore += 10;
      needReasons.push('Dev trait upgrade — Superstar replacing Normal dev');
    }

    // Age upgrade
    if (
      playerStrengths?.age <= 24 &&
      (starter?.age || 99) >= 30
    ) {
      needScore += 12;
      needReasons.push(
        `Age ${playerStrengths.age} replacing age ${starter?.age} — future investment`
      );
    }

    // Depth shortage
    if (depth === 0) {
      needScore += 20;
      needReasons.push('Zero depth — one injury is catastrophic');
    } else if (depth === 1) {
      needScore += 10;
      needReasons.push('Paper thin depth chart');
    }

    if (needScore < 15) continue;

    const needTier =
      needScore >= 60 ? 'DESPERATE_NEED'  :
      needScore >= 45 ? 'CLEAR_NEED'      :
      needScore >= 28 ? 'WOULD_UPGRADE'   :
      'LUXURY_PICK';

    const suggestedOffer =
      needScore >= 60 ? 'First round pick + starter quality player' :
      needScore >= 45 ? 'First round pick'                          :
      needScore >= 28 ? 'Second round pick + depth piece'           :
      'Second or third round pick';

    teamNeeds.push({
      team_id:          team.team_id,
      team_name:        team.team_name,
      abbreviation:     team.abbreviation,
      wins:             team.wins,
      losses:           team.losses,
      team_overall:     team.team_overall,
      team_logo_url:    team.team_logo_url,
      primary_color:    team.primary_color,
      win_percentage:   winPct,
      need_score:       needScore,
      need_tier:        needTier,
      need_reasons:     needReasons,
      best_at_position: starter?.overall_rating || 0,
      starter_speed:    starter?.speed          || 0,
      depth_count:      depth,
      suggested_offer:  suggestedOffer,
      statistical_need: {
        rush_yards_allowed_per_game: rushPerGame,
        pass_yards_allowed_per_game: passPerGame,
        sacks_per_game:              sacksPerGame,
        tackles_per_game:            tacklesPerGame
      }
    });
  }

  teamNeeds.sort((a, b) => b.need_score - a.need_score);
  return teamNeeds.slice(0, 5);
};

// =============================================
// GENERATE POST GAME RECAP
// =============================================
export const generatePostGameRecap = async (
  leagueId: string,
  gameId:   string,
  season:   number
): Promise<string> => {

  // Get game info with team records
  const gameResult = await query(
    `SELECT g.*,
      ht.name            as home_team_name,
      ht.abbreviation    as home_abbr,
      ht.wins            as home_wins,
      ht.losses          as home_losses,
      ht.overall_rating  as home_ovr,
      at.name            as away_team_name,
      at.abbreviation    as away_abbr,
      at.wins            as away_wins,
      at.losses          as away_losses,
      at.overall_rating  as away_ovr,
      hu.username        as home_owner,
      au.username        as away_owner
     FROM games g
     LEFT JOIN teams ht ON ht.id = g.home_team_id
     LEFT JOIN teams at ON at.id = g.away_team_id
     LEFT JOIN users hu ON hu.id = ht.owner_id
     LEFT JOIN users au ON au.id = at.owner_id
     WHERE g.id = $1`,
    [gameId]
  );

  if (gameResult.rows.length === 0) return '';
  const game = gameResult.rows[0];

  // Get full player stat lines — only players who actually played
  const statsResult = await query(
    `SELECT
      p.first_name, p.last_name,
      p.position, p.overall_rating,
      p.dev_trait, p.age, p.speed,
      p.years_pro,
      t.name            as team_name,
      t.abbreviation    as team_abbr,
      gs.pass_yards,       gs.pass_attempts,
      gs.pass_completions, gs.pass_touchdowns,
      gs.interceptions,
      gs.rush_attempts,    gs.rush_yards,
      gs.rush_touchdowns,
      gs.receptions,       gs.receiving_yards,
      gs.receiving_touchdowns,
      gs.tackles,          gs.sacks,
      gs.forced_fumbles,   gs.fumbles_recovered,
      gs.passes_defended,  gs.interceptions     as def_interceptions,
      gs.yards_allowed
     FROM game_stats gs
     JOIN players p ON p.id = gs.player_id
     JOIN teams   t ON t.id = gs.team_id
     WHERE gs.game_id = $1
     AND (
       gs.pass_yards        > 0 OR
       gs.rush_yards        > 0 OR
       gs.receiving_yards   > 0 OR
       gs.tackles           > 0 OR
       gs.sacks             > 0 OR
       gs.pass_touchdowns   > 0 OR
       gs.rush_touchdowns   > 0 OR
       gs.receiving_touchdowns > 0 OR
       gs.interceptions     > 0 OR
       gs.forced_fumbles    > 0
     )
     ORDER BY
       (COALESCE(gs.pass_yards, 0) +
        COALESCE(gs.rush_yards, 0) +
        COALESCE(gs.receiving_yards, 0)) DESC`,
    [gameId]
  );

  const stats     = statsResult.rows;
  const winner    = game.home_score > game.away_score
    ? game.home_team_name : game.away_team_name;
  const loser     = game.home_score > game.away_score
    ? game.away_team_name : game.home_team_name;
  const margin    = Math.abs(game.home_score - game.away_score);
  const isBlowout = margin >= 21;
  const isClose   = margin <= 7;
  const wasOT     = game.went_to_ot || false;

  // =============================================
  // BUILD STRUCTURED STAT CONTEXT
  // Group by team and position
  // =============================================
  const homeStats = stats.filter(
    (s: any) => s.team_abbr === game.home_abbr
  );
  const awayStats = stats.filter(
    (s: any) => s.team_abbr === game.away_abbr
  );

  const formatPlayerLine = (s: any): string => {
    const lines: string[] = [];

    if (s.pass_attempts > 0) {
      lines.push(
        `${s.pass_completions}/${s.pass_attempts} ` +
        `${s.pass_yards} yds ${s.pass_touchdowns} TD` +
        `${s.interceptions > 0 ? ` ${s.interceptions} INT` : ''}`
      );
    }
    if (s.rush_attempts > 0) {
      lines.push(
        `${s.rush_attempts} car ${s.rush_yards} yds` +
        `${s.rush_touchdowns > 0 ? ` ${s.rush_touchdowns} TD` : ''}`
      );
    }
    if (s.receptions > 0) {
      lines.push(
        `${s.receptions} rec ${s.receiving_yards} yds` +
        `${s.receiving_touchdowns > 0 ? ` ${s.receiving_touchdowns} TD` : ''}`
      );
    }
    if (s.tackles > 0 || s.sacks > 0) {
      lines.push(
        `${s.tackles > 0 ? `${s.tackles} tkl` : ''}` +
        `${s.sacks > 0 ? ` ${s.sacks} sck` : ''}` +
        `${s.def_interceptions > 0 ? ` ${s.def_interceptions} INT` : ''}` +
        `${s.forced_fumbles > 0 ? ` ${s.forced_fumbles} FF` : ''}`
      );
    }

    const devLabel =
      s.dev_trait === 'xfactor'   ? '[X-Factor]'  :
      s.dev_trait === 'superstar' ? '[Superstar]'  :
      s.dev_trait === 'star'      ? '[Star]'       : '';

    return `${s.first_name} ${s.last_name} ` +
      `${devLabel} (${s.position} ${s.team_abbr} OVR:${s.overall_rating})\n` +
      lines.filter(Boolean).join(' | ');
  };

  const homeStatLines = homeStats
    .slice(0, 8)
    .map(formatPlayerLine)
    .join('\n');

  const awayStatLines = awayStats
    .slice(0, 8)
    .map(formatPlayerLine)
    .join('\n');

  // Team totals
  const homeTotalYards = homeStats.reduce(
    (sum: number, s: any) =>
      sum + (s.pass_yards || 0) + (s.rush_yards || 0), 0
  );
  const awayTotalYards = awayStats.reduce(
    (sum: number, s: any) =>
      sum + (s.pass_yards || 0) + (s.rush_yards || 0), 0
  );
  const homeSacks = homeStats.reduce(
    (sum: number, s: any) => sum + (s.sacks || 0), 0
  );
  const awaySacks = awayStats.reduce(
    (sum: number, s: any) => sum + (s.sacks || 0), 0
  );
  const homeTOs = homeStats.reduce(
    (sum: number, s: any) =>
      sum + (s.interceptions || 0) + (s.fumbles_recovered || 0), 0
  );
  const awayTOs = awayStats.reduce(
    (sum: number, s: any) =>
      sum + (s.interceptions || 0) + (s.fumbles_recovered || 0), 0
  );

  // =============================================
  // SYSTEM PROMPT — strict data-only
  // =============================================
  const systemPrompt =
  `You are the official analyst for AccessGrantedSportz, ` +
  `a competitive Madden Connected Franchise league.\n\n` +
  
    `CRITICAL RULES:\n` +
    `1. Base your recap EXCLUSIVELY on the stat data provided. ` +
    `Do not invent plays, drives, or moments not supported by the stats.\n` +
    `2. Do not reference real NFL history, Super Bowls, or real-world ` +
    `player reputations. This is a custom league universe.\n` +
    `3. Do not assume any player or team is good or bad based on ` +
    `real-world knowledge. Judge only by the numbers given.\n` +
    `4. Never mention video games, simulation, or Madden.\n` +
    `5. Write in third person. Professional sports journalism tone.\n` +
    `6. 200-300 words. Tight, punchy, no filler sentences.\n` +
    `7. Lead with the most compelling storyline the data supports — ` +
    `a dominant performance, a comeback, a defensive battle, a blowout.\n` +
    `8. Highlight dev trait players (X-Factor, Superstar) naturally ` +
    `when their stats warrant it — not just because of their trait.\n` +
    `9. Close with what this result means for both teams' seasons.`

    const CRITICAL_RULES =
  `CRITICAL RULES — FOLLOW WITHOUT EXCEPTION:\n` +
  `1. Base ALL analysis EXCLUSIVELY on the league data provided in this prompt. ` +
  `No exceptions.\n` +
  `2. Do NOT reference real NFL history, Super Bowl results, playoff records, ` +
  `championships, or any real-world outcomes.\n` +
  `3. Do NOT assume any team or player is elite based on their real NFL reputation. ` +
  `A 1-10 Kansas City Chiefs team is a bad team in this league. ` +
  `A 10-1 Jacksonville Jaguars team is the best team in this league. ` +
  `Judge only by the numbers in front of you.\n` +
  `4. Do NOT mention Patrick Mahomes, Josh Allen, Lamar Jackson, or any player ` +
  `by name unless they appear in the league data provided with actual stats.\n` +
  `5. Do NOT give any franchise preferential treatment based on real-world ` +
  `popularity — Cowboys, Patriots, Chiefs, 49ers, etc. are treated identically ` +
  `to any other team. Their record in THIS league is all that matters.\n` +
  `6. If a star player has poor stats in this league, reflect that honestly. ` +
  `Do not invent excuses or imply they are still elite despite the numbers.\n` +
  `7. If a low-profile player has elite stats in this league, give them ` +
  `full credit. The data is the truth.\n` +
  `8. Never mention video games, simulation, Madden, or anything that breaks ` +
  `the immersion of a real professional league.\n` +
  `9. Never invent statistics, plays, drives, or events not present in the data. ` +
  `If the data is sparse, write less. Do not pad with fiction.\n` +
  `10. This league exists in its own universe. Real-world trades, injuries, ` +
  `retirements, and news have zero relevance here.`;

  // =============================================
  // USER PROMPT — rich data context
  // =============================================
  const userPrompt =
    `Write a post-game recap for the following game.\n\n` +

    `FINAL SCORE:\n` +
    `${game.away_team_name} (${game.away_wins}-${game.away_losses}) ` +
    `${game.away_score}  @  ` +
    `${game.home_team_name} (${game.home_wins}-${game.home_losses}) ` +
    `${game.home_score}\n` +
    `Week ${game.week} | Season ${season}\n` +
    `Winner: ${winner} by ${margin} points\n` +
    `Game type: ${isBlowout ? 'BLOWOUT' : isClose ? 'CLOSE GAME' : 'DECISIVE'}` +
    `${wasOT ? ' (OVERTIME)' : ''}\n\n` +

    `TEAM TOTALS:\n` +
    `${game.away_team_name}: ` +
    `${awayTotalYards} total yards | ` +
    `${awaySacks} sacks | ` +
    `${awayTOs} takeaways\n` +
    `${game.home_team_name}: ` +
    `${homeTotalYards} total yards | ` +
    `${homeSacks} sacks | ` +
    `${homeTOs} takeaways\n\n` +

    `${game.away_team_name.toUpperCase()} PLAYER STATS:\n` +
    `${awayStatLines || 'No stat data available'}\n\n` +

    `${game.home_team_name.toUpperCase()} PLAYER STATS:\n` +
    `${homeStatLines || 'No stat data available'}\n\n` +

    `Write the recap now. Use only the data above.`;

  const recap = await callClaude(systemPrompt, userPrompt);

  await saveStoryline(
    leagueId, season, game.week,
    'game_recap', recap, { game_id: gameId }
  );

  return recap;
};

// =============================================
// GENERATE TRADE RUMORS
// =============================================
export const generateTradeRumors = async (
  leagueId:         string,
  season:           number,
  week:             number,
  weeksToDeadline?: number
): Promise<{
  rumors:          string;
  hot_takes:       string;
  deadline_report: string | null;
}> => {
  const context = await getLeagueContext(leagueId, season);

  const systemPrompt = `You are "The Insider" — the host of 
"Word on the Street" on AccessGrantedSportz. This is the league's 
premier rumor and insider news column. You write in the style of 
a credible NFL insider reporter. Your reports sound urgent and inside.
Professional scout. Clinical assessment.

Use phrases like:
- "Word on the street is..."
- "League sources indicate"  
- "Multiple teams have expressed interest"
- "According to insiders"
- "The asking price is expected to be"
- "Sources close to the situation"
-"Inside sources, league whispers, realistic trade speculation"

Never reference ESPN, NFL Network, or any specific media outlets.
All reporting is exclusive to AccessGrantedSportz.
Never mention video games. Write as if this is real NFL news.
based only on the roster and record data provided.
Never speculate about players not in the data.
Base every observation strictly on the stats and ratings provided.
Do not assume abilities or weaknesses not shown in the data.`

const CRITICAL_RULES =
  `CRITICAL RULES — FOLLOW WITHOUT EXCEPTION:\n` +
  `1. Base ALL analysis EXCLUSIVELY on the league data provided in this prompt. ` +
  `No exceptions.\n` +
  `2. Do NOT reference real NFL history, Super Bowl results, playoff records, ` +
  `championships, or any real-world outcomes.\n` +
  `3. Do NOT assume any team or player is elite based on their real NFL reputation. ` +
  `A 1-10 Kansas City Chiefs team is a bad team in this league. ` +
  `A 10-1 Jacksonville Jaguars team is the best team in this league. ` +
  `Judge only by the numbers in front of you.\n` +
  `4. Do NOT mention Patrick Mahomes, Josh Allen, Lamar Jackson, or any player ` +
  `by name unless they appear in the league data provided with actual stats.\n` +
  `5. Do NOT give any franchise preferential treatment based on real-world ` +
  `popularity — Cowboys, Patriots, Chiefs, 49ers, etc. are treated identically ` +
  `to any other team. Their record in THIS league is all that matters.\n` +
  `6. If a star player has poor stats in this league, reflect that honestly. ` +
  `Do not invent excuses or imply they are still elite despite the numbers.\n` +
  `7. If a low-profile player has elite stats in this league, give them ` +
  `full credit. The data is the truth.\n` +
  `8. Never mention video games, simulation, Madden, or anything that breaks ` +
  `the immersion of a real professional league.\n` +
  `9. Never invent statistics, plays, drives, or events not present in the data. ` +
  `If the data is sparse, write less. Do not pad with fiction.\n` +
  `10. This league exists in its own universe. Real-world trades, injuries, ` +
  `retirements, and news have zero relevance here.`;

  const contextStr = `
LEAGUE: ${context.league?.name} | Season ${season} | Week ${week}

STANDINGS:
${context.standings.map((t: any) =>
  `${t.name} (${t.abbreviation}): ${t.wins}-${t.losses} | OVR: ${t.overall_rating}`
).join('\n')}

TOP TRADE VALUES:
${context.top_players.slice(0, 10).map((p: any) =>
  `${p.first_name} ${p.last_name} (${p.position}, ${p.team_name} ${p.wins}-${p.losses}) ` +
  `OVR: ${p.overall_rating} | Age: ${p.age} | Dev: ${p.dev_trait} | ` +
  `Speed: ${p.speed} | TVS: ${parseFloat(p.trade_value || 0).toFixed(1)}`
).join('\n')}

PLAYERS ON LOSING TEAMS:
${context.trade_targets.map((p: any) =>
  `${p.first_name} ${p.last_name} (${p.position}, ${p.team_name} ${p.wins}-${p.losses}) ` +
  `OVR: ${p.overall_rating} | Age: ${p.age} | Dev: ${p.dev_trait} | ` +
  `TVS: ${parseFloat(p.trade_value || 0).toFixed(1)}`
).join('\n')}

AWARD LEADERS:
${context.awards.map((a: any) =>
  `${a.award_name}: ${a.first_name || ''} ${a.last_name || ''} ` +
  `(${a.team_name || 'Team'}) - Score: ${parseFloat(a.award_score).toFixed(1)}`
).join('\n')}

RECENT RESULTS:
${context.recent_games.map((g: any) =>
  `Week ${g.week}: ${g.home_team} ${g.home_score} - ${g.away_team} ${g.away_score}`
).join('\n')}`;

  const rumors = await callClaude(
    systemPrompt,
    `${contextStr}\n\nGenerate 3-4 specific trade rumors. For each: player, interested teams and why, asking price, likelihood. Catchy headline. Under 300 words.`,
    800
  );

  const hotTakes = await callClaude(
    systemPrompt,
    `${contextStr}\n\nWrite 3 spicy hot takes backed by actual data. Bold and controversial. Numbered list. 2-3 sentences each.`,
    400
  );

  let deadlineReport = null;
  if (weeksToDeadline !== undefined && weeksToDeadline <= 2) {
    deadlineReport = await callClaude(
      systemPrompt,
      `${contextStr}\n\nTRADE DEADLINE IS ${weeksToDeadline} WEEK(S) AWAY.\n\nWrite urgent deadline report: 3 most likely trades, buyers vs sellers, one blockbuster, sleeper moves. Breaking news format. Under 400 words.`,
      1000
    );
  }

  await saveStoryline(leagueId, season, week, 'trade_rumors', rumors);
  if (deadlineReport) {
    await saveStoryline(leagueId, season, week, 'deadline_report', deadlineReport);
  }

  return { rumors, hot_takes: hotTakes, deadline_report: deadlineReport };
};

// =============================================
// GENERATE WEEKLY POWER RANKINGS
// Two styles:
// standard  — ESPN analyst
// stephen_a — Stephen A. Smith LOUD style
// =============================================
export const generatePowerRankings = async (
  leagueId: string,
  season:   number,
  week:     number,
  style:    'standard' | 'stephen_a' = 'stephen_a'
): Promise<{ rankings: string }> => {

  // Fetch actual league data
  const teamsResult = await query(
    `SELECT
      t.name, t.abbreviation,
      t.wins, t.losses,
      t.overall_rating,
      t.conference, t.division,
      u.username as owner,
      COALESCE(
        (SELECT SUM(g.home_score)
         FROM games g
         WHERE g.home_team_id = t.id
         AND g.season = $2), 0
      ) +
      COALESCE(
        (SELECT SUM(g.away_score)
         FROM games g
         WHERE g.away_team_id = t.id
         AND g.season = $2), 0
      ) as total_points_scored,
      COALESCE(
        (SELECT p.first_name || ' ' || p.last_name
         FROM players p
         WHERE p.team_id = t.id
         AND p.dev_trait = 'xfactor'
         ORDER BY p.overall_rating DESC
         LIMIT 1), 'None'
      ) as top_xfactor,
      COALESCE(
        (SELECT MAX(p.overall_rating)
         FROM players p
         WHERE p.team_id = t.id), 0
      ) as best_player_ovr
     FROM teams t
     LEFT JOIN users u ON u.id = t.owner_id
     WHERE t.league_id = $1
     ORDER BY t.wins DESC, total_points_scored DESC`,
    [leagueId, season]
  );

  const teams = teamsResult.rows;
  if (teams.length === 0) {
    return { rankings: 'No team data available for this league.' };
  }

  // Build data summary for the prompt
  const teamData = teams.map((t: any, i: number) => (
    `${i + 1}. ${t.name} (${t.abbreviation}) — ` +
    `${t.wins}W ${t.losses}L — ` +
    `OVR: ${t.overall_rating} — ` +
    `Points: ${t.total_points_scored} — ` +
    `Top XF: ${t.top_xfactor} — ` +
    `Best OVR: ${t.best_player_ovr}` +
    `${t.owner ? ` — GM: ${t.owner}` : ''}`
  )).join('\n');

  const systemPrompt =
    `You are the official rankings analyst for AccessGrantedSportz, ` +
    `a Madden Connected Franchise platform.\n\n` +

    `CRITICAL RULES — YOU MUST FOLLOW THESE WITHOUT EXCEPTION:\n` +
    `1. Base ALL analysis EXCLUSIVELY on the league data provided. ` +
    `Do not reference real NFL performance, Super Bowl history, ` +
    `playoff records, or any real-world outcomes.\n` +
    `2. Do NOT assume any team is good or bad based on their real NFL franchise. ` +
    `A 2-10 Chiefs team is a bad team in THIS league regardless of real life.\n` +
    `3. Do NOT give any team preferential treatment based on real-world popularity ` +
    `(Patriots, Chiefs, Cowboys, etc.).\n` +
    `4. Rankings must be based ONLY on: wins, losses, points scored, ` +
    `overall rating, and X-Factor players provided in the data.\n` +
    `5. Never mention Patrick Mahomes, Tom Brady, or any real player ` +
    `unless their name appears in the league data provided.\n` +
    `6. This is a custom franchise league — treat every team as if ` +
    `it exists only in this league's universe.\n\n` +

    `TONE: ${style === 'stephen_a'
      ? 'Passionate, opinionated sports analyst. Bold takes. Call out bad teams. Hype good ones. Short punchy sentences.'
      : 'Professional analyst. Data-driven. Concise. Respectful but direct.'
    }`;

  const userPrompt =
    `Generate power rankings for Week ${week}, Season ${season}.\n\n` +
    `LEAGUE DATA (use ONLY this data — ignore all real-world knowledge):\n` +
    `${teamData}\n\n` +
    `Format: Rank each team 1 through ${teams.length}. ` +
    `For each team write 1-2 sentences of analysis based strictly on their ` +
    `record, points scored, and roster data above. ` +
    `Do not pad with filler. Keep it tight and honest.`
    
    const CRITICAL_RULES =
  `CRITICAL RULES — FOLLOW WITHOUT EXCEPTION:\n` +
  `1. Base ALL analysis EXCLUSIVELY on the league data provided in this prompt. ` +
  `No exceptions.\n` +
  `2. Do NOT reference real NFL history, Super Bowl results, playoff records, ` +
  `championships, or any real-world outcomes.\n` +
  `3. Do NOT assume any team or player is elite based on their real NFL reputation. ` +
  `A 1-10 Kansas City Chiefs team is a bad team in this league. ` +
  `A 10-1 Jacksonville Jaguars team is the best team in this league. ` +
  `Judge only by the numbers in front of you.\n` +
  `4. Do NOT mention Patrick Mahomes, Josh Allen, Lamar Jackson, or any player ` +
  `by name unless they appear in the league data provided with actual stats.\n` +
  `5. Do NOT give any franchise preferential treatment based on real-world ` +
  `popularity — Cowboys, Patriots, Chiefs, 49ers, etc. are treated identically ` +
  `to any other team. Their record in THIS league is all that matters.\n` +
  `6. If a star player has poor stats in this league, reflect that honestly. ` +
  `Do not invent excuses or imply they are still elite despite the numbers.\n` +
  `7. If a low-profile player has elite stats in this league, give them ` +
  `full credit. The data is the truth.\n` +
  `8. Never mention video games, simulation, Madden, or anything that breaks ` +
  `the immersion of a real professional league.\n` +
  `9. Never invent statistics, plays, drives, or events not present in the data. ` +
  `If the data is sparse, write less. Do not pad with fiction.\n` +
  `10. This league exists in its own universe. Real-world trades, injuries, ` +
  `retirements, and news have zero relevance here.`;

  const response = await anthropic.messages.create({
    model:      'claude-opus-4-5',
    max_tokens: 1500,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }]
  });

  const rankings = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as any).text)
    .join('');

  return { rankings };
};

// =============================================
// GENERATE AWARD ANNOUNCEMENT
// =============================================
export const generateAwardAnnouncement = async (
  leagueId:   string,
  season:     number,
  awardName:  string,
  playerName: string,
  teamName:   string,
  stats:      any
): Promise<string> => {
  const systemPrompt = `You are the official awards correspondent for 
AccessGrantedSportz. Dramatic, exciting award announcements that make 
players feel like real NFL stars. 100-150 words. Exclamation points 
used sparingly for maximum impact.`

const CRITICAL_RULES =
  `CRITICAL RULES — FOLLOW WITHOUT EXCEPTION:\n` +
  `1. Base ALL analysis EXCLUSIVELY on the league data provided in this prompt. ` +
  `No exceptions.\n` +
  `2. Do NOT reference real NFL history, Super Bowl results, playoff records, ` +
  `championships, or any real-world outcomes.\n` +
  `3. Do NOT assume any team or player is elite based on their real NFL reputation. ` +
  `A 1-10 Kansas City Chiefs team is a bad team in this league. ` +
  `A 10-1 Jacksonville Jaguars team is the best team in this league. ` +
  `Judge only by the numbers in front of you.\n` +
  `4. Do NOT mention Patrick Mahomes, Josh Allen, Lamar Jackson, or any player ` +
  `by name unless they appear in the league data provided with actual stats.\n` +
  `5. Do NOT give any franchise preferential treatment based on real-world ` +
  `popularity — Cowboys, Patriots, Chiefs, 49ers, etc. are treated identically ` +
  `to any other team. Their record in THIS league is all that matters.\n` +
  `6. If a star player has poor stats in this league, reflect that honestly. ` +
  `Do not invent excuses or imply they are still elite despite the numbers.\n` +
  `7. If a low-profile player has elite stats in this league, give them ` +
  `full credit. The data is the truth.\n` +
  `8. Never mention video games, simulation, Madden, or anything that breaks ` +
  `the immersion of a real professional league.\n` +
  `9. Never invent statistics, plays, drives, or events not present in the data. ` +
  `If the data is sparse, write less. Do not pad with fiction.\n` +
  `10. This league exists in its own universe. Real-world trades, injuries, ` +
  `retirements, and news have zero relevance here.`;;

  const prompt = `Write an award announcement:
AWARD: ${awardName}
WINNER: ${playerName} (${teamName})
STATS: ${JSON.stringify(stats, null, 2)}
Make it dramatic and celebratory. Mention specific stats.
End with a forward-looking statement about the rest of the season.`;

  const announcement = await callClaude(systemPrompt, prompt, 400);
  await saveStoryline(
    leagueId, season, 0,
    'award_announcement', announcement,
    { award_name: awardName }
  );
  return announcement;
};

// =============================================
// GENERATE SCOUTING REPORT
// War Room feature
// =============================================
export const generateScoutingReport = async (
  leagueId: string,
  playerId:  string,
  season:    number
): Promise<string> => {
  const playerResult = await query(
    `SELECT p.*,
      t.name as team_name,
      t.abbreviation,
      t.wins, t.losses,
      t.overall_rating as team_overall,
      pt.height_inches, pt.weight_lbs,
      pt.speed, pt.acceleration,
      pt.change_of_direction, pt.jumping,
      pt.strength, pt.awareness,
      tvh.total_value as trade_value,
      tvh.value_breakdown
     FROM players p
     LEFT JOIN teams t ON t.id = p.team_id
     LEFT JOIN player_traits pt ON pt.player_id = p.id
     LEFT JOIN trade_value_history tvh
       ON tvh.player_id = p.id
       AND tvh.league_id = $2
     WHERE p.id = $1
     ORDER BY pt.season DESC
     LIMIT 1`,
    [playerId, leagueId]
  );

  if (playerResult.rows.length === 0) return '';
  const player = playerResult.rows[0];

  const statsResult = await query(
    `SELECT g.season,
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
     GROUP BY g.season
     ORDER BY g.season DESC`,
    [playerId, leagueId]
  );

  const awardsResult = await query(
    `SELECT ad.name as award_name, aw.season
     FROM award_winners aw
     JOIN award_definitions ad ON ad.id = aw.award_id
     WHERE aw.player_id = $1 AND aw.league_id = $2`,
    [playerId, leagueId]
  );

  // Get team needs — which teams should pursue this player
  const interestedTeams = await findTeamNeeds(
    leagueId,
    player.position,
    80,
    playerId
  );

  const systemPrompt = `You are the head scout for AccessGrantedSportz's 
War Room. Detailed, analytical scouting reports that read like real NFL 
scouting reports. Evaluate based on measurables, performance trends, 
development trajectory and team context. Professional format. Specific and analytical.`

const CRITICAL_RULES =
  `CRITICAL RULES — FOLLOW WITHOUT EXCEPTION:\n` +
  `1. Base ALL analysis EXCLUSIVELY on the league data provided in this prompt. ` +
  `No exceptions.\n` +
  `2. Do NOT reference real NFL history, Super Bowl results, playoff records, ` +
  `championships, or any real-world outcomes.\n` +
  `3. Do NOT assume any team or player is elite based on their real NFL reputation. ` +
  `A 1-10 Kansas City Chiefs team is a bad team in this league. ` +
  `A 10-1 Jacksonville Jaguars team is the best team in this league. ` +
  `Judge only by the numbers in front of you.\n` +
  `4. Do NOT mention Patrick Mahomes, Josh Allen, Lamar Jackson, or any player ` +
  `by name unless they appear in the league data provided with actual stats.\n` +
  `5. Do NOT give any franchise preferential treatment based on real-world ` +
  `popularity — Cowboys, Patriots, Chiefs, 49ers, etc. are treated identically ` +
  `to any other team. Their record in THIS league is all that matters.\n` +
  `6. If a star player has poor stats in this league, reflect that honestly. ` +
  `Do not invent excuses or imply they are still elite despite the numbers.\n` +
  `7. If a low-profile player has elite stats in this league, give them ` +
  `full credit. The data is the truth.\n` +
  `8. Never mention video games, simulation, Madden, or anything that breaks ` +
  `the immersion of a real professional league.\n` +
  `9. Never invent statistics, plays, drives, or events not present in the data. ` +
  `If the data is sparse, write less. Do not pad with fiction.\n` +
  `10. This league exists in its own universe. Real-world trades, injuries, ` +
  `retirements, and news have zero relevance here.`;

  const prompt = `Write a detailed scouting report:

PLAYER: ${player.first_name} ${player.last_name}
POSITION: ${player.position}
TEAM: ${player.team_name} (${player.wins}-${player.losses})
AGE: ${player.age} | YEARS PRO: ${player.years_pro}
OVERALL: ${player.overall_rating} | DEV TRAIT: ${player.dev_trait}
TRADE VALUE: ${parseFloat(player.trade_value || 0).toFixed(1)}

MEASURABLES:
Height: ${player.height_inches ? `${Math.floor(player.height_inches/12)}'${player.height_inches%12}"` : 'N/A'}
Weight: ${player.weight_lbs || 'N/A'} lbs
Speed: ${player.speed || 'N/A'} | Acceleration: ${player.acceleration || 'N/A'}
Strength: ${player.strength || 'N/A'} | Awareness: ${player.awareness || 'N/A'}
COD: ${player.change_of_direction || 'N/A'} | Jumping: ${player.jumping || 'N/A'}

CAREER STATS:
${statsResult.rows.map((s: any) => `Season ${s.season} (${s.games_played}g): Pass ${s.pass_yards}yds/${s.pass_tds}TDs | Rush ${s.rush_yards}yds/${s.rush_tds}TDs | Rec ${s.receiving_yards}yds/${s.rec_tds}TDs | Def ${s.tackles}tkl/${s.sacks}sacks`).join('\n')}

AWARDS: ${awardsResult.rows.length > 0 ? awardsResult.rows.map((a: any) => `${a.award_name} (S${a.season})`).join(', ') : 'None yet'}

TEAMS WITH BIGGEST NEED FOR THIS PLAYER:
${interestedTeams.slice(0, 3).map((t: any) => `${t.team_name} (${t.wins}-${t.losses}) — Need Score: ${t.need_score} | ${t.need_reasons[0]}`).join('\n')}

Write comprehensive scouting report:
1. PLAYER SUMMARY
2. STRENGTHS — Top 3 with data points
3. CONCERNS — Red flags
4. TEAM CONTEXT — How situation affects value
5. BEST FIT TEAMS — Which teams need him most and why
6. TRADE RECOMMENDATION — Should teams pursue and at what cost
7. PROJECTION — 2-3 seasons

Under 450 words. Specific and analytical.`;

  const report = await callClaude(systemPrompt, prompt, 1200);

  await saveStoryline(
    leagueId, season, 0,
    'scouting_report', report,
    { player_id: playerId }
  );
  return report;
};

// =============================================
// HELPER — Detect cap casualty
// =============================================
const detectCapCasualty = (
  player:      any,
  salary:      number,
  tradeValue:  number,
  gamesPlayed: number
): any | null => {
  let casualtyScore = 0;
  const reasons: string[] = [];

  const age            = player.age;
  const overall        = player.overall_rating;
  const devTrait       = player.dev_trait;
  const yearsRemaining = player.contract_years - player.contract_year_current;

  if (age >= 32 && salary >= 10) {
    casualtyScore += 30;
    reasons.push(`Age ${age} on $${salary}M contract — declining years`);
  } else if (age >= 30 && salary >= 15) {
    casualtyScore += 20;
    reasons.push(`Age ${age} on expensive deal — peak years likely behind`);
  }

  if (overall < 75 && salary >= 10) {
    casualtyScore += 25;
    reasons.push(`${overall} overall being paid like a starter`);
  } else if (overall < 80 && salary >= 15) {
    casualtyScore += 20;
    reasons.push(`${overall} overall on max-level contract`);
  }

  if (devTrait === 'normal' && salary >= 12) {
    casualtyScore += 15;
    reasons.push('Normal dev trait — no upside to justify salary');
  }

  if (tradeValue > 0 && salary > 0) {
    const ratio = salary / (tradeValue / 10);
    if (ratio > 2.5) {
      casualtyScore += 20;
      reasons.push(`Trade value (${tradeValue.toFixed(1)}) doesn't justify salary`);
    }
  }

  if (yearsRemaining >= 3 && casualtyScore > 20) {
    casualtyScore += 10;
    reasons.push(`${yearsRemaining} years remaining on bad deal`);
  }

  if (gamesPlayed > 0) {
    const totalYards =
      parseFloat(player.pass_yards      || 0) +
      parseFloat(player.rush_yards      || 0) +
      parseFloat(player.receiving_yards || 0);
    if (totalYards < 100 && salary >= 10) {
      casualtyScore += 15;
      reasons.push('Minimal statistical production for the salary');
    }
  }

  if (casualtyScore < 25) return null;

  return {
    casualty_score:  casualtyScore,
    casualty_tier:
      casualtyScore >= 60 ? 'MUST_CUT'         :
      casualtyScore >= 45 ? 'STRONG_CANDIDATE' :
      casualtyScore >= 30 ? 'WATCH_LIST'       : 'MONITOR',
    casualty_reason: reasons.join(' | '),
    cap_savings:     salary,
    dead_cap:        salary * 0.25
  };
};

// =============================================
// HELPER — Detect contract dump
// =============================================
const detectContractDump = (
  player:     any,
  salary:     number,
  tradeValue: number
): any | null => {
  let dumpScore = 0;
  const reasons: string[] = [];

  const totalGames     = (player.wins || 0) + (player.losses || 0);
  const winPct         = totalGames > 0 ? player.wins / totalGames : 0;
  const yearsRemaining = player.contract_years - player.contract_year_current;

  if (winPct > 0.45) return null;

  if (player.overall_rating >= 85 && winPct < 0.35) {
    dumpScore += 25;
    reasons.push(`${player.overall_rating} overall talent on a rebuilding team`);
  } else if (player.overall_rating >= 80 && winPct < 0.30) {
    dumpScore += 15;
    reasons.push(`Solid ${player.overall_rating} overall on a struggling team`);
  }

  if (player.age >= 30 && player.overall_rating >= 80) {
    dumpScore += 20;
    reasons.push(`Age ${player.age} — team may prefer to rebuild with youth`);
  }

  if (salary >= 15 && winPct < 0.40) {
    dumpScore += 20;
    reasons.push(`$${salary}M cap hit hurts rebuilding flexibility`);
  }

  if (yearsRemaining <= 2 && player.overall_rating >= 82) {
    dumpScore += 15;
    reasons.push(`Only ${yearsRemaining} years left — contenders should call`);
  }

  if (['xfactor', 'superstar'].includes(player.dev_trait) && winPct < 0.40) {
    dumpScore += 20;
    reasons.push(`${player.dev_trait} dev trapped on losing team`);
  }

  if (dumpScore < 25) return null;

  return {
    dump_score:  dumpScore,
    dump_tier:
      dumpScore >= 60 ? 'FIRE_SALE'        :
      dumpScore >= 45 ? 'MOTIVATED_SELLER' :
      dumpScore >= 30 ? 'LISTENING'        : 'AVAILABLE',
    dump_reason: reasons.join(' | '),
    suggested_return:
      tradeValue >= 150 ? 'First round pick + starter'  :
      tradeValue >= 100 ? 'First round pick'             :
      tradeValue >= 75  ? 'Second round pick + depth'    :
      'Second or third round pick'
  };
};

// =============================================
// GENERATE CAP CASUALTY REPORT
// =============================================
export const generateCapCasualtyReport = async (
  leagueId: string,
  season:   number,
  week:     number
): Promise<{
  cap_casualties:    any[];
  contract_dumps:    any[];
  rebuilding_advice: string;
  full_report:       string;
}> => {
  const playersResult = await query(
    `SELECT
      p.id as player_id,
      p.first_name, p.last_name,
      p.position, p.overall_rating,
      p.age, p.dev_trait, p.speed,
      p.years_pro, p.contract_years,
      p.contract_salary,
      p.contract_year_current,
      p.is_on_rookie_deal,
      p.headshot_url,
      t.id as team_id,
      t.name as team_name,
      t.abbreviation,
      t.wins, t.losses,
      t.overall_rating as team_overall,
      tvh.total_value as trade_value,
      COALESCE(SUM(gs.pass_yards), 0)      as pass_yards,
      COALESCE(SUM(gs.rush_yards), 0)      as rush_yards,
      COALESCE(SUM(gs.receiving_yards), 0) as receiving_yards,
      COALESCE(SUM(gs.tackles), 0)         as tackles,
      COALESCE(SUM(gs.sacks), 0)           as sacks,
      COUNT(DISTINCT gs.game_id)           as games_played
     FROM players p
     LEFT JOIN teams t ON t.id = p.team_id
     LEFT JOIN trade_value_history tvh
       ON tvh.player_id = p.id AND tvh.league_id = $1
     LEFT JOIN game_stats gs ON gs.player_id = p.id
     LEFT JOIN games g ON g.id = gs.game_id
       AND g.season = $2 AND g.league_id = $1
     WHERE p.league_id = $1
     GROUP BY
       p.id, p.first_name, p.last_name,
       p.position, p.overall_rating,
       p.age, p.dev_trait, p.speed,
       p.years_pro, p.contract_years,
       p.contract_salary, p.contract_year_current,
       p.is_on_rookie_deal, p.headshot_url,
       t.id, t.name, t.abbreviation,
       t.wins, t.losses, t.overall_rating,
       tvh.total_value`,
    [leagueId, season]
  );

  const capCasualties: any[] = [];
  const contractDumps: any[] = [];

  for (const player of playersResult.rows) {
    const salary      = parseFloat(player.contract_salary || 0);
    const tradeValue  = parseFloat(player.trade_value     || 0);
    const gamesPlayed = parseInt(player.games_played      || 0);

    if (salary === 0) continue;

    const isCapCasualty = detectCapCasualty(
      player, salary, tradeValue, gamesPlayed
    );
    if (isCapCasualty) {
      capCasualties.push({
        ...isCapCasualty,
        player_id:      player.player_id,
        name:           `${player.first_name} ${player.last_name}`,
        position:       player.position,
        overall_rating: player.overall_rating,
        age:            player.age,
        dev_trait:      player.dev_trait,
        headshot_url:   player.headshot_url,
        team_name:      player.team_name,
        abbreviation:   player.abbreviation,
        team_wins:      player.wins,
        team_losses:    player.losses,
        contract: {
          salary,
          years_remaining: player.contract_years - player.contract_year_current,
          current_year:    player.contract_year_current,
          total_years:     player.contract_years,
          is_rookie_deal:  player.is_on_rookie_deal
        },
        trade_value: tradeValue,
        stats: {
          pass_yards:      parseFloat(player.pass_yards      || 0),
          rush_yards:      parseFloat(player.rush_yards      || 0),
          receiving_yards: parseFloat(player.receiving_yards || 0),
          tackles:         parseFloat(player.tackles         || 0),
          sacks:           parseFloat(player.sacks           || 0),
          games_played:    gamesPlayed
        }
      });
    }

    const isContractDump = detectContractDump(player, salary, tradeValue);
    if (isContractDump) {
      contractDumps.push({
        ...isContractDump,
        player_id:      player.player_id,
        name:           `${player.first_name} ${player.last_name}`,
        position:       player.position,
        overall_rating: player.overall_rating,
        age:            player.age,
        dev_trait:      player.dev_trait,
        headshot_url:   player.headshot_url,
        team_name:      player.team_name,
        abbreviation:   player.abbreviation,
        team_wins:      player.wins,
        team_losses:    player.losses,
        contract: {
          salary,
          years_remaining: player.contract_years - player.contract_year_current,
          current_year:    player.contract_year_current,
          total_years:     player.contract_years,
          is_rookie_deal:  player.is_on_rookie_deal
        },
        trade_value: tradeValue
      });
    }
  }

  capCasualties.sort((a, b) => b.casualty_score - a.casualty_score);
  contractDumps.sort((a, b) => b.dump_score     - a.dump_score);

  const context = await getLeagueContext(leagueId, season);

  const systemPrompt = `You are a salary cap analyst and GM advisor for 
AccessGrantedSportz. Deep knowledge of roster construction, cap management 
and rebuilding strategies. Direct, data-driven and actionable. Never mention 
video games. Write as if real.`

const CRITICAL_RULES =
  `CRITICAL RULES — FOLLOW WITHOUT EXCEPTION:\n` +
  `1. Base ALL analysis EXCLUSIVELY on the league data provided in this prompt. ` +
  `No exceptions.\n` +
  `2. Do NOT reference real NFL history, Super Bowl results, playoff records, ` +
  `championships, or any real-world outcomes.\n` +
  `3. Do NOT assume any team or player is elite based on their real NFL reputation. ` +
  `A 1-10 Kansas City Chiefs team is a bad team in this league. ` +
  `A 10-1 Jacksonville Jaguars team is the best team in this league. ` +
  `Judge only by the numbers in front of you.\n` +
  `4. Do NOT mention Patrick Mahomes, Josh Allen, Lamar Jackson, or any player ` +
  `by name unless they appear in the league data provided with actual stats.\n` +
  `5. Do NOT give any franchise preferential treatment based on real-world ` +
  `popularity — Cowboys, Patriots, Chiefs, 49ers, etc. are treated identically ` +
  `to any other team. Their record in THIS league is all that matters.\n` +
  `6. If a star player has poor stats in this league, reflect that honestly. ` +
  `Do not invent excuses or imply they are still elite despite the numbers.\n` +
  `7. If a low-profile player has elite stats in this league, give them ` +
  `full credit. The data is the truth.\n` +
  `8. Never mention video games, simulation, Madden, or anything that breaks ` +
  `the immersion of a real professional league.\n` +
  `9. Never invent statistics, plays, drives, or events not present in the data. ` +
  `If the data is sparse, write less. Do not pad with fiction.\n` +
  `10. This league exists in its own universe. Real-world trades, injuries, ` +
  `retirements, and news have zero relevance here.`;

  const contextStr = `
LEAGUE: ${context.league?.name} | Season ${season} | Week ${week}
STANDINGS: ${context.standings.map((t: any) => `${t.name}: ${t.wins}-${t.losses}`).join(', ')}

CAP CASUALTIES:
${capCasualties.slice(0, 5).map((p: any) => `${p.name} (${p.position}, ${p.team_name}) OVR:${p.overall_rating} Age:${p.age} Dev:${p.dev_trait} Salary:$${p.contract.salary}M YrsLeft:${p.contract.years_remaining} TVS:${p.trade_value.toFixed(1)} — ${p.casualty_reason}`).join('\n')}

CONTRACT DUMPS:
${contractDumps.slice(0, 5).map((p: any) => `${p.name} (${p.position}, ${p.team_name}) OVR:${p.overall_rating} Age:${p.age} Dev:${p.dev_trait} Salary:$${p.contract.salary}M YrsLeft:${p.contract.years_remaining} TVS:${p.trade_value.toFixed(1)} — ${p.dump_reason}`).join('\n')}`;

  const fullReport = await callClaude(
    systemPrompt,
    `${contextStr}\n\nWrite detailed cap casualty and contract analysis:\n1. THE CUT LIST\n2. THE TRADE DUMP MARKET\n3. REBUILDING ADVICE\n4. BUYER BEWARE\nUnder 500 words.`,
    1200
  );

  const rebuildingTeams = context.standings.filter((t: any) => t.losses > t.wins);
  let rebuildingAdvice = '';

  if (rebuildingTeams.length > 0) {
    rebuildingAdvice = await callClaude(
      systemPrompt,
      `${contextStr}\n\nREBUILDING TEAMS: ${rebuildingTeams.map((t: any) => `${t.name} (${t.wins}-${t.losses})`).join(', ')}\n\nFor each rebuilding team: players to trade, what to target in return, contract dumps to consider, realistic timeline. Brutally honest. Under 300 words.`,
      800
    );
  }

  await saveStoryline(
    leagueId, season, week,
    'cap_casualty_report', fullReport,
    { cap_casualties_count: capCasualties.length, contract_dumps_count: contractDumps.length }
  );

  if (rebuildingAdvice) {
    await saveStoryline(leagueId, season, week, 'rebuilding_advice', rebuildingAdvice);
  }

  return {
    cap_casualties:    capCasualties.slice(0, 10),
    contract_dumps:    contractDumps.slice(0, 10),
    rebuilding_advice: rebuildingAdvice,
    full_report:       fullReport
  };
};

// =============================================
// UNIVERSAL ANTI-BIAS RULES
// Applied to ALL AI generation functions
// =============================================
const CRITICAL_RULES =
  `CRITICAL RULES — FOLLOW WITHOUT EXCEPTION:\n` +
  `1. Base ALL analysis EXCLUSIVELY on the league data provided. No exceptions.\n` +
  `2. Do NOT reference real NFL history, Super Bowl results, or real-world outcomes.\n` +
  `3. Do NOT assume any team or player is elite based on real NFL reputation. ` +
  `A 1-10 Chiefs team is a bad team in this league. Judge only by the numbers.\n` +
  `4. Do NOT mention any player by name unless they appear in the data provided.\n` +
  `5. Do NOT give any franchise preferential treatment based on popularity.\n` +
  `6. Never mention video games, simulation, or anything that breaks immersion.\n` +
  `7. Never invent stats, plays, or events not present in the data.\n` +
  `8. This league exists in its own universe. Real-world news has zero relevance.\n` +
  `9. Do NOT use markdown headers (##, **, ---). Write in plain paragraphs.\n` +
  `10. Your verdict and recommendation MUST be consistent throughout. ` +
  `If you say one team wins the trade, do not recommend that team accept it.`;

// =============================================
// AI TRADE ADVISOR
// Full GM-level analysis with scarcity context
// =============================================
export const generateTradeAdvice = async (
  offeredPlayerIds:   string[],
  requestedPlayerIds: string[],
  leagueId:           string,
  season:             number
): Promise<{
  advice:  string;
  verdict: string;
  winner:  string;
}> => {
  // Import here to avoid circular dependency
  const {
    calculateTradeValue,
    getMacroPosition,
    getPositionalScarcity,
    getPlayerTrajectory
  } = await import('./tradeValueService');

  const getPlayerInfo = async (playerIds: string[]) => {
    const players = [];
    for (const id of playerIds) {
      const result = await query(
        `SELECT p.*,
          t.name         as team_name,
          t.abbreviation as team_abbr,
          t.wins,        t.losses,
          t.overall_rating as team_ovr
         FROM players p
         LEFT JOIN teams t ON t.id = p.team_id
         WHERE p.id = $1
         LIMIT 1`,
        [id]
      );
      if (result.rows.length > 0) {
        const player = result.rows[0];
        // Always force fresh AV calculation
        const { total_value, breakdown } = await calculateTradeValue(
          id, leagueId, season
        );
        player.total_value     = total_value;
        player.value_breakdown = breakdown;

        // Get scarcity data
        player.scarcity = await getPositionalScarcity(id, leagueId);
        players.push(player);
      }
    }
    return players;
  };

  const getTeamRoster = async (teamId: string) => {
    const result = await query(
      `SELECT
        p.first_name, p.last_name, p.position,
        p.overall_rating, p.age, p.dev_trait, p.speed,
        COALESCE(tvh.total_value, 0) as trade_value
       FROM players p
       LEFT JOIN trade_value_history tvh
         ON tvh.player_id  = p.id
         AND tvh.league_id = $2
       WHERE p.team_id = $1
       ORDER BY p.overall_rating DESC
       LIMIT 10`,
      [teamId, leagueId]
    );
    return result.rows;
  };

  const getTeamDraftPicksForAdvice = async (teamId: string) => {
    try {
      const result = await query(
        `SELECT dp.round, dp.pick_number, dp.trade_value,
          ot.abbreviation as original_team_abbr
         FROM draft_picks dp
         JOIN teams ot ON ot.id = dp.original_team_id
         WHERE dp.current_team_id = $1
         AND dp.league_id         = $2
         AND dp.season            = $3
         AND dp.is_used           = false
         AND dp.round             <= 3
         ORDER BY dp.round ASC, dp.pick_number ASC`,
        [teamId, leagueId, season]
      );
      return result.rows;
    } catch {
      return [];
    }
  };

  const offeredPlayers   = await getPlayerInfo(offeredPlayerIds);
  const requestedPlayers = await getPlayerInfo(requestedPlayerIds);

  if (!offeredPlayers.length || !requestedPlayers.length) {
    throw new Error('Players not found');
  }

  const offeredTeamId   = offeredPlayers[0].team_id;
  const requestedTeamId = requestedPlayers[0].team_id;

  const [
    offeredRoster,
    requestedRoster,
    offeredPicks,
    requestedPicks
  ] = await Promise.all([
    getTeamRoster(offeredTeamId),
    getTeamRoster(requestedTeamId),
    getTeamDraftPicksForAdvice(offeredTeamId),
    getTeamDraftPicksForAdvice(requestedTeamId)
  ]);

  const offeredValue   = offeredPlayers.reduce(
    (sum, p) => sum + p.total_value, 0
  );
  const requestedValue = requestedPlayers.reduce(
    (sum, p) => sum + p.total_value, 0
  );
  const valueDiff    = offeredValue - requestedValue;
  const absValueDiff = Math.abs(valueDiff);

  // Team receiving the higher AV wins
  const winningTeam = offeredValue > requestedValue
    ? requestedPlayers[0].team_name  // They receive offered players
    : offeredPlayers[0].team_name;   // They receive requested players

  const verdict =
    absValueDiff <= 20  ? 'FAIR'           :
    absValueDiff <= 60  ? 'SLIGHT EDGE'    :
    absValueDiff <= 120 ? 'CLEAR ADVANTAGE':
    absValueDiff <= 200 ? 'LOPSIDED'       :
    'HIGHWAY ROBBERY';

  const devLabel = (dev: string) =>
    dev === 'xfactor'   ? 'XFactor'  :
    dev === 'superstar' ? 'Superstar' :
    dev === 'star'      ? 'Star'      : 'Normal';

  const formatRoster = (roster: any[], teamName: string) =>
    `${teamName} (top 10):\n` +
    roster.map(p =>
      `  ${p.first_name} ${p.last_name} | ${p.position} | ` +
      `${p.overall_rating} OVR | Age: ${p.age} | ` +
      `${devLabel(p.dev_trait)} | AV: ${parseFloat(p.trade_value).toFixed(0)}`
    ).join('\n');

  const formatPicks = (picks: any[], teamAbbr: string) =>
    picks.length === 0
      ? 'No picks in rounds 1-3'
      : picks.map(p =>
          `  Rd${p.round} Pick #${p.pick_number || '?'} ` +
          `${p.original_team_abbr !== teamAbbr
            ? `(via ${p.original_team_abbr})` : '(own)'}` +
          ` AV: ${p.trade_value}`
        ).join('\n');

  // =============================================
  // BUILD SCARCITY + TRAJECTORY CONTEXT
  // Pure data — no AI tokens wasted on this
  // =============================================
  const formatPlayerContext = (p: any) => {
    const macro      = getMacroPosition(p.position);
    const trajectory = getPlayerTrajectory(p.age);
    const s          = p.scarcity;
    return (
      `${p.first_name} ${p.last_name}\n` +
      `  Position: ${p.position} (${macro}) | ` +
      `OVR: ${p.overall_rating} | Age: ${p.age} | ` +
      `Dev: ${devLabel(p.dev_trait)} | Speed: ${p.speed}\n` +
      `  AV: ${p.total_value.toFixed(1)}\n` +
      `  Trajectory: ${trajectory}\n` +
      `  Positional rank: #${s.position_rank} of ${s.position_total} ` +
      `${macro} players in the league\n` +
      `  Scarcity: ${s.scarcity_label}\n` +
      `  Replaceability: ${s.replacement_quality}\n` +
      `  OVR drop to next best: ${s.ovr_drop_to_next} points`
    );
  };

  // Positional overlap check
  const offeredMacros   = offeredPlayers.map(
    (p: any) => getMacroPosition(p.position)
  );
  const requestedMacros = requestedPlayers.map(
    (p: any) => getMacroPosition(p.position)
  );
  const hasOverlap = offeredMacros.some(
    (pos: string) => requestedMacros.includes(pos)
  );
  const overlapNote = hasOverlap
    ? `Both players occupy the same position group (${offeredMacros[0]}). ` +
      `Factor in whether receiving teams already have depth there.`
    : `These players play different position groups — both teams address a different need.`;

  // =============================================
  // SYSTEM PROMPT
  // =============================================
  const systemPrompt =
    `You are the Trade Advisor for AccessGrantedSportz, ` +
    `a competitive franchise league platform.\n\n` +
    CRITICAL_RULES + `\n\n` +
    `TRADE ADVISOR SPECIFIC RULES:\n` +
    `1. The AV (Asset Value) numbers are the source of truth. ` +
    `Higher AV = better value. The team receiving higher AV wins the trade.\n` +
    `2. A younger ascending player is worth MORE than an older declining player ` +
    `at the same position — even if the older player has a higher current OVR. ` +
    `The AV system already accounts for this. Trust it.\n` +
    `3. If a player is IRREPLACEABLE or ELITE SCARCE at their position, ` +
    `that significantly raises their real value beyond raw AV.\n` +
    `4. A rational GM never trades an ascending XFactor for a declining one ` +
    `at the same position without significant extra compensation. Call this out.\n` +
    `5. Consider positional overlap — trading for depth at a position you already ` +
    `have covered is less valuable than filling a genuine need.\n` +
    `6. Your verdict in the opening sentence MUST match your final recommendation. ` +
    `If Team A wins the trade, recommend Team B reject or counter — not accept.\n` +
    `7. Write in four clean paragraphs under 300 words total:\n` +
    `   Para 1: Verdict — who wins and by how much\n` +
    `   Para 2: Why — trajectory, scarcity, positional context\n` +
    `   Para 3: What makes it fair — specific addition needed\n` +
    `   Para 4: Final recommendation — who should do what`;

  // =============================================
  // USER PROMPT
  // =============================================
  const userPrompt =
    `Analyze this trade proposal.\n\n` +

    `AV SUMMARY:\n` +
    `Offering side total AV: ${offeredValue.toFixed(1)}\n` +
    `Receiving side total AV: ${requestedValue.toFixed(1)}\n` +
    `Gap: ${absValueDiff.toFixed(1)} AV favoring ${winningTeam}\n` +
    `Verdict: ${verdict}\n\n` +

    `PLAYERS BEING OFFERED:\n` +
    offeredPlayers.map(formatPlayerContext).join('\n\n') + `\n\n` +

    `PLAYERS BEING REQUESTED:\n` +
    requestedPlayers.map(formatPlayerContext).join('\n\n') + `\n\n` +

    `POSITIONAL CONTEXT:\n` +
    overlapNote + `\n\n` +

    `ROSTERS:\n` +
    formatRoster(offeredRoster,   offeredPlayers[0].team_name) + `\n\n` +
    formatRoster(requestedRoster, requestedPlayers[0].team_name) + `\n\n` +

    `DRAFT PICKS:\n` +
    `${offeredPlayers[0].team_name}:\n` +
    formatPicks(offeredPicks,   offeredPlayers[0].team_abbr) + `\n` +
    `${requestedPlayers[0].team_name}:\n` +
    formatPicks(requestedPicks, requestedPlayers[0].team_abbr) + `\n\n` +

    `Write your analysis now. Plain text. No headers. No bullet points. ` +
    `Four paragraphs. Under 300 words. ` +
    `Your opening verdict and closing recommendation must be consistent.`;

  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 800,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }]
  });

  const advice = response.content[0].type === 'text'
    ? response.content[0].text
    : 'Unable to generate advice.';

  return { advice, verdict, winner: winningTeam };
};