# Immutable Market Snapshots

Market Snapshots capture the first tradable bar at or after a video's verified
YouTube publication timestamp. Exchange-traded assets use regular-session bars;
continuous markets such as crypto are marked separately.

## Safety contract

- `published_at` must come from the YouTube Data API and include time zone data.
- The preferred resolution is one minute. Coarser intraday fallbacks are marked.
- Daily closing prices are never presented as prices available at publication.
- Every snapshot has a deterministic ID and a SHA-256 integrity hash.
- `SnapshotRepository` creates files with `wx`; it has no update or delete API.
- Outcome data is mutable and must be stored separately from this ledger.

## Environment

```text
YOUTUBE_API_KEY=...
TWELVE_DATA_API_KEY=...
MARKET_SNAPSHOT_ROOT=C:\absolute\recovery-or-staging-path\market-snapshots
```

The snapshot endpoints stay disabled until `MARKET_SNAPSHOT_ROOT` is set.
Provider keys are only read by the Node backend.

## API

```text
GET  /market-snapshots/health
GET  /market-snapshots/:snapshotId
POST /market-snapshots/capture
```

Capture request:

```json
{
  "videoId": "4u8dR2Dxcdc",
  "companyIndex": 0
}
```

The capture endpoint retrieves `snippet.publishedAt` from YouTube. It does not
accept a client-provided publication timestamp, ticker, or call ID. Ticker and
deterministic call ID are resolved from the stored report.

## Dry run

```powershell
node .\server\scripts\market-snapshot-dry-run.js `
  --dry-run `
  --source .\server\data\videos.json
```

Dry-run mode performs no API calls and no writes. It inventories snapshot
candidates, missing tickers, and publication timestamp quality.
