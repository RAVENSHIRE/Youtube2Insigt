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
  constructor({ secret, priceId, publicUrl, mode = 'disabled', fetchImpl = fetch } = {}) { Object.assign(this, { secret, priceId, publicUrl, mode, fetchImpl }); }
  isConfigured() { return this.mode === 'test' && /^sk_test_\S+$/u.test(this.secret || '') && /^price_[\w]+$/u.test(this.priceId || '') && Boolean(this.publicUrl); }
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
  async getPrice() {
    if (this.priceCache?.expires > Date.now()) return this.priceCache.price;
    const price = await this.request('GET', `prices/${encodeURIComponent(this.priceId)}`);
    if (price.id !== this.priceId || price.livemode !== false || price.active !== true || price.type !== 'recurring' ||
      price.recurring?.interval !== 'month' || price.recurring?.interval_count !== 1 || price.recurring?.usage_type !== 'licensed' ||
      price.billing_scheme !== 'per_unit' || price.transform_quantity || !Number.isSafeInteger(price.unit_amount) || price.unit_amount < 1 ||
      !['usd', 'eur', 'chf', 'gbp'].includes(price.currency)) {
      throw new AppError('BILLING_PRICE_INVALID', 'Ein aktiver monatlicher Stripe-Testpreis mit festem Betrag in CHF, EUR, USD oder GBP wird benötigt.', 503);
    }
    this.priceCache = { price, expires: Date.now() + 60000 };
    return price;
  }
}

function stripeUrl(value, host) {
  try { const url = new URL(value); if (url.protocol === 'https:' && url.hostname === host && !url.port && !url.username && !url.password) return url.href; } catch {}
  throw new AppError('BILLING_URL_INVALID', 'Ungültige Antwort des Zahlungsanbieters.', 503);
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
      await this.client.getPrice(); // Validate the configured product before creating a customer or session.
      const user = this.store.user(userId);
      if (this.store.subscription(userId) && !['canceled', 'incomplete_expired'].includes(this.store.subscription(userId).status)) {
        throw new AppError('SUBSCRIPTION_EXISTS', 'Bestehendes Abo im Kundenportal verwalten.', 409);
      }
      const pending = this.store.db.prepare('SELECT * FROM checkout_sessions WHERE user_id=?').get(userId);
      if (pending) {
        const current = await this.client.request('GET', `checkout/sessions/${encodeURIComponent(pending.session_id)}?expand[]=line_items`);
        if (current.livemode !== false || objectId(current.customer) !== user.stripe_customer || current.client_reference_id !== userId ||
          current.mode !== 'subscription' || current.line_items?.has_more || current.line_items?.data?.length !== 1 ||
          current.line_items.data[0].quantity !== 1 || objectId(current.line_items.data[0].price) !== this.client.priceId) {
          throw new AppError('BILLING_SESSION_MISMATCH', 'Checkout-Zuordnung stimmt nicht. Bitte bestehendes Abo prüfen.', 409);
        }
        if (current.status === 'complete' && !['canceled', 'incomplete_expired'].includes(this.store.subscription(userId)?.status)) throw new AppError('CHECKOUT_PENDING', 'Testzahlung wird noch bestätigt. Kontostatus aktualisieren.', 409);
        if (current.status === 'open') return { url: stripeUrl(current.url, 'checkout.stripe.com'), mode: 'test' };
      }
      let customer = user.stripe_customer;
      if (!customer) {
        const result = await this.client.request('POST', 'customers', { email: user.email, 'metadata[user_id]': userId }, `customer:${userId}`);
        customer = result.id; this.store.customer(userId, customer);
      }
      const current = await this.client.request('GET', `subscriptions?customer=${encodeURIComponent(customer)}&status=all&limit=100`);
      if (current.has_more || (current.data || []).some(sub => !['canceled', 'incomplete_expired'].includes(sub.status))) throw new AppError('SUBSCRIPTION_EXISTS', 'Bestehendes Abo im Kundenportal verwalten.', 409);
      // Reuse an open session, even across time windows. A closed predecessor keys its replacement.
      // If the network fails before persistence, retries within the window use the same Stripe key.
      const session = await this.client.request('POST', 'checkout/sessions', {
        mode: 'subscription', customer, 'line_items[0][price]': this.client.priceId, 'line_items[0][quantity]': '1',
        client_reference_id: userId, 'subscription_data[metadata][user_id]': userId,
        success_url: `${this.client.publicUrl}/account/?checkout=success&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${this.client.publicUrl}/account/?checkout=cancel`,
        expires_at: String(Math.floor(this.store.now() / 1800000) * 1800 + 3600)
      }, `checkout:${userId}:${pending?.session_id || 'initial'}:${Math.floor(this.store.now() / 1800000)}`);
      if (!/^cs_test_[\w]+$/u.test(session.id || '') || session.livemode !== false || !Number.isFinite(session.expires_at)) throw new AppError('BILLING_MODE_MISMATCH', 'Checkout ist kein gültiger Test-Checkout.', 503);
      stripeUrl(session.url, 'checkout.stripe.com');
      this.store.db.prepare('INSERT OR REPLACE INTO checkout_sessions VALUES (?,?,?,?)').run(userId, session.id, session.url, Number(session.expires_at) * 1000);
      return { url: session.url, mode: 'test' };
    });
  }
  async portal(userId) {
    const customer = this.store.user(userId).stripe_customer;
    if (!customer) throw new AppError('NO_BILLING_CUSTOMER', 'Noch kein Abrechnungskonto vorhanden.', 409);
    const session = await this.client.request('POST', 'billing_portal/sessions', { customer, return_url: `${this.client.publicUrl}/account/` });
    return { url: stripeUrl(session.url, 'billing.stripe.com'), mode: 'test' };
  }
  checkoutStatus(userId, sessionId) {
    if (!/^cs_test_[\w]{1,200}$/u.test(sessionId || '') || !this.store.db.prepare('SELECT 1 FROM checkout_sessions WHERE user_id=? AND session_id=?').get(userId, sessionId)) {
      throw new AppError('CHECKOUT_NOT_FOUND', 'Checkout gehört nicht zu diesem Konto oder ist nicht mehr aktuell.', 404);
    }
    // Read only. A success URL/session ID never creates a credit or grants Pro.
    const account = this.store.account(userId);
    return { status: account.plan === 'pro' ? 'active' : 'pending', mode: 'test', account };
  }
  async webhook(raw, signature) {
    const event = verifyWebhook(raw, signature, this.webhookSecret, this.store.now());
    if (event.livemode !== false) throw new AppError('BILLING_MODE_MISMATCH', 'Nur Stripe-Testereignisse werden akzeptiert.', 400);
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
      if (sub.livemode !== false) throw new AppError('BILLING_MODE_MISMATCH', 'Stripe mode mismatch.', 400);
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
      if (latestInvoice && (objectId(latestInvoice.customer) !== customerId ||
        objectId(latestInvoice.subscription || latestInvoice.parent?.subscription_details?.subscription) !== sub.id || latestInvoice.livemode !== false)) {
        throw new AppError('BILLING_INVOICE_MISMATCH', 'Rechnung gehört nicht zu diesem Test-Abo.', 400);
      }
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
