// Navigation reference only: never a market-price/provider identity override.
// Verified page: https://www.tradingview.com/symbols/OANDA-XAUUSD/
function commodityTradingView(company) {
  if (String(company.asset_type || '').trim().toLowerCase() !== 'commodity' || company.identity_conflict) return null;
  const name = String(company.company || '').trim().toLowerCase().replace(/\s+/gu, ' ');
  const symbol = String(company.ticker || '').trim().toUpperCase();
  if (company.currency && String(company.currency).trim().toUpperCase() !== 'USD') return null;
  const names = ['gold', 'goldpreis', 'gold spot', 'spot gold', 'gold / usd', 'gold/usd', 'gold (usd)', 'gold in usd', 'xauusd', 'xau/usd'];
  const symbols = ['GOLD', 'XAU', 'XAUUSD', 'XAU/USD'];
  // Both supplied fields must agree. A mining company, ETF, future or EUR
  // quotation must not be silently reinterpreted as this USD reference.
  if ((!name && !symbol) || (name && !names.includes(name)) || (symbol && !symbols.includes(symbol))) return null;
  return {
    url: 'https://www.tradingview.com/symbols/OANDA-XAUUSD/',
    label: 'Gold / USD · Referenzchart (OANDA)'
  };
}
module.exports = { commodityTradingView };
