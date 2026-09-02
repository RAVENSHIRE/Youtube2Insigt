# Outcome Engine v1

The first vertical outcome slice connects each report company to its immutable
publication snapshot and live market data.

The API returns:

- price at the first tradable minute at or after YouTube publication;
- exact timestamp of that publication-price bar;
- current provider price, exact provider/fetch timestamp and raw percentage change;
- peak price and peak return since publication;
- maximum peak-to-trough drawdown using daily closes;
- SPY benchmark return and alpha in percentage points.

All ticker-bearing assets may display **market movement since mention**. Only
`actionable` and `targeted` calls display **performance since call** and are
eligible for later Creator Track Record aggregation.

Endpoint:

```text
GET /videos/:videoId/companies/:companyIndex/outcome
```

The sidepanel loads this endpoint lazily when a company report is expanded, so a
large Report Mix does not trigger dozens of provider calls at once. Snapshot
creation is idempotent and benchmark snapshots are reused per video.

To stay within provider credit limits, complete outcomes are cached for five
minutes and persisted below `MARKET_SNAPSHOT_ROOT/outcomes`. They therefore
survive server restarts. Concurrent requests for the same call share one
evaluation, and a local seven-credit budget keeps one credit in reserve on the
eight-credit free tier.

Provider errors stop snapshot interval fallback immediately; only successful but
empty interval responses may fall back from one-minute to coarser bars. When
optional history or benchmark data is temporarily rate-limited, the endpoint
returns HTTP 200 with `status: "partial"`. If a refresh is rate-limited, the last
persisted verified outcome is returned with `status: "stale"`. The sidepanel
labels that state explicitly and offers a controlled retry instead of exposing
the provider's raw error message.
