const BASE_URL = "https://api.twelvedata.com";

function getApiKey() {
  const apiKey = process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    throw new Error("TWELVE_DATA_API_KEY fehlt.");
  }

  return apiKey;
}

async function request(endpoint, params) {
  const url = new URL(`${BASE_URL}${endpoint}`);

  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `apikey ${getApiKey()}`
    }
  });

  const data = await response.json();

  if (!response.ok || data.status === "error") {
    throw new Error(
      data.message ||
      `Twelve Data request failed: ${response.status}`
    );
  }

  return data;
}

function toNumber(value) {
  if (value == null || value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

async function getQuote(symbol) {
  const data = await request("/quote", {
    symbol
  });

  return {
    symbol: data.symbol || symbol,
    name: data.name || null,
    exchange: data.exchange || null,
    currency: data.currency || null,

    current: {
      price: toNumber(
        data.extended_price ?? data.close
      ),
      timestamp:
        data.extended_timestamp ??
        data.timestamp ??
        null,
      datetime: data.datetime || null,
      extended: data.extended_price != null
    },

    session: {
      open: toNumber(data.open),
      high: toNumber(data.high),
      low: toNumber(data.low),
      close: toNumber(data.close),
      previous_close: toNumber(data.previous_close),
      change: toNumber(data.change),
      percent_change: toNumber(data.percent_change),
      market_open: data.is_market_open ?? null
    },

    week_52: {
      low: toNumber(data.fifty_two_week?.low),
      high: toNumber(data.fifty_two_week?.high)
    }
  };
}

module.exports = {
  getQuote
};