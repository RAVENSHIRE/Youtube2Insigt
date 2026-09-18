const { tradingViewLink, identityConflict } = require('../instruments/marketIdentity');
const { resolveInstrumentIdentity } = require('../instruments/instrumentResolver');
const { AppError } = require('../accounts/store');

// Watchlist only: the remaining Yahoo-style position columns intentionally stay empty.
const HEADERS = ['Symbol','Current Price','Date','Time','Change','Open','High','Low','Volume','Trade Date','Purchase Price','Quantity','Commission','High Limit','Low Limit','Comment'];
function yahooSymbol(company, publishedAt) {
  if (identityConflict(company)) return null;
  const identity = resolveInstrumentIdentity(company, { publishedAt });
  if (!identity.performance_continuity_verified) return null;
  const link = tradingViewLink(company);
  const match = link?.match(/^https:\/\/www\.tradingview\.com\/symbols\/(NASDAQ|NYSE|AMEX)-([A-Z][A-Z0-9.]{0,19})\/$/u);
  // Only resolved US listings. Do not guess suffixes for foreign or ambiguous assets.
  return match ? match[2].replaceAll('.', '-') : null;
}
function exportWatchlist(report) {
  const symbols = new Set(), skipped = [];
  for (const company of report.companies || []) {
    const symbol = yahooSymbol(company, report.video?.published_at);
    if (symbol) symbols.add(symbol);
    else skipped.push({ company: company.company || null, ticker: company.ticker || null });
  }
  const rows = [...symbols].map(symbol => [symbol, ...Array(HEADERS.length - 1).fill('')].join(','));
  return { csv: [HEADERS.join(','), ...rows, ''].join('\r\n'), symbols: [...symbols], skipped };
}
function sendWatchlist(res, report) {
  const result = exportWatchlist(report);
  if (!result.symbols.length) throw new AppError('EXPORT_NO_RESOLVED_SYMBOLS', 'Keine eindeutig zugeordneten US-Symbole für den Export vorhanden.', 422);
  const videoId = /^[\w-]{11}$/u.test(report.video?.id || '') ? report.video.id : 'report';
  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Disposition', `attachment; filename="signaltube-${videoId}-watchlist.csv"`);
  res.type('text/csv').send(result.csv);
}
module.exports = { HEADERS, yahooSymbol, exportWatchlist, sendWatchlist };
