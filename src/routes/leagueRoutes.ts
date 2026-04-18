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

export default router;