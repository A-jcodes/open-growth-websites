// Builds the Stripe Checkout Session parameters from a payment request row. No imports, so it can be unit tested.
// Everything that decides money (amounts, currency, mode, description) comes from the database row passed in.

export type CheckoutRequest = {
  id: string;
  user_id: string;
  description: string;
  kind: 'one_time' | 'subscription';
  amount_cents: number;
  setup_fee_cents: number;
  currency: string;
};

export type CheckoutOptions = {
  customerId: string;
  site: string; // https origin of the website, from the SITE_URL secret, never from the browser
  automaticTax: boolean; // STRIPE_AUTOMATIC_TAX=true, only after Stripe Tax is set up in the dashboard
  taxBehavior: 'exclusive' | 'inclusive'; // STRIPE_TAX_BEHAVIOR; only sent when automaticTax is on
};

export function buildSessionParams(r: CheckoutRequest, o: CheckoutOptions): Record<string, unknown> {
  const tax = o.automaticTax ? { tax_behavior: o.taxBehavior } : {};
  const meta = { payment_request_id: r.id, user_id: r.user_id };
  const base: Record<string, unknown> = {
    customer: o.customerId,
    client_reference_id: r.id,
    metadata: meta,
    success_url: `${o.site}/account/?payment=success`,
    cancel_url: `${o.site}/account/?payment=cancelled`,
    ...(o.automaticTax ? { automatic_tax: { enabled: true }, customer_update: { address: 'auto', name: 'auto' }, billing_address_collection: 'required' } : {}),
  };

  if (r.kind === 'subscription') {
    const lines: unknown[] = [{
      quantity: 1,
      price_data: { currency: r.currency, unit_amount: r.amount_cents, recurring: { interval: 'month' }, product_data: { name: r.description }, ...tax },
    }];
    // The setup fee is a one-time line on the first invoice. Stripe allows this alongside a recurring price.
    if (r.setup_fee_cents > 0) {
      lines.push({ quantity: 1, price_data: { currency: r.currency, unit_amount: r.setup_fee_cents, product_data: { name: `${r.description} (one-time setup)` }, ...tax } });
    }
    return { ...base, mode: 'subscription', line_items: lines, subscription_data: { metadata: meta, description: r.description } };
  }

  return {
    ...base,
    mode: 'payment',
    line_items: [{ quantity: 1, price_data: { currency: r.currency, unit_amount: r.amount_cents, product_data: { name: r.description }, ...tax } }],
    payment_intent_data: { metadata: meta, description: r.description },
    invoice_creation: { enabled: true, invoice_data: { description: r.description, metadata: meta } }, // gives the customer an invoice PDF
  };
}
