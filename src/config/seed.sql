-- =============================================
-- AccessGrantedSportz Seed Data
-- =============================================

-- =============================================
-- Dev Trait Multipliers
-- =============================================
INSERT INTO dev_trait_multipliers 
  (dev_trait, multiplier, description) 
VALUES
  ('normal',    1.00, 'Slow progression, low ceiling. Likely regresses after peak age. Minimal trade value beyond current overall.'),
  ('star',      1.20, 'Decent progression, average ceiling. Reliable starter with some upside. Worth slightly more than their overall suggests.'),
  ('superstar', 1.45, 'Fast progression, high ceiling. Superstar abilities activate during games. Franchise cornerstone material.'),
  ('xfactor',   1.75, 'Fastest progression, highest ceiling. X-Factor zone abilities change gameplay entirely. Worth far more than overall suggests especially at younger ages.')
ON CONFLICT (dev_trait) 
DO UPDATE SET 
  multiplier  = EXCLUDED.multiplier,
  description = EXCLUDED.description;
  

-- =============================================
-- Position Physical Benchmarks
-- Real NFL ideal measurements
-- height stored in inches, weight in lbs
-- weights are on a scale of 1-10
-- =============================================
INSERT INTO position_physical_benchmarks 
  (position, ideal_height_min_inches, ideal_height_max_inches, 
   ideal_weight_min_lbs, ideal_weight_max_lbs,
   height_weight, weight_weight, cod_weight, 
   jumping_weight, acceleration_weight, notes)
VALUES
  -- QB: Height matters for seeing over line
  -- Weight matters less, mobility important
  ('QB', 73, 78, 210, 245,
   8, 4, 6, 3, 6,
   'Taller QBs see over line better. Mobility valued in modern NFL'),

  -- RB: Lower center of gravity helps
  -- Weight split between power and speed builds
  ('RB', 68, 72, 195, 235,
   4, 8, 9, 6, 9,
   'COD and acceleration critical. Weight determines power vs speed back'),

  -- WR: Height for jump balls, speed for separation
  ('WR', 70, 76, 175, 215,
   8, 5, 8, 9, 8,
   'Height wins red zone targets. Jumping critical for contested catches'),

  -- TE: Big receiver hybrid, needs both size and athleticism
  ('TE', 74, 78, 240, 270,
   8, 7, 6, 7, 6,
   'Modern TEs need receiving ability. Size still matters for blocking'),

  -- OL: Bigger is generally better
  -- Height for blocking angles, weight for anchor
  ('OL', 74, 79, 295, 340,
   7, 9, 3, 2, 5,
   'Weight critical for run blocking and pass protection anchor'),

  -- DL: Size AND athleticism required
  -- Acceleration for first step, weight to hold gap
  ('DL', 73, 78, 280, 340,
   7, 8, 5, 4, 9,
   'Acceleration off snap critical. Weight prevents being pushed by OL'),

  -- LB: Athletic hybrid, coverage and run stopping
  ('LB', 72, 76, 225, 255,
   7, 7, 8, 6, 8,
   'COD needed for coverage. Weight needed to take on blocks'),

  -- CB: Taller corners dominate modern NFL
  -- COD and jumping absolutely critical
  ('CB', 70, 75, 185, 210,
   9, 5, 10, 9, 9,
   'Height for press and jump balls. COD for route mirroring. Jumping for breakups'),

  -- S: Range and awareness most important
  -- Height helps in coverage, COD for angles
  ('S',  71, 75, 195, 220,
   7, 5, 9, 8, 8,
   'COD for pursuit angles. Jumping for pass breakups over receivers'),

  -- K/P: Height and weight matter very little
  ('K',  68, 75, 175, 215,
   2, 2, 1, 1, 2,
   'Kick power and accuracy are everything for kickers'),

  ('P',  68, 75, 175, 215,
   2, 2, 1, 1, 2,
   'Kick power and accuracy are everything for punters')

ON CONFLICT (position) DO NOTHING;

-- =============================================
-- Award Definitions
-- =============================================
INSERT INTO award_definitions 
  (name, description, category, position_eligible, is_custom)
VALUES
  -- Individual Awards
  ('League MVP', 
   'Most Valuable Player of the season. Awarded to the player with the highest overall impact score combining passing, rushing, and receiving performance.',
   'individual', NULL, false),

  ('Offensive Player of the Year',
   'Best offensive player of the season excluding QB. Awarded based on yards, touchdowns and efficiency.',
   'individual', 'RB,WR,TE', false),

  ('Defensive Player of the Year',
   'Best defensive player of the season. Awarded based on tackles, sacks, interceptions and forced fumbles.',
   'individual', 'DL,LB,CB,S', false),

  ('Offensive Rookie of the Year',
   'Best offensive rookie of the season. Player must be in their first year (years_pro = 0).',
   'individual', 'QB,RB,WR,TE', false),

  ('Defensive Rookie of the Year',
   'Best defensive rookie of the season. Player must be in their first year (years_pro = 0).',
   'individual', 'DL,LB,CB,S', false),

  ('Most Improved Player',
   'Player who showed the most statistical improvement compared to their previous season. Minimum 2 seasons required.',
   'individual', NULL, false),

  ('Comeback Player of the Year',
   'Player who returned to elite performance after a significant decline. Must have 2+ seasons of data. Rookies ineligible. Previous season must show significant statistical decline.',
   'individual', NULL, false),

  -- Team Awards
  ('Super Bowl Champion',
   'League champion. Team that wins the final playoff game of the season.',
   'team', NULL, false),

  ('Best Offense',
   'Team that scored the most points during the regular season.',
   'team', NULL, false),

  ('Best Defense',
   'Team that allowed the fewest points during the regular season.',
   'team', NULL, false),

  ('Coach of the Year',
   'Awarded to the owner/coach whose team most exceeded expectations based on preseason overall rating vs final record.',
   'team', NULL, false),

  -- Statistical Title Awards
  ('Passing Title',
   'Player with the most passing yards in the regular season. QB only. Minimum 200 pass attempts required.',
   'statistical', 'QB', false),

  ('Rushing Title',
   'Player with the most rushing yards in the regular season. Minimum 100 rush attempts required.',
   'statistical', 'QB,RB,WR,TE', false),

  ('Receiving Title',
   'Player with the most receiving yards in the regular season. Minimum 50 receptions required.',
   'statistical', 'RB,WR,TE', false),

  ('Sack Leader',
   'Player with the most sacks in the regular season. Minimum 4 games played required.',
   'statistical', 'DL,LB', false),

  ('Interception Leader',
   'Player with the most interceptions in the regular season.',
   'statistical', 'LB,CB,S', false),

  ('Touchdown Leader',
   'Player with the most total touchdowns in the regular season combining passing rushing and receiving.',
   'statistical', NULL, false)

ON CONFLICT DO NOTHING;

-- =============================================
-- Award Trade Bonuses
-- How much each award adds to trade value
-- =============================================
INSERT INTO award_trade_bonuses
  (award_definition_id, bonus_value, bonus_description, 
   is_stackable, seasons_valid)
SELECT 
  id,
  CASE name
    WHEN 'League MVP'                  THEN 15.00
    WHEN 'Offensive Player of the Year' THEN 12.00
    WHEN 'Defensive Player of the Year' THEN 12.00
    WHEN 'Offensive Rookie of the Year' THEN 8.00
    WHEN 'Defensive Rookie of the Year' THEN 8.00
    WHEN 'Most Improved Player'         THEN 6.00
    WHEN 'Comeback Player of the Year'  THEN 6.00
    WHEN 'Super Bowl Champion'          THEN 10.00
    WHEN 'Best Offense'                 THEN 5.00
    WHEN 'Best Defense'                 THEN 5.00
    WHEN 'Coach of the Year'            THEN 4.00
    WHEN 'Passing Title'                THEN 8.00
    WHEN 'Rushing Title'                THEN 8.00
    WHEN 'Receiving Title'              THEN 8.00
    WHEN 'Sack Leader'                  THEN 7.00
    WHEN 'Interception Leader'          THEN 7.00
    WHEN 'Touchdown Leader'             THEN 8.00
    ELSE 5.00
  END,
  CASE name
    WHEN 'League MVP' THEN 'MVP award adds significant trade value for 1 season'
    ELSE name || ' award bonus'
  END,
  CASE name
    WHEN 'League MVP'     THEN true
    WHEN 'Passing Title'  THEN true
    WHEN 'Rushing Title'  THEN true
    WHEN 'Receiving Title' THEN true
    WHEN 'Sack Leader'    THEN true
    ELSE false
  END,
  CASE name
    WHEN 'League MVP'     THEN 2
    WHEN 'Super Bowl Champion' THEN 2
    ELSE 1
  END
FROM award_definitions
ON CONFLICT DO NOTHING;

-- =============================================
-- Record Definitions
-- =============================================
INSERT INTO record_definitions
  (name, description, stat_column, record_type, scope)
VALUES
  -- Single Game Records
  ('Most Pass Yards - Single Game',
   'Most passing yards in a single game',
   'pass_yards', 'single_game', 'league'),

  ('Most Rush Yards - Single Game',
   'Most rushing yards in a single game',
   'rush_yards', 'single_game', 'league'),

  ('Most Receiving Yards - Single Game',
   'Most receiving yards in a single game',
   'receiving_yards', 'single_game', 'league'),

  ('Most Pass TDs - Single Game',
   'Most passing touchdowns in a single game',
   'pass_touchdowns', 'single_game', 'league'),

  ('Most Rush TDs - Single Game',
   'Most rushing touchdowns in a single game',
   'rush_touchdowns', 'single_game', 'league'),

  ('Most Receiving TDs - Single Game',
   'Most receiving touchdowns in a single game',
   'receiving_touchdowns', 'single_game', 'league'),

  ('Most Sacks - Single Game',
   'Most sacks in a single game',
   'sacks', 'single_game', 'league'),

  ('Most Tackles - Single Game',
   'Most tackles in a single game',
   'tackles', 'single_game', 'league'),

  -- Single Season Records
  ('Most Pass Yards - Season',
   'Most passing yards in a single season',
   'pass_yards', 'single_season', 'league'),

  ('Most Rush Yards - Season',
   'Most rushing yards in a single season',
   'rush_yards', 'single_season', 'league'),

  ('Most Receiving Yards - Season',
   'Most receiving yards in a single season',
   'receiving_yards', 'single_season', 'league'),

  ('Most Pass TDs - Season',
   'Most passing touchdowns in a single season',
   'pass_touchdowns', 'single_season', 'league'),

  ('Most Rush TDs - Season',
   'Most rushing touchdowns in a single season',
   'rush_touchdowns', 'single_season', 'league'),

  ('Most Receptions - Season',
   'Most receptions in a single season',
   'receptions', 'single_season', 'league'),

  ('Most Sacks - Season',
   'Most sacks in a single season',
   'sacks', 'single_season', 'league'),

  -- All Time Career Records
  ('Career Pass Yards',
   'Most passing yards in league history',
   'pass_yards', 'all_time', 'league'),

  ('Career Rush Yards',
   'Most rushing yards in league history',
   'rush_yards', 'all_time', 'league'),

  ('Career Receiving Yards',
   'Most receiving yards in league history',
   'receiving_yards', 'all_time', 'league'),

  ('Career Pass TDs',
   'Most passing touchdowns in league history',
   'pass_touchdowns', 'all_time', 'league'),

  ('Career Rush TDs',
   'Most rushing touchdowns in league history',
   'rush_touchdowns', 'all_time', 'league'),

  ('Career Sacks',
   'Most sacks in league history',
   'sacks', 'all_time', 'league'),

  ('Career Tackles',
   'Most tackles in league history',
   'tackles', 'all_time', 'league')

ON CONFLICT DO NOTHING;

-- =============================================
-- Milestone Definitions
-- =============================================
INSERT INTO milestone_definitions
  (name, description, stat_column, threshold, milestone_type)
VALUES
  -- Season Milestones
  ('1,000 Rush Yard Season',
   'Rushed for 1,000 or more yards in a single season',
   'rush_yards', 1000, 'season'),

  ('2,000 Rush Yard Season',
   'Rushed for 2,000 or more yards in a single season. Elite achievement.',
   'rush_yards', 2000, 'season'),

  ('4,000 Pass Yard Season',
   'Threw for 4,000 or more yards in a single season',
   'pass_yards', 4000, 'season'),

  ('5,000 Pass Yard Season',
   'Threw for 5,000 or more yards in a single season. Elite achievement.',
   'pass_yards', 5000, 'season'),

  ('1,000 Receiving Yard Season',
   'Caught for 1,000 or more yards in a single season',
   'receiving_yards', 1000, 'season'),

  ('100 Reception Season',
   'Caught 100 or more passes in a single season',
   'receptions', 100, 'season'),

  ('30 Touchdown Season',
   'Scored 30 or more total touchdowns in a single season',
   'pass_touchdowns', 30, 'season'),

  ('10 Sack Season',
   'Recorded 10 or more sacks in a single season',
   'sacks', 10, 'season'),

  ('20 Sack Season',
   'Recorded 20 or more sacks in a single season. Elite achievement.',
   'sacks', 20, 'season'),

  -- Career Milestones
  ('10,000 Career Rush Yards',
   'Surpassed 10,000 career rushing yards',
   'rush_yards', 10000, 'career'),

  ('50,000 Career Pass Yards',
   'Surpassed 50,000 career passing yards',
   'pass_yards', 50000, 'career'),

  ('10,000 Career Receiving Yards',
   'Surpassed 10,000 career receiving yards',
   'receiving_yards', 10000, 'career'),

  ('100 Career Sacks',
   'Surpassed 100 career sacks',
   'sacks', 100, 'career'),

  -- Single Game Milestones
  ('400 Pass Yard Game',
   'Threw for 400 or more yards in a single game',
   'pass_yards', 400, 'game'),

  ('200 Rush Yard Game',
   'Rushed for 200 or more yards in a single game',
   'rush_yards', 200, 'game'),

  ('200 Receiving Yard Game',
   'Caught for 200 or more yards in a single game',
   'receiving_yards', 200, 'game'),

  ('6 Touchdown Game',
   'Scored 6 or more total touchdowns in a single game',
   'rush_touchdowns', 6, 'game')

ON CONFLICT DO NOTHING;

-- =============================================
-- Position Trait Weights for Trade Value
-- Scale of 0.00 to 1.00
-- Higher = more important for that position
-- =============================================
INSERT INTO position_trait_weights
  (position, trait_name, weight)
VALUES
  -- QB Weights
  ('QB', 'awareness',              1.00),
  ('QB', 'throw_accuracy_short',   0.90),
  ('QB', 'throw_accuracy_mid',     0.95),
  ('QB', 'throw_accuracy_deep',    0.85),
  ('QB', 'throw_power',            0.80),
  ('QB', 'play_action',            0.70),
  ('QB', 'throw_on_run',           0.65),
  ('QB', 'speed',                  1.00),
  ('QB', 'acceleration',           0.55),
  ('QB', 'height_inches',          0.70),
  ('QB', 'weight_lbs',             0.30),

  -- RB Weights
  ('RB', 'speed',                  1.10),
  ('RB', 'acceleration',           0.99),
  ('RB', 'change_of_direction',    1.00),
  ('RB', 'agility',                0.85),
  ('RB', 'trucking',               0.80),
  ('RB', 'break_tackle',           0.90),
  ('RB', 'carrying',               0.75),
  ('RB', 'ball_carrier_vision',    0.85),
  ('RB', 'juke_move',              0.85),
  ('RB', 'stiff_arm',              0.80),
  ('RB', 'catching',               0.65),
  ('RB', 'weight_lbs',             0.70),
  ('RB', 'height_inches',          0.40),

  -- WR Weights
  ('WR', 'speed',                  1.10),
  ('WR', 'catching',               0.95),
  ('WR', 'route_running_mid',      0.90),
  ('WR', 'route_running_short',    0.85),
  ('WR', 'route_running_deep',     0.85),
  ('WR', 'acceleration',           0.90),
  ('WR', 'agility',                0.85),
  ('WR', 'change_of_direction',    0.80),
  ('WR', 'jumping',                0.85),
  ('WR', 'spectacular_catch',      0.75),
  ('WR', 'catch_in_traffic',       0.80),
  ('WR', 'release',                0.75),
  ('WR', 'height_inches',          0.80),
  ('WR', 'weight_lbs',             0.50),

  -- TE Weights
  ('TE', 'catching',               0.90),
  ('TE', 'speed',                  1.00),
  ('TE', 'route_running_mid',      0.80),
  ('TE', 'jumping',                0.80),
  ('TE', 'catch_in_traffic',       0.85),
  ('TE', 'run_block',              0.70),
  ('TE', 'pass_block',             0.65),
  ('TE', 'strength',               0.70),
  ('TE', 'height_inches',          0.85),
  ('TE', 'weight_lbs',             0.75),

  -- OL Weights
  ('OL', 'strength',               1.00),
  ('OL', 'pass_block',             0.95),
  ('OL', 'run_block',              0.95),
  ('OL', 'pass_block_power',       0.90),
  ('OL', 'run_block_power',        0.90),
  ('OL', 'pass_block_finesse',     0.80),
  ('OL', 'awareness',              0.85),
  ('OL', 'height_inches',          0.75),
  ('OL', 'weight_lbs',             0.95),

  -- DL Weights
  ('DL', 'speed',                  1.00),
  ('DL', 'acceleration',           1.00),
  ('DL', 'power_move',             0.90),
  ('DL', 'finesse_move',           0.85),
  ('DL', 'strength',               0.90),
  ('DL', 'block_shedding',         0.90),
  ('DL', 'pursuit',                0.80),
  ('DL', 'tackle',                 0.75),
  ('DL', 'height_inches',          0.75),
  ('DL', 'weight_lbs',             0.85),

  -- LB Weights
  ('LB', 'tackle',                 0.95),
  ('LB', 'speed',                  1.00),
  ('LB', 'awareness',              0.90),
  ('LB', 'pursuit',                0.85),
  ('LB', 'change_of_direction',    0.80),
  ('LB', 'man_coverage',           0.75),
  ('LB', 'zone_coverage',          0.75),
  ('LB', 'hit_power',              0.80),
  ('LB', 'strength',               0.80),
  ('LB', 'height_inches',          0.70),
  ('LB', 'weight_lbs',             0.75),

  -- CB Weights
  ('CB', 'speed',                  1.10),
  ('CB', 'change_of_direction',    1.00),
  ('CB', 'jumping',                0.95),
  ('CB', 'acceleration',           0.95),
  ('CB', 'man_coverage',           0.95),
  ('CB', 'zone_coverage',          0.85),
  ('CB', 'press',                  0.80),
  ('CB', 'agility',                0.90),
  ('CB', 'awareness',              0.85),
  ('CB', 'catch_allowed',          0.80),
  ('CB', 'height_inches',          0.90),
  ('CB', 'weight_lbs',             0.50),

  -- S Weights
  ('S',  'awareness',              1.00),
  ('S',  'speed',                  1.00),
  ('S',  'change_of_direction',    0.90),
  ('S',  'jumping',                0.85),
  ('S',  'zone_coverage',          0.90),
  ('S',  'man_coverage',           0.80),
  ('S',  'tackle',                 0.85),
  ('S',  'pursuit',                0.85),
  ('S',  'hit_power',              0.75),
  ('S',  'height_inches',          0.70),
  ('S',  'weight_lbs',             0.55),

  -- K/P Weights
  ('K',  'kick_power',             1.00),
  ('K',  'kick_accuracy',          1.00),
  ('P',  'kick_power',             1.00),
  ('P',  'kick_accuracy',          1.00)

ON CONFLICT (position, trait_name) DO NOTHING;