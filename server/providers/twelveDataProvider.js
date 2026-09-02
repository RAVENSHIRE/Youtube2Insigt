const BASE_URL = "https://api.twelvedata.com";
const DEFAULT_TIMEOUT_MS = 15_000;

class MarketDataProviderError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "MarketDataProviderError";
    this.code = options.code || "MARKET_DATA_PROVIDER_ERROR";
    this.status = options.status || null;
    this.retryable = Boolean(options.retryable);
  }
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeSymbol(value) {
  const symbol = cleanString(value)?.toUpperCase() || null;

  if (!symbol || !/^[A-Z0-9./:_-]{1,64}$/u.test(symbol)) {
    throw new MarketDataProviderError("Ungültiges Market-Data-Symbol.", {
      code: "INVALID_SYMBOL"
    });
  }

  return symbol;
}

function formatUtcParameter(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new MarketDataProviderError("Ungültiger Market-Data-Zeitpunkt.", {
      code: "INVALID_TIME_RANGE"
    });
  }

  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/u, "");
}

function parseUtcDateTime(value) {
  const datetime = cleanString(value);

  if (!datetime) {
    return null;
  }

  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/u.test(datetime)
    ? datetime
    : `${datetime.replace(" ", "T")}Z`;
  const milliseconds = Date.parse(normalized);

  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
}

class TwelveDataProvider {
  constructor(options = {}) {
    this.apiKey = cleanString(options.apiKey || process.env.TWELVE_DATA_API_KEY);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;

    if (typeof this.fetchImpl !== "function") {
      throw new Error("fetch ist für TwelveDataProvider nicht verfügbar.");
    }
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async request(endpoint, params) {
    if (!this.apiKey) {
      throw new MarketDataProviderError("TWELVE_DATA_API_KEY fehlt.", {
        code: "PROVIDER_NOT_CONFIGURED"
      });
    }

    const url = new URL(`${BASE_URL}${endpoint}`);
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== null && value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        headers: {
          Authorization: `apikey ${this.apiKey}`
        },
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.status === "error" || data.code) {
        const status = Number(response.status) || Number(data.code) || null;
        throw new MarketDataProviderError(
          cleanString(data.message) || `Twelve Data request failed: ${status || "unknown"}`,
          {
            code: status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_REQUEST_FAILED",
            status,
            retryable: status === 429 || (status !== null && status >= 500)
          }
        );
      }

      return data;
    } catch (error) {
      if (error instanceof MarketDataProviderError) {
        throw error;
      }

      if (error?.name === "AbortError") {
        throw new MarketDataProviderError("Twelve Data request timeout.", {
          code: "PROVIDER_TIMEOUT",
          retryable: true
        });
      }

      throw new MarketDataProviderError(error?.message || "Twelve Data request failed.", {
        code: "PROVIDER_NETWORK_ERROR",
        retryable: true
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async getQuote(symbol) {
    const normalizedSymbol = normalizeSymbol(symbol);
    const data = await this.request("/quote", { symbol: normalizedSymbol });

    return {
      symbol: data.symbol || normalizedSymbol,
      name: data.name || null,
      exchange: data.exchange || null,
      currency: data.currency || null,
      current: {
        price: toNumber(data.extended_price ?? data.close),
        timestamp: data.extended_timestamp ?? data.timestamp ?? null,
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

  async getHistoricalBars({
    symbol,
    startAt,
    endAt,
    interval = "1min"
  }) {
    const normalizedSymbol = normalizeSymbol(symbol);
    const data = await this.request("/time_series", {
      symbol: normalizedSymbol,
      interval,
      start_date: formatUtcParameter(startAt),
      end_date: formatUtcParameter(endAt),
      timezone: "UTC",
      order: "ASC",
      prepost: false,
      outputsize: 5000
    });
    const bars = (Array.isArray(data.values) ? data.values : [])
      .map(value => ({
        timestamp: parseUtcDateTime(value.datetime),
        open: toNumber(value.open),
        high: toNumber(value.high),
        low: toNumber(value.low),
        close: toNumber(value.close),
        volume: toNumber(value.volume)
      }))
      .filter(bar => bar.timestamp && bar.open !== null && bar.open > 0)
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp));

    return {
      provider: "twelve_data",
      endpoint: "time_series",
      symbol: cleanString(data.meta?.symbol) || normalizedSymbol,
      exchange: cleanString(data.meta?.exchange),
      currency: cleanString(data.meta?.currency),
      instrumentType: cleanString(data.meta?.type),
      interval: cleanString(data.meta?.interval) || interval,
      exchangeTimezone: cleanString(data.meta?.exchange_timezone),
      bars
    };
  }
}

module.exports = {
  MarketDataProviderError,
  TwelveDataProvider,
  formatUtcParameter,
  parseUtcDateTime,
  toNumber
};
