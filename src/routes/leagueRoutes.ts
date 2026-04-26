import { Router } from 'express';
import { 
  create, 
  getAll, 
  getOne, 
  update, 
  remove 
} from '../controllers/leagueController';
import { protect } from '../middleware/authMiddleware';
import { query } from '../config/database';

const router = Router();

router.use(protect);

// POST /api/leagues
router.post('/', create);

// GET /api/leagues
router.get('/', getAll);

// GET /api/leagues/:id/export-url
// Must be before /:id route to avoid conflict
router.get('/:id/export-url', async (req: any, res: any) => {
  try {
    const leagueId = req.params.id;
    const userId   = req.user.id;

    const result = await query(
      `SELECT id, name, api_key FROM leagues 
       WHERE id = $1 AND owner_id = $2`,
      [leagueId, userId]
    );

    if (result.rows.length === 0) {
      res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
      return;
    }

    const league  = result.rows[0];
    const baseUrl = 'https://accessgrantedsportz-backend-production.up.railway.app';
    const key     = league.api_key;

    res.status(200).json({
      success: true,
      urls: {
        league_info:  `${baseUrl}/api/ingest/madden/${leagueId}/leagueinfo?key=${key}`,
        rosters:      `${baseUrl}/api/ingest/madden/${leagueId}/rosters?key=${key}`,
        weekly_stats: `${baseUrl}/api/ingest/madden/${leagueId}/week?key=${key}`
      },
      instructions: [
        '1. Open Madden Companion App',
        '2. Go to your franchise → tap Export',
        '3. Paste league_info URL → check LEAGUE INFO → Export',
        '4. Paste rosters URL → check ROSTERS → Export',
        '5. Paste weekly_stats URL → select week → check WEEKLY STATS → Export',
        '6. Repeat step 5 for each week',
        '7. After each week advance: export LEAGUE INFO + ROSTERS + WEEKLY STATS'
      ]
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// GET /api/leagues/:id
router.get('/:id', getOne);

// PUT /api/leagues/:id
router.put('/:id', update);

// DELETE /api/leagues/:id
router.delete('/:id', remove);

router.get('/:leagueId/teams', async (req, res) => {
  try {
    const { leagueId } = req.params;
    
    // Fetch all teams for the league and join with users table to get the owner's username
    const result = await query(
      `SELECT t.*, u.username as owner_username
       FROM teams t
       LEFT JOIN users u ON u.id = t.owner_id
       WHERE t.league_id = $1
       ORDER BY t.conference ASC, t.division ASC, t.name ASC`,
      [leagueId]
    );
    
    res.json({ teams: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load teams' });
  }

  router.get('/:leagueId/teams/:teamId', async (req, res) => {
  try {
    const { leagueId, teamId } = req.params;

    // 1. Get the Team Info
    const teamRes = await query(
      `SELECT t.*, u.username as owner_username 
       FROM teams t 
       LEFT JOIN users u ON u.id = t.owner_id 
       WHERE t.id = $1 AND t.league_id = $2`,
      [teamId, leagueId]
    );

    if (teamRes.rows.length === 0) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // 2. Get the Roster (Joined with Trade Value)
    const rosterRes = await query(
      `SELECT p.id, p.first_name, p.last_name, p.position, p.overall_rating, p.age, p.dev_trait, tvh.total_value as trade_value
       FROM players p
       LEFT JOIN trade_value_history tvh ON tvh.player_id = p.id AND tvh.league_id = $1
       WHERE p.team_id = $2 AND p.league_id = $1
       ORDER BY p.overall_rating DESC`,
      [leagueId, teamId]
    );

    // 3. Get the Draft Picks
    const picksRes = await query(
      `SELECT dp.*, ot.abbreviation as original_team_abbr
       FROM draft_picks dp
       JOIN teams ot ON ot.id = dp.original_team_id
       WHERE dp.current_team_id = $1 AND dp.league_id = $2 AND dp.is_used = false
       ORDER BY dp.season ASC, dp.round ASC`,
      [teamId, leagueId]
    );

    res.json({
      team: teamRes.rows[0],
      roster: rosterRes.rows,
      picks: picksRes.rows
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error loading team details' });
  }
});

});

export default router;