import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export const PRICE_IDS = {
  pro:   process.env.STRIPE_PRO_PRICE_ID!,
  elite: process.env.STRIPE_ELITE_PRICE_ID!
};

// =============================================
// CREATE CHECKOUT SESSION
// =============================================
export const createCheckoutSession = async (
  leagueId:    string,
  tier:        'pro' | 'elite',
  customerId?: string,
  email?:      string
): Promise<string> => {
  const frontendUrl = process.env.FRONTEND_URL ||
    'https://accessgrantedsportz.com';

  const sessionParams: any = {
    mode:        'subscription',
    line_items: [
      {
        price:    PRICE_IDS[tier],
        quantity: 1
      }
    ],
    success_url: `${frontendUrl}/dashboard?payment=success&tier=${tier}`,
    cancel_url:  `${frontendUrl}/pricing?payment=cancelled`,
    metadata: {
      league_id: leagueId,
      tier
    }
  };

  if (customerId) {
    sessionParams.customer = customerId;
  } else if (email) {
    sessionParams.customer_email = email;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  if (!session.url) {
    throw new Error('Stripe did not return a checkout URL.');
  }

  return session.url;
};

// =============================================
// CREATE CUSTOMER PORTAL SESSION
// =============================================
export const createPortalSession = async (
  customerId: string
): Promise<string> => {
  const frontendUrl = process.env.FRONTEND_URL ||
    'https://accessgrantedsportz.com';

  const session = await stripe.billingPortal.sessions.create({
    customer:   customerId,
    return_url: `${frontendUrl}/dashboard`
  });

  return session.url;
};

// =============================================
// CONSTRUCT WEBHOOK EVENT
// =============================================
export const constructWebhookEvent = (
  payload:   Buffer,
  signature: string
): any => {
  return stripe.webhooks.constructEvent(
    payload,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );
};

// =============================================
// GET SUBSCRIPTION
// =============================================
export const getSubscription = async (
  subscriptionId: string
): Promise<any> => {
  return stripe.subscriptions.retrieve(subscriptionId);
};

// =============================================
// CANCEL SUBSCRIPTION
// =============================================
export const cancelSubscription = async (
  subscriptionId: string
): Promise<void> => {
  await stripe.subscriptions.cancel(subscriptionId);
};

export default stripe;