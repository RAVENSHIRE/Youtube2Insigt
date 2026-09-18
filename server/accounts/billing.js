const { createHmac, timingSafeEqual } = require('node:crypto');
const { AppError } = require('./store');

function verifyWebhook(raw, signature, secret, now = Date.now()) {
  if (!secret || !Buffer.isBuffer(raw) || raw.length > 1024 * 1024) throw new AppError('WEBHOOK_INVALID', 'Invalid webhook.', 400);
  const parts = String(signature || '').split(',').map(part => part.split('='));
  const timestamp = Number(parts.find(([name]) => name === 't')?.[1]);
  if (!Number.isInteger(timestamp) || Math.abs(now / 1000 - timestamp) > 300) throw new AppError('WEBHOOK_EXPIRED', 'Invalid webhook timestamp.', 400);
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest();
  const valid = parts.filter(([name, value]) => name === 'v1' && /^[a-f0-9]{64}$/u.test(value)).some(([, value]) => timingSafeEqual(expected, Buffer.from(value, 'hex')));
  if (!valid) throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature.', 400);
  return JSON.parse(raw.toString('utf8'));
}
const objectId = value => typeof value === 'string' ? value : value?.id;

class StripeClient {
  constructor({ secret, priceId, publicUrl, fetchImpl = fetch } = {}) { Object.assign(this, { secret, priceId, publicUrl, fetchImpl }); }
  isConfigured() { return Boolean(this.secret && this.priceId && this.publicUrl); }
  async request(method, endpoint, values = {}, idempotencyKey) {
    if (!this.isConfigured()) throw new AppError('BILLING_NOT_CONFIGURED', 'Abrechnung ist noch nicht eingerichtet.', 503);
    const response = await this.fetchImpl(`https://api.stripe.com/v1/${endpoint}`, { method,
      headers: { authorization: `Bearer ${this.secret}`, 'content-type': 'application/x-www-form-urlencoded',
        'Stripe-Version': '2025-06-30.basil', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      ...(method === 'GET' ? {} : { body: new URLSearchParams(values) }), signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    if (!response.ok) throw new AppError('BILLING_PROVIDER_UNAVAILABLE', 'Zahlungsanbieter momentan nicht verfügbar.', 503);
    return data;
  }
  getSubscription(id) { return this.request('GET', `subscriptions/${encodeURIComponent(id)}?expand[]=latest_invoice`); }
  getInvoice(id) { return this.request('GET', `invoices/${encodeURIComponent(id)}`); }
}

class BillingService {
  constructor({ store, client, webhookSecret }) { Object.assign(this, { store, client, webhookSecret }); this.locks = new Map(); }
  async locked(key, action) {
    const previous = this.locks.get(key) || Promise.resolve();
    const promise = previous.catch(() => {}).then(action);
    this.locks.set(key, promise);
    try { return await promise; } finally { if (this.locks.get(key) === promise) this.locks.delete(key); }
  }
  async checkout(userId) {
    return this.locked(userId, async () => {
      const user = this.store.user(userId);
      if (this.store.subscription(userId) && !['canceled', 'incomplete_expired'].includes(this.store.subscription(userId).status)) {
        throw new AppError('SUBSCRIPTION_EXISTS', 'Bestehendes Abo im Kundenportal verwalten.', 409);
      }
      const pending = this.store.db.prepare('SELECT * FROM checkout_sessions WHERE user_id=? AND expires_at>?').get(userId, this.store.now() + 60000);
      if (pending) return { url: pending.url };
      let customer = user.stripe_customer;
      if (!customer) {
        const result = await this.client.request('POST', 'customers', { email: user.email, 'metadata[user_id]': userId }, `customer:${userId}`);
        customer = result.id; this.store.customer(userId, customer);
      }
      const current = await this.client.request('GET', `subscriptions?customer=${encodeURIComponent(customer)}&status=all&limit=100`);
      if ((current.data || []).some(sub => !['canceled', 'incomplete_expired'].includes(sub.status))) throw new AppError('SUBSCRIPTION_EXISTS', 'Bestehendes Abo im Kundenportal verwalten.', 409);
      // One open session per account and 30-minute window; concurrent clicks cannot create parallel subscriptions.
      const session = await this.client.request('POST', 'checkout/sessions', {
        mode: 'subscription', customer, 'line_items[0][price]': this.client.priceId, 'line_items[0][quantity]': '1',
        client_reference_id: userId, 'subscription_data[metadata][user_id]': userId,
        success_url: `${this.client.publicUrl}/account/?checkout=success`, cancel_url: `${this.client.publicUrl}/account/?checkout=cancel`,
        expires_at: String(Math.floor(this.store.now() / 1800000) * 1800 + 3600)
      }, `checkout:${userId}:${Math.floor(this.store.now() / 1800000)}`);
      this.store.db.prepare('INSERT OR REPLACE INTO checkout_sessions VALUES (?,?,?,?)').run(userId, session.id, session.url, Number(session.expires_at) * 1000);
      return { url: session.url };
    });
  }
  async portal(userId) {
    const customer = this.store.user(userId).stripe_customer;
    if (!customer) throw new AppError('NO_BILLING_CUSTOMER', 'Noch kein Abrechnungskonto vorhanden.', 409);
    const session = await this.client.request('POST', 'billing_portal/sessions', { customer, return_url: `${this.client.publicUrl}/account/` });
    return { url: session.url };
  }
  async webhook(raw, signature) {
    const event = verifyWebhook(raw, signature, this.webhookSecret, this.store.now());
    if (!/^evt_[\w]+$/u.test(event.id || '')) throw new AppError('WEBHOOK_INVALID', 'Invalid event ID.');
    const payload = event.data?.object;
    const relevant = ['checkout.session.completed', 'invoice.paid', 'invoice.payment_failed', 'customer.subscription.updated', 'customer.subscription.deleted', 'customer.subscription.created'];
    if (!relevant.includes(event.type)) return { received: true, ignored: true };
    const customerId = objectId(payload?.customer);
    const user = this.store.byCustomer(customerId || '');
    if (!user) return { received: true, ignored: true }; // Never grant from untrusted metadata alone.
    return this.locked(user.id, async () => {
      if (this.store.eventHandled(event.id)) return { received: true, duplicate: true };
      const subscriptionId = event.type.startsWith('customer.subscription.') ? payload.id :
        objectId(payload.subscription || payload.parent?.subscription_details?.subscription);
      if (!subscriptionId) return { received: true, ignored: true };
      // Fetch CURRENT canonical state inside the lock. Event delivery order is not state order.
      const sub = await this.client.getSubscription(subscriptionId);
      if (objectId(sub.customer) !== customerId) throw new AppError('BILLING_IDENTITY_MISMATCH', 'Subscription customer mismatch.', 400);
      const expectedLive = this.client.secret?.startsWith('sk_live_');
      if (typeof sub.livemode === 'boolean' && sub.livemode !== expectedLive) throw new AppError('BILLING_MODE_MISMATCH', 'Stripe mode mismatch.', 400);
      const items = sub.items?.data || [];
      const item = items.find(item => objectId(item.price) === this.client.priceId);
      if (items.length !== 1 || !item || Number(item.quantity || 1) !== 1 || item.price?.recurring?.interval !== 'month' || Number(item.price?.recurring?.interval_count || 1) !== 1) {
        throw new AppError('BILLING_PRICE_MISMATCH', 'Unconfigured subscription price.', 400);
      }
      const existing = this.store.subscription(user.id);
      if (existing && existing.subscription_id !== sub.id && !['canceled', 'incomplete_expired'].includes(existing.status)) {
        // A delayed event for a previous subscription must not overwrite a newer active one.
        const current = await this.client.getSubscription(existing.subscription_id);
        if (!['canceled', 'incomplete_expired'].includes(current.status)) return { received: true, ignored: true };
      }
      const start = Number(item.current_period_start || sub.current_period_start) * 1000;
      const end = Number(item.current_period_end || sub.current_period_end) * 1000;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new AppError('BILLING_PERIOD_INVALID', 'Invalid subscription period.', 400);
      let latestInvoice = sub.latest_invoice;
      if (typeof latestInvoice === 'string') latestInvoice = await this.client.getInvoice(latestInvoice);
      // No grant from checkout redirects, unpaid invoices, trials or event descriptions.
      const paid = latestInvoice?.status === 'paid' && latestInvoice?.paid !== false && sub.status === 'active';
      const lines = latestInvoice?.lines?.data || [];
      const matchingLine = lines.find(line => objectId(line.price || line.pricing?.price_details?.price) === this.client.priceId &&
        Number(line.period?.start) * 1000 === start && Number(line.period?.end) * 1000 === end);
      const grant = paid && matchingLine ? { id: `pro:${sub.id}:${start}`, start, end } : null;
      this.store.applyBilling(event.id, user.id, { id: sub.id, status: sub.status, periodEnd: end, cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end) }, grant);
      return { received: true, granted: Boolean(grant) };
    });
  }
}
module.exports = { verifyWebhook, StripeClient, BillingService };
