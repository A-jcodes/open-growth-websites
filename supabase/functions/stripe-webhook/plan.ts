// Premium plan logic for the stripe-webhook function. No imports, so it can be unit tested under plain Node.
// The plan is stored on public.profiles and written ONLY here (service role). Stripe is re-read for the subscription,
// so late or repeated events can never move a customer backwards.

export const PREMIUM = { amountCents: 3000, currency: 'cad' } as const; // keep in step with create-checkout-session/params.ts

export type ProfilePlan = { plan: 'standard' | 'premium'; plan_status: string | null };
export type PlanPatch = { plan: 'standard' | 'premium'; plan_status: string; plan_renews_at: string | null; plan_cancel_at_period_end: boolean };

export interface PlanRepo {
  getProfilePlan(userId: string): Promise<ProfilePlan | null>;
  setPlan(userId: string, patch: PlanPatch): Promise<void>;
  getStripeCustomerId(userId: string): Promise<string | null>;
  addActivity(userId: string, title: string, body: string): Promise<void>;
}
export interface PlanDeps {
  repo: PlanRepo;
  stripe: { subscriptions: { retrieve(id: string): Promise<any> } };
  alert(subject: string, lines: string[]): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (v: any): string | null => (typeof v === 'string' ? v : v && typeof v.id === 'string' ? v.id : null);
const iso = (unix: unknown) => (typeof unix === 'number' && unix > 0 ? new Date(unix * 1000).toISOString() : null);
const periodEndOf = (sub: any) => iso(sub?.items?.data?.[0]?.current_period_end ?? sub?.current_period_end);

/** True when a Stripe object (subscription or checkout session) was created by us for the Premium plan. */
export const isPremiumObject = (o: any) => o?.metadata?.plan === 'premium';

/** Stripe subscription status -> what the profile should say. null = leave the profile alone (payment not finished). */
export function mapPlan(status: string): { plan: 'standard' | 'premium'; plan_status: string } | null {
  switch (status) {
    case 'active': case 'trialing': return { plan: 'premium', plan_status: 'active' };
    case 'past_due': return { plan: 'premium', plan_status: 'past_due' }; // keep Premium while Stripe retries; dashboard warns
    case 'canceled': case 'unpaid': case 'incomplete_expired': return { plan: 'standard', plan_status: 'canceled' };
    default: return null; // incomplete, paused: no change
  }
}

/** Does this subscription really bill the Premium price? Guards against a mislabelled subscription granting Premium. */
export function priceMatches(sub: any): boolean {
  const item = sub?.items?.data?.[0];
  const amount = item?.price?.unit_amount ?? item?.plan?.amount;
  const currency = item?.price?.currency ?? item?.plan?.currency;
  return amount === PREMIUM.amountCents && currency === PREMIUM.currency;
}

/** Re-read the subscription from Stripe and make the customer's profile match. Safe in any order, any number of times. */
export async function syncPremium(subId: string, d: PlanDeps, hint?: { userId?: string }): Promise<{ outcome: string; userId: string | null }> {
  const sub = await d.stripe.subscriptions.retrieve(subId);
  if (!isPremiumObject(sub)) return { outcome: 'ignored_not_premium', userId: null };
  const userId = String(sub.metadata?.user_id ?? '');
  if (!UUID.test(userId)) return { outcome: 'ignored_not_ours', userId: null };
  if (hint?.userId && hint.userId !== userId) return { outcome: 'ignored_metadata_mismatch', userId };

  // The Stripe customer on the subscription must be the one we created for that user
  const ourCustomer = await d.repo.getStripeCustomerId(userId);
  const customerId = idOf(sub.customer);
  if (!customerId || customerId !== ourCustomer) {
    await d.alert('Premium subscription needs a manual check', [`A Premium subscription (${subId}) does not belong to the Stripe customer we have on file for that user, so the plan was NOT changed.`]);
    return { outcome: 'mismatch', userId };
  }
  const next = mapPlan(String(sub.status));
  if (!next) return { outcome: 'plan_unchanged', userId };
  if (next.plan === 'premium' && !priceMatches(sub)) {
    await d.alert('Premium subscription needs a manual check', [`Subscription ${subId} is labelled Premium but its price is not $30.00 CAD per month, so Premium was NOT granted.`]);
    return { outcome: 'mismatch', userId };
  }

  const before = await d.repo.getProfilePlan(userId);
  if (!before) return { outcome: 'unknown_user', userId };
  await d.repo.setPlan(userId, {
    ...next,
    plan_renews_at: next.plan === 'premium' ? periodEndOf(sub) : null,
    plan_cancel_at_period_end: next.plan === 'premium' ? Boolean(sub.cancel_at_period_end || sub.cancel_at) : false,
  });

  if (before.plan === 'standard' && next.plan === 'premium') {
    await d.repo.addActivity(userId, 'Welcome to Premium', 'Your Premium plan is active: priority replies, 30 scans per hour and your full scan history. Thank you!');
    await d.alert('Customer upgraded to Premium', [`A customer upgraded to Premium ($30.00 CAD per month). User id: ${userId}.`]);
    return { outcome: 'premium_started', userId };
  }
  if (before.plan === 'premium' && next.plan === 'standard') {
    await d.repo.addActivity(userId, 'Premium plan ended', 'Your Premium plan has ended and your account is back on Standard. You can upgrade again any time.');
    await d.alert('Customer left Premium', [`A customer's Premium plan ended (subscription ${subId}). User id: ${userId}.`]);
    return { outcome: 'premium_ended', userId };
  }
  if (next.plan === 'premium' && next.plan_status === 'past_due' && before.plan_status !== 'past_due') {
    await d.repo.addActivity(userId, 'Premium payment problem', 'We could not take your latest Premium payment. Please update your card with Manage billing on your dashboard to keep Premium.');
    await d.alert('A Premium payment failed', [`A Premium customer's monthly payment failed. User id: ${userId}.`]);
    return { outcome: 'premium_past_due', userId };
  }
  return { outcome: next.plan === 'premium' ? 'premium_active' : 'standard_unchanged', userId };
}

/** checkout.session.completed for a Premium checkout. Verifies the session against our fixed price before syncing. */
export async function premiumCheckoutCompleted(session: any, d: PlanDeps): Promise<{ outcome: string; userId: string | null }> {
  const userId = String(session?.metadata?.user_id ?? '');
  if (!UUID.test(userId) || session.client_reference_id !== userId) return { outcome: 'ignored_not_ours', userId: null };
  if (session.mode !== 'subscription' || session.currency !== PREMIUM.currency || session.amount_subtotal !== PREMIUM.amountCents) {
    await d.alert('Premium checkout needs a manual check', [`Checkout ${idOf(session)} was labelled Premium but does not match $30.00 CAD per month, so Premium was NOT granted.`]);
    return { outcome: 'mismatch', userId };
  }
  const subId = idOf(session.subscription);
  if (!subId) throw new Error('premium checkout without a subscription id'); // Stripe will retry
  return syncPremium(subId, d, { userId });
}
