import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// =============================================
// GET USER PROFILE
// GET /api/community/profile/:username
// =============================================
router.get('/profile/:username', async (req: any, res: any) => {
  try {
    const { username } = req.params;

    const result = await query(
      `SELECT
        u.id, u.username, u.discord_username,
        u.discord_user_id, u.created_at,
        up.gamertag, up.console, up.bio,
        up.avatar_url, up.wins, up.losses,
        up.championships, up.reputation,
        COALESCE(
          (SELECT COUNT(*) FROM league_members lm
           WHERE lm.user_id = u.id), 0
        ) as leagues_played,
        COALESCE(
          (SELECT ROUND(AVG(ur.rating), 2)
           FROM user_ratings ur
           WHERE ur.rated_user_id = u.id
           AND ur.category = 'player'), 0
        ) as player_rating,
        COALESCE(
          (SELECT COUNT(*) FROM user_ratings ur
           WHERE ur.rated_user_id = u.id
           AND ur.category = 'player'), 0
        ) as total_ratings
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE LOWER(u.username) = LOWER($1)
       LIMIT 1`,
      [username]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: 'User not found.'
      });
      return;
    }

    // Get their league history
    const leagueHistory = await query(
      `SELECT
        l.name as league_name,
        t.name as team_name,
        t.abbreviation,
        t.wins, t.losses,
        l.season
       FROM league_members lm
       JOIN leagues l ON l.id = lm.league_id
       LEFT JOIN teams t ON t.owner_id = lm.user_id
         AND t.league_id = l.id
       WHERE lm.user_id = $1
       ORDER BY l.created_at DESC
       LIMIT 10`,
      [result.rows[0].id]
    );

    // Get their reviews
    const reviews = await query(
      `SELECT
        ur.rating, ur.review,
        ur.category, ur.created_at,
        u.username as reviewer
       FROM user_ratings ur
       JOIN users u ON u.id = ur.rated_by_id
       WHERE ur.rated_user_id = $1
       ORDER BY ur.created_at DESC
       LIMIT 10`,
      [result.rows[0].id]
    );

    res.status(200).json({
      success:       true,
      profile:       result.rows[0],
      league_history: leagueHistory.rows,
      reviews:       reviews.rows
    });

  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching profile.'
    });
  }
});

// =============================================
// UPDATE USER PROFILE
// PUT /api/community/profile
// =============================================
router.put('/profile', protect, async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const {
      gamertag, console: consoleType,
      bio, avatar_url
    } = req.body;

    const existing = await query(
      `SELECT id FROM user_profiles WHERE user_id = $1`,
      [userId]
    );

    if (existing.rows.length > 0) {
      await query(
        `UPDATE user_profiles SET
          gamertag   = COALESCE($1, gamertag),
          console    = COALESCE($2, console),
          bio        = COALESCE($3, bio),
          avatar_url = COALESCE($4, avatar_url),
          updated_at = NOW()
         WHERE user_id = $5`,
        [gamertag, consoleType, bio, avatar_url, userId]
      );
    } else {
      await query(
        `INSERT INTO user_profiles (
          id, user_id, gamertag,
          console, bio, avatar_url
        )
        VALUES ($1, $2, $3, $4, $5, $6)`,
        [uuidv4(), userId, gamertag, consoleType, bio, avatar_url]
      );
    }

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully.'
    });

  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile.'
    });
  }
});

// =============================================
// RATE A USER
// POST /api/community/rate
// =============================================
router.post('/rate', protect, async (req: any, res: any) => {
  try {
    const ratedById = req.user.id;
    const {
      rated_user_id, league_id,
      rating, category, review
    } = req.body;

    if (ratedById === rated_user_id) {
      res.status(400).json({
        success: false,
        message: 'You cannot rate yourself.'
      });
      return;
    }

    if (!rating || rating < 1 || rating > 5) {
      res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5.'
      });
      return;
    }

    await query(
      `INSERT INTO user_ratings (
        id, rated_user_id, rated_by_id,
        league_id, rating, category, review
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (rated_user_id, rated_by_id, league_id, category)
      DO UPDATE SET
        rating     = EXCLUDED.rating,
        review     = EXCLUDED.review,
        created_at = NOW()`,
      [
        uuidv4(), rated_user_id, ratedById,
        league_id, rating, category, review
      ]
    );

    // Update reputation score
    await query(
      `UPDATE user_profiles SET
        reputation = (
          SELECT ROUND(AVG(rating)::numeric, 2)
          FROM user_ratings
          WHERE rated_user_id = $1
        ),
        updated_at = NOW()
       WHERE user_id = $1`,
      [rated_user_id]
    );

    res.status(200).json({
      success: true,
      message: 'Rating submitted successfully.'
    });

  } catch (error) {
    console.error('Rating error:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting rating.'
    });
  }
});

// =============================================
// GET LEAGUE LISTINGS
// GET /api/community/leagues
// =============================================
router.get('/leagues', async (req: any, res: any) => {
  try {
    const {
      console: consoleFilter,
      skill_level,
      limit = 20,
      offset = 0
    } = req.query;

    let whereClause = 'WHERE ll.is_recruiting = true';
    const params: any[] = [];
    let paramCount = 1;

    if (consoleFilter) {
      whereClause += ` AND ll.console = $${paramCount}`;
      params.push(consoleFilter);
      paramCount++;
    }

    if (skill_level) {
      whereClause += ` AND ll.skill_level = $${paramCount}`;
      params.push(skill_level);
      paramCount++;
    }

    params.push(limit, offset);

    const result = await query(
      `SELECT
        ll.*,
        l.name as league_name,
        l.season,
        l.sport,
        u.username as commissioner,
        u.discord_username as commissioner_discord,
        up.reputation as commissioner_reputation,
        COALESCE(
          (SELECT COUNT(*) FROM league_members lm
           WHERE lm.league_id = l.id), 0
        ) as member_count,
        COALESCE(
          (SELECT ROUND(AVG(ur.rating), 2)
           FROM user_ratings ur
           WHERE ur.rated_user_id = l.owner_id
           AND ur.category = 'commissioner'), 0
        ) as commissioner_rating
       FROM league_listings ll
       JOIN leagues l ON l.id = ll.league_id
       JOIN users u ON u.id = l.owner_id
       LEFT JOIN user_profiles up ON up.user_id = l.owner_id
       ${whereClause}
       ORDER BY ll.created_at DESC
       LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      params
    );

    res.status(200).json({
      success: true,
      count:   result.rows.length,
      leagues: result.rows
    });

  } catch (error) {
    console.error('League listings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching league listings.'
    });
  }
});

// =============================================
// CREATE LEAGUE LISTING
// POST /api/community/leagues
// =============================================
router.post('/leagues', protect, async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const {
      league_id, open_spots, skill_level,
      console: consoleType, advance_schedule,
      description
    } = req.body;

    // Verify user owns this league
    const leagueCheck = await query(
      `SELECT id FROM leagues
       WHERE id = $1 AND owner_id = $2`,
      [league_id, userId]
    );

    if (leagueCheck.rows.length === 0) {
      res.status(403).json({
        success: false,
        message: 'Not authorized.'
      });
      return;
    }

    await query(
      `INSERT INTO league_listings (
        id, league_id, open_spots,
        skill_level, console,
        advance_schedule, description
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (league_id)
      DO UPDATE SET
        open_spots       = EXCLUDED.open_spots,
        skill_level      = EXCLUDED.skill_level,
        console          = EXCLUDED.console,
        advance_schedule = EXCLUDED.advance_schedule,
        description      = EXCLUDED.description,
        is_recruiting    = true,
        updated_at       = NOW()`,
      [
        uuidv4(), league_id, open_spots,
        skill_level, consoleType,
        advance_schedule, description
      ]
    );

    res.status(200).json({
      success: true,
      message: 'League listing created successfully.'
    });

  } catch (error) {
    console.error('League listing error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating league listing.'
    });
  }
});

// =============================================
// APPLY TO JOIN LEAGUE
// POST /api/community/leagues/:leagueId/apply
// =============================================
router.post('/leagues/:leagueId/apply', protect, async (req: any, res: any) => {
  try {
    const userId   = req.user.id;
    const leagueId = req.params.leagueId;
    const { message } = req.body;

    await query(
      `INSERT INTO league_applications (
        id, league_id, user_id, message
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (league_id, user_id)
      DO UPDATE SET
        message    = EXCLUDED.message,
        status     = 'pending',
        created_at = NOW()`,
      [uuidv4(), leagueId, userId, message]
    );

    res.status(200).json({
      success: true,
      message: 'Application submitted successfully.'
    });

  } catch (error) {
    console.error('Application error:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting application.'
    });
  }
});

// =============================================
// GET APPLICATIONS FOR LEAGUE
// GET /api/community/leagues/:leagueId/applications
// =============================================
router.get(
  '/leagues/:leagueId/applications',
  protect,
  async (req: any, res: any) => {
    try {
      const userId   = req.user.id;
      const leagueId = req.params.leagueId;

      // Verify commissioner
      const leagueCheck = await query(
        `SELECT id FROM leagues
         WHERE id = $1 AND owner_id = $2`,
        [leagueId, userId]
      );

      if (leagueCheck.rows.length === 0) {
        res.status(403).json({
          success: false,
          message: 'Not authorized.'
        });
        return;
      }

      const result = await query(
        `SELECT
          la.*,
          u.username, u.discord_username,
          up.gamertag, up.console,
          up.wins, up.losses,
          up.championships, up.reputation
         FROM league_applications la
         JOIN users u ON u.id = la.user_id
         LEFT JOIN user_profiles up ON up.user_id = la.user_id
         WHERE la.league_id = $1
         ORDER BY la.created_at DESC`,
        [leagueId]
      );

      res.status(200).json({
        success:      true,
        count:        result.rows.length,
        applications: result.rows
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching applications.'
      });
    }
  }
);

// =============================================
// APPROVE/REJECT APPLICATION
// PUT /api/community/applications/:id
// =============================================
router.put('/applications/:id', protect, async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { status } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      res.status(400).json({
        success: false,
        message: 'Status must be approved or rejected.'
      });
      return;
    }

    await query(
      `UPDATE league_applications
       SET status = $1
       WHERE id = $2`,
      [status, id]
    );

    res.status(200).json({
      success: true,
      message: `Application ${status}.`
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating application.'
    });
  }
});

// =============================================
// GET TOP PLAYERS — Leaderboard
// GET /api/community/leaderboard
// =============================================
router.get('/leaderboard', async (req: any, res: any) => {
  try {
    const result = await query(
      `SELECT
        u.username, u.discord_username,
        up.gamertag, up.console,
        up.wins, up.losses, up.championships,
        up.reputation,
        CASE
          WHEN (up.wins + up.losses) = 0 THEN 0
          ELSE ROUND(
            up.wins::decimal / (up.wins + up.losses) * 100, 1
          )
        END as win_pct
       FROM user_profiles up
       JOIN users u ON u.id = up.user_id
       WHERE (up.wins + up.losses) > 0
       ORDER BY up.championships DESC,
                up.wins DESC,
                up.reputation DESC
       LIMIT 50`,
      []
    );

    res.status(200).json({
      success:     true,
      leaderboard: result.rows
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching leaderboard.'
    });
  }
});

export default router;