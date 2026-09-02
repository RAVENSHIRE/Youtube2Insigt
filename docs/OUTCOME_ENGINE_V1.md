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

To stay within provider credit limits, identical outcomes and their per-video
benchmark are cached in memory for 60 seconds. Concurrent requests for the same
call share one evaluation. When optional history or benchmark data is temporarily
rate-limited, the endpoint returns HTTP 200 with `status: "partial"`: publication
price, current price, exact timestamps and current return remain available, while
the unavailable advanced metrics are `null` and described in `warnings`.
