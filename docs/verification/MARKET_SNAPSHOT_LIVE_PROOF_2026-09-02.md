# Market Snapshot Live Proof — 2 September 2026

## Result

The production-shaped local flow completed successfully against the configured
YouTube Data API and Twelve Data provider.

| Check | Verified value |
|---|---|
| Status | `verified` |
| Video | `QzRxievcmug` |
| Creator | DER AKTIONÄR TV (`creator_d1310ab06bc9a6de`) |
| Company / ticker | Nvidia / `NVDA` |
| Snapshot ID | `ms_be22108b65b06a95e796ac14` |
| YouTube publication | `2026-08-26T16:22:01.000Z` |
| Selected market bar | `2026-08-26T16:23:00.000Z` |
| Publication lag | 59 seconds |
| Price at video | 210.3101 USD |
| Exchange / provider | NASDAQ / Twelve Data |
| Precision | one-minute intraday bar, no fallback |
| First capture | HTTP 201, `created: true` |
| Identical replay | HTTP 200, `created: false` |
| Read-back | identical to captured snapshot |
| Integrity SHA-256 | `1073137798f5d3c671e15fb63e66fce4bd0e19ac9a52bb435cb656e3d73618d1` |

## Proven contract

- The exact publication timestamp came from the YouTube Data API.
- The first tradable bar at or after publication was selected.
- The initial snapshot was written once.
- Repeating the same request produced the same snapshot ID without another write.
- API read-back matched the captured payload.
- Snapshot integrity validation succeeded after persistence.

No API key, `.env` content or local filesystem path is included in this proof.
