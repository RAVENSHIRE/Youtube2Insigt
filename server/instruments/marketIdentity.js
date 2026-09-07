const { resolveInstrumentIdentity } = require('./instrumentResolver');
const { AppError } = require('../accounts/store');
const cleanName = value => String(value || '').toLowerCase().replace(/\b(inc|ltd|limited|corporation|corp|holdings|common|stock|shares|class|plc)\b/gu, '').replace(/[^a-z0-9]/gu, '');
const EXCHANGES = { NASDAQ: 'NASDAQ', NYSE: 'NYSE', 'NYSE American': 'AMEX', AMEX: 'AMEX', XETRA: 'XETR' };
const VERIFIED_LISTINGS = Object.freeze({
  RKLB: { exchange: 'NASDAQ', names: ['rocketlab'] },
  ASTS: { exchange: 'NASDAQ', names: ['astspacemobile'] },
  GOOGL: { exchange: 'NASDAQ', names: ['alphabet'] },
  MSFT: { exchange: 'NASDAQ', names: ['microsoft'] },
  NVDA: { exchange: 'NASDAQ', names: ['nvidia'] }
});

function identityConflict(company) {
  const symbol = String(company.ticker || '').toUpperCase(), name = cleanName(company.company);
  return (symbol === 'INDO' && name.includes('innodata')) || (symbol === 'INOD' && name.includes('indonesiaenergy'));
}
function tradingViewLink(company) {
  if (identityConflict(company)) return null;
  const identity = resolveInstrumentIdentity(company);
  const symbol = identity.current_symbol;
  let exchange = identity.current_exchange || company.verified_listing?.exchange;
  const verified = VERIFIED_LISTINGS[symbol];
  if (!exchange && verified?.names.some(name => cleanName(company.company).includes(name))) exchange = verified.exchange;
  if (symbol === 'INDO' && cleanName(company.company).includes('indonesiaenergy')) exchange = 'AMEX';
  if (symbol === 'INOD' && cleanName(company.company).includes('innodata')) exchange = 'NASDAQ';
  const venue = EXCHANGES[exchange];
  if (!venue || !/^[A-Z0-9.-]{1,20}$/u.test(symbol || '')) return null;
  return `https://www.tradingview.com/symbols/${venue}-${encodeURIComponent(symbol)}/`;
}
class MarketIdentity {
  constructor(provider) { this.provider = provider; this.cache = new Map(); }
  async verify(company) {
    if (identityConflict(company)) throw new AppError('INSTRUMENT_IDENTITY_CONFLICT', 'Unternehmensname und Symbol widersprechen sich. Keine automatische Korrektur.', 422);
    const identity = resolveInstrumentIdentity(company);
    if (!identity.performance_continuity_verified) throw new AppError('INSTRUMENT_LIFECYCLE_PENDING', 'Wirtschaftliche Kontinuität ist noch nicht geprüft.', 422);
    const ticker = identity.provider_symbols.current;
    if (!ticker) throw new AppError('INSTRUMENT_UNRESOLVED', 'Eindeutiges Instrument fehlt.', 422);
    const key = `${ticker}:${cleanName(company.company)}`;
    const cached = this.cache.get(key); if (cached?.expires > Date.now()) return cached.listing;
    const result = await this.provider.request('/symbol_search', { symbol: ticker });
    const matches = (result.data || []).filter(item => item.symbol === ticker && item.exchange &&
      (!company.exchange || item.exchange === company.exchange));
    const issuer = cleanName(identity.issuer_name || company.company);
    const exact = matches.filter(item => {
      const actual = cleanName(item.instrument_name || item.name);
      return actual && issuer && (actual === issuer || actual.includes(issuer) || issuer.includes(actual));
    });
    if (exact.length !== 1) throw new AppError('INSTRUMENT_UNRESOLVED', 'Das Instrument ist beim Datenanbieter nicht eindeutig bestätigt.', 422);
    const listing = { ticker, exchange: exact[0].exchange, currency: exact[0].currency || null, provider: 'twelve_data', verified_at: new Date().toISOString() };
    this.cache.set(key, { listing, expires: Date.now() + 86400000 }); return listing;
  }
}
function presentMarket(outcome, now = Date.now()) {
  const timestamp = outcome.current_price_timestamp_source === 'provider_quote' ? outcome.current_price_timestamp : null;
  const age = timestamp ? Math.max(0, (now - Date.parse(timestamp)) / 1000) : null;
  return { ...outcome, current_price_timestamp: timestamp,
    quote_retrieved_at: outcome.quote_retrieved_at || outcome.evaluated_at,
    quote_age_seconds: Number.isFinite(age) ? age : null,
    price_freshness: !timestamp ? 'time_unknown' : age > 900 || outcome.stale ? 'stale_or_delayed' : 'recent_not_realtime_guaranteed',
    methodology: 'Hypothetical unlevered price change; no fees, dividends, FX or verified split adjustment. Drawdown uses daily closes; peak uses daily highs.' };
}
module.exports = { MarketIdentity, identityConflict, tradingViewLink, presentMarket };
