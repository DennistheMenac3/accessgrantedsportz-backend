import { query } from '../config/database';

// =============================================
// TIER GATE MIDDLEWARE
// Checks if league has required subscription
// =============================================
export const requireTier = (minTier: 'pro' | 'elite') => {
  return async (req: any, res: any, next: any) => {
    try {
      const leagueId = req.params.leagueId || req.body.league_id;

      if (!leagueId) {
        next();
        return;
      }

      const result = await query(
        `SELECT subscription_tier, subscription_expires_at
         FROM leagues WHERE id = $1`,
        [leagueId]
      );

      if (result.rows.length === 0) {
        next();
        return;
      }

      const league = result.rows[0];
      const tier   = league.subscription_tier || 'free';

      const tierRank = { free: 0, pro: 1, elite: 2 };
      const required = tierRank[minTier];
      const current  = tierRank[tier as keyof typeof tierRank] || 0;

      if (current < required) {
        res.status(403).json({
          success:  false,
          message:  `This feature requires ${minTier} subscription.`,
          upgrade:  true,
          required: minTier,
          current:  tier
        });
        return;
      }

      next();
    } catch (error) {
      next();
    }
  };
};