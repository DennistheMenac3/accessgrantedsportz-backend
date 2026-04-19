import { Router } from 'express';
import express from 'express';
import { protect } from '../middleware/authMiddleware';
import { query } from '../config/database';
import {
  createCheckoutSession,
  createPortalSession,
  constructWebhookEvent
} from '../services/stripeService';

const router = Router();

// =============================================
// CREATE CHECKOUT SESSION
// POST /api/stripe/checkout
// =============================================
router.post('/checkout', protect, async (req: any, res: any) => {
  try {
    console.log('💳 STRIPE_PRO_PRICE_ID:', process.env.STRIPE_PRO_PRICE_ID);
    console.log('💳 STRIPE_ELITE_PRICE_ID:', process.env.STRIPE_ELITE_PRICE_ID);
    console.log('💳 STRIPE_SECRET_KEY starts with:', process.env.STRIPE_SECRET_KEY?.substring(0, 7));

    const { tier, league_id } = req.body;
    const userId              = req.user.id;

    if (!['pro', 'pro_annual', 'elite', 'elite_annual'].includes(tier)) {
  res.status(400).json({
    success: false,
    message: 'Invalid tier.'
  });
  return;
}

    const userResult = await query(
      `SELECT email FROM users WHERE id = $1`,
      [userId]
    );

    const leagueResult = await query(
      `SELECT * FROM leagues
       WHERE id = $1 AND owner_id = $2`,
      [league_id, userId]
    );

    if (leagueResult.rows.length === 0) {
      res.status(403).json({
        success: false,
        message: 'League not found or not authorized.'
      });
      return;
    }

    const league = leagueResult.rows[0];
    const email  = userResult.rows[0]?.email;

    const checkoutUrl = await createCheckoutSession(
      league_id,
      tier,
      league.stripe_customer_id,
      email
    );

    res.status(200).json({
      success:      true,
      checkout_url: checkoutUrl
    });

  } catch (error: any) {
    console.error('Checkout error:', error?.message || error);
    res.status(500).json({
      success: false,
      message: 'Error creating checkout session.',
      error:   error?.message
    });
  }
});

// =============================================
// CUSTOMER PORTAL
// POST /api/stripe/portal
// =============================================
router.post('/portal', protect, async (req: any, res: any) => {
  try {
    const { league_id } = req.body;
    const userId        = req.user.id;

    const leagueResult = await query(
      `SELECT stripe_customer_id FROM leagues
       WHERE id = $1 AND owner_id = $2`,
      [league_id, userId]
    );

    if (leagueResult.rows.length === 0) {
      res.status(403).json({
        success: false,
        message: 'League not found.'
      });
      return;
    }

    const customerId = leagueResult.rows[0].stripe_customer_id;

    if (!customerId) {
      res.status(400).json({
        success: false,
        message: 'No active subscription found.'
      });
      return;
    }

    const portalUrl = await createPortalSession(customerId);

    res.status(200).json({
      success:    true,
      portal_url: portalUrl
    });

  } catch (error: any) {
    console.error('Portal error:', error?.message);
    res.status(500).json({
      success: false,
      message: 'Error creating portal session.'
    });
  }
});

// =============================================
// GET SUBSCRIPTION STATUS
// GET /api/stripe/status/:leagueId
// =============================================
router.get('/status/:leagueId', protect, async (req: any, res: any) => {
  try {
    const leagueId = req.params.leagueId;
    const userId   = req.user.id;

    const result = await query(
      `SELECT
        subscription_tier,
        stripe_subscription_id,
        subscription_expires_at
       FROM leagues
       WHERE id = $1 AND owner_id = $2`,
      [leagueId, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: 'League not found.'
      });
      return;
    }

    const league = result.rows[0];

    res.status(200).json({
      success:    true,
      tier:       league.subscription_tier || 'free',
      expires_at: league.subscription_expires_at,
      features:   getTierFeatures(league.subscription_tier || 'free')
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching subscription status.'
    });
  }
});

// =============================================
// STRIPE WEBHOOK
// POST /api/stripe/webhook
// =============================================
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req: any, res: any) => {
    const signature = req.headers['stripe-signature'];

    let event;
    try {
      event = constructWebhookEvent(req.body, signature);
    } catch (error) {
      console.error('Webhook signature error:', error);
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }

    console.log(`📦 Stripe webhook: ${event.type}`);

    try {
      switch (event.type) {

        case 'checkout.session.completed': {
          const session    = event.data.object as any;
          const leagueId   = session.metadata?.league_id;
          const tier       = session.metadata?.tier;
          const customerId = session.customer;
          const subId      = session.subscription;

          if (leagueId && tier) {
            await query(
              `UPDATE leagues SET
                subscription_tier       = $1,
                stripe_customer_id      = $2,
                stripe_subscription_id  = $3,
                subscription_expires_at = NOW() + INTERVAL '1 month'
               WHERE id = $4`,
              [tier, customerId, subId, leagueId]
            );
            console.log(`✅ League ${leagueId} upgraded to ${tier}`);
          }
          break;
        }

        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as any;
          const subId   = invoice.subscription;
          if (subId) {
            await query(
              `UPDATE leagues SET
                subscription_expires_at = NOW() + INTERVAL '1 month'
               WHERE stripe_subscription_id = $1`,
              [subId]
            );
            console.log(`✅ Subscription ${subId} renewed`);
          }
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as any;
          console.log(`⚠️ Payment failed for subscription ${invoice.subscription}`);
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as any;
          await query(
            `UPDATE leagues SET
              subscription_tier       = 'free',
              stripe_subscription_id  = NULL,
              subscription_expires_at = NULL
             WHERE stripe_subscription_id = $1`,
            [subscription.id]
          );
          console.log(`✅ Subscription cancelled — downgraded to free`);
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object as any;
          console.log(`📦 Subscription updated: ${subscription.id}`);
          break;
        }

        default:
          console.log(`📦 Unhandled webhook: ${event.type}`);
      }

      res.status(200).json({ received: true });

    } catch (error) {
      console.error('Webhook processing error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

// =============================================
// HELPER — Get features for tier
// =============================================
const getTierFeatures = (tier: string) => {
  const features: any = {
    free: {
      standings:   true,
      scores:      true,
      value:       true,
      compare:     true,
      invite:      true,
      recap:       false,
      rankings:    false,
      rumors:      false,
      scout:       false,
      gems:        false,
      tradecheck:  false,
      awards:      false,
      leaders:     false,
      max_members: 10,
      max_leagues: 1
    },
    pro: {
      standings:   true,
      scores:      true,
      value:       true,
      compare:     true,
      invite:      true,
      recap:       true,
      rankings:    true,
      rumors:      true,
      scout:       false,
      gems:        false,
      tradecheck:  false,
      awards:      true,
      leaders:     true,
      max_members: 32,
      max_leagues: 1
    },
    elite: {
      standings:   true,
      scores:      true,
      value:       true,
      compare:     true,
      invite:      true,
      recap:       true,
      rankings:    true,
      rumors:      true,
      scout:       true,
      gems:        true,
      tradecheck:  true,
      awards:      true,
      leaders:     true,
      max_members: 32,
      max_leagues: 3
    }
  };

  return features[tier] || features.free;
};

export default router;