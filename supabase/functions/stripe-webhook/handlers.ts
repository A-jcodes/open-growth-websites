// Payment event logic for the stripe-webhook function. It has no imports, so it can be unit tested without Deno:
// the database and Stripe are passed in (see Repo and Deps), and index.ts wires in the real ones.
//
// Principles:
//  - Money state is decided from Stripe's objects, and re-read from Stripe where order could matter, so a late or
//    repeated event can never move a request backwards.
//  - Amount, currency and customer are checked against our own database row before anything is marked paid.
//  - Every event id is recorded once (claimEvent), so a Stripe retry does nothing twice.

export type PaymentRequest = {
  id: string;
  user_id: string;
  description: string;
  kind: 'one_time' | 'subscription';
  amount_cents: number;
  setup_fee_cents: number;
  currency: string;
  status: 'pending' | 'paid' | 'active' | 'past_due' | 'canceled' | 'void';
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_subscription_id: string | null;
};

export interface Repo {
  getRequest(id: string): Promise<PaymentRequest | null>;
  getRequestBySubscription(subscriptionId: string): Promise<PaymentRequest | null>;
  getStripeCustomerId(userId: string): Promise<string | null>;
  updateRequest(id: string, patch: Record<string, unknown>): Promise<void>;
  addActivity(userId: string, title: string, body: string): Promise<void>;
  /** 'new' first time, 'retry' seen but unfinished, 'done' already processed. */
  claimEvent(id: string, type: string): Promise<'new' | 'retry' | 'done'>;
  finishEvent(id: string, outcome: string, requestId: string | null): Promise<void>;
}

export interface Deps {
  repo: Repo;
  stripe: { subscriptions: { retrieve(id: string): Promise<any> } };
  /** Emails the team. Must never throw. */
  alert(subject: string, lines: string[]): Promise<void>;
  allowLive: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function money(cents: number): string {
  return '$' + (cents / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' CAD';
}
const idOf = (v: any): string | null => (typeof v === 'string' ? v : v && typeof v.id === 'string' ? v.id : null);
const iso = (unix: unknown) => (typeof unix === 'number' && unix > 0 ? new Date(unix * 1000).toISOString() : null);

/** What a request should cost on the first checkout, in cents. */
export function expectedSubtotal(r: PaymentRequest): number {
  return r.kind === 'subscription' ? r.amount_cents + r.setup_fee_cents : r.amount_cents;
}

/** The subscription an invoice belongs to. Stripe moved this field between API versions, so accept both places. */
export function invoiceSubscriptionId(inv: any): string | null {
  return idOf(inv?.subscription) ?? idOf(inv?.parent?.subscription_details?.subscription);
}

/** End of the paid period. Newer API versions keep it on the subscription items, older ones on the subscription. */
export function periodEnd(sub: any): string | null {
  return iso(sub?.items?.data?.[0]?.current_period_end ?? sub?.current_period_end);
}

export function mapSubscriptionStatus(s: string): PaymentRequest['status'] | null {
  switch (s) {
    case 'active': case 'trialing': return 'active';
    case 'past_due': case 'unpaid': case 'paused': return 'past_due';
    case 'canceled': case 'incomplete_expired': return 'canceled';
    default: return null; // incomplete: the first payment has not finished, so leave the request alone
  }
}

/** Process one verified event. Returns the outcome label that is stored in payment_events. */
export async function handleEvent(event: any, d: Deps): Promise<{ outcome: string; requestId: string | null }> {
  if (event.livemode === true && !d.allowLive) return { outcome: 'ignored_live_event', requestId: null };
  const obj = event?.data?.object;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return checkoutPaid(obj, d);
    case 'checkout.session.async_payment_failed':
      return checkoutFailed(obj, d);
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const subId = invoiceSubscriptionId(obj);
      if (!subId) return { outcome: 'ignored_no_subscription', requestId: null };
      return syncSubscription(subId, d, { renewalInvoice: event.type === 'invoice.paid' && obj?.billing_reason === 'subscription_cycle' });
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subId = idOf(obj);
      return subId ? syncSubscription(subId, d, {}) : { outcome: 'ignored_no_subscription', requestId: null };
    }
    default:
      return { outcome: 'ignored', requestId: null };
  }
}

async function checkoutPaid(session: any, d: Deps) {
  // An asynchronous method (bank debit) can complete the session before the money has arrived.
  if (session?.payment_status === 'unpaid') return { outcome: 'awaiting_payment', requestId: null };
  const rid = String(session?.client_reference_id ?? session?.metadata?.payment_request_id ?? '');
  if (!UUID.test(rid)) return { outcome: 'ignored_not_ours', requestId: null };
  const req = await d.repo.getRequest(rid);
  if (!req) return { outcome: 'unknown_request', requestId: null };

  // Trust our database, not the session: amount, currency, mode and customer must all match the stored request.
  const customerId = idOf(session.customer);
  const ourCustomer = await d.repo.getStripeCustomerId(req.user_id);
  const modeOk = session.mode === (req.kind === 'subscription' ? 'subscription' : 'payment');
  if (session.currency !== req.currency || session.amount_subtotal !== expectedSubtotal(req) || !modeOk || !customerId || customerId !== ourCustomer) {
    await d.alert('Payment needs a manual check', [
      `A Stripe payment for "${req.description}" does not match the request in your database, so it was NOT marked paid.`,
      `Expected ${money(expectedSubtotal(req))} (${req.kind}); Stripe session ${idOf(session)} reported subtotal ${session.amount_subtotal} ${String(session.currency).toUpperCase()} cents.`,
      'Open the payment in the Stripe dashboard (test mode) to review it.',
    ]);
    return { outcome: 'mismatch', requestId: req.id };
  }

  const subId = idOf(session.subscription);
  const piId = idOf(session.payment_intent);

  // Already settled? Same payment = a repeat delivery. A different payment = the customer paid twice.
  if (req.status !== 'pending' && req.status !== 'void') {
    const same = req.kind === 'subscription' ? req.stripe_subscription_id === subId : req.stripe_payment_intent_id === piId;
    if (same) return { outcome: 'already_processed', requestId: req.id };
    await d.alert('Duplicate payment, a refund may be needed', [
      `"${req.description}" was already paid, and a second Stripe payment just came in (${idOf(session)}).`,
      'Check the Stripe dashboard (test mode) and refund one of them if it was a mistake.',
    ]);
    return { outcome: 'duplicate_payment', requestId: req.id };
  }

  const now = new Date().toISOString();
  if (req.kind === 'subscription') {
    if (!subId) throw new Error('subscription checkout without a subscription id'); // Stripe will retry
    await d.repo.updateRequest(req.id, { stripe_checkout_session_id: idOf(session), stripe_subscription_id: subId, paid_at: now });
    await syncSubscription(subId, d, { attach: req.id }); // sets active, period end and so on from Stripe itself
  } else {
    await d.repo.updateRequest(req.id, { status: 'paid', paid_at: now, stripe_checkout_session_id: idOf(session), stripe_payment_intent_id: piId });
  }
  await d.repo.addActivity(req.user_id, 'Payment received, thank you', `${req.description}: ${money(expectedSubtotal(req))}. A receipt was emailed by Stripe.`);
  await d.alert(req.status === 'void' ? 'Payment received for a request you had voided' : 'Payment received', [
    `${req.description}: ${money(expectedSubtotal(req))}${req.kind === 'subscription' ? ' (first payment of a monthly plan)' : ''}.`,
  ]);
  return { outcome: 'paid', requestId: req.id };
}

async function checkoutFailed(session: any, d: Deps) {
  const rid = String(session?.client_reference_id ?? session?.metadata?.payment_request_id ?? '');
  const req = UUID.test(rid) ? await d.repo.getRequest(rid) : null;
  if (!req) return { outcome: 'ignored_not_ours', requestId: null };
  await d.repo.addActivity(req.user_id, 'Payment did not go through', `${req.description}: the bank payment failed. You can try again from the Payments section.`);
  await d.alert('A payment failed', [`${req.description}: the customer's payment did not complete.`]);
  return { outcome: 'async_payment_failed', requestId: req.id };
}

/** Make our row match the subscription as Stripe has it right now. Safe to call in any order, any number of times. */
async function syncSubscription(subId: string, d: Deps, opts: { attach?: string; renewalInvoice?: boolean }) {
  const sub = await d.stripe.subscriptions.retrieve(subId);
  let req = await d.repo.getRequestBySubscription(subId);
  if (!req && opts.attach) req = await d.repo.getRequest(opts.attach);
  // An event can arrive before the checkout one; it is harmless to skip, because the checkout handler syncs again.
  if (!req) return { outcome: 'ignored_not_linked', requestId: null };
  if (sub.metadata?.payment_request_id && sub.metadata.payment_request_id !== req.id) return { outcome: 'ignored_metadata_mismatch', requestId: req.id };

  const next = mapSubscriptionStatus(String(sub.status));
  const patch: Record<string, unknown> = {
    current_period_end: periodEnd(sub),
    cancel_at_period_end: Boolean(sub.cancel_at_period_end || sub.cancel_at),
  };
  if (next) patch.status = next;
  await d.repo.updateRequest(req.id, patch);

  const changed = next && next !== req.status;
  if (!opts.attach) {
    if (changed && next === 'past_due') {
      await d.repo.addActivity(req.user_id, 'Payment problem', `We could not take your latest payment for ${req.description}. Please update your card with Manage billing in the Payments section.`);
      await d.alert('A subscription payment failed', [`${req.description}: the customer's monthly payment failed (status ${sub.status}).`]);
    } else if (changed && next === 'canceled') {
      await d.repo.addActivity(req.user_id, 'Subscription ended', `${req.description} has been cancelled. Thank you for working with us.`);
      await d.alert('A subscription was cancelled', [`${req.description} is now cancelled.`]);
    } else if (changed && next === 'active' && req.status === 'past_due') {
      await d.repo.addActivity(req.user_id, 'Payment received, thank you', `${req.description}: your payment went through and your plan is active again.`);
    } else if (opts.renewalInvoice) {
      await d.repo.addActivity(req.user_id, 'Monthly payment received', `${req.description}: ${money(req.amount_cents)}. Thank you.`);
    }
  }
  return { outcome: `subscription_${next ?? 'unchanged'}`, requestId: req.id };
}

/** Wraps handleEvent with the once-only record. Throwing leaves the event unfinished so Stripe retries it. */
export async function processEvent(event: any, d: Deps): Promise<string> {
  const claim = await d.repo.claimEvent(event.id, event.type);
  if (claim === 'done') return 'duplicate_event';
  const { outcome, requestId } = await handleEvent(event, d);
  await d.repo.finishEvent(event.id, outcome, requestId);
  return outcome;
}
