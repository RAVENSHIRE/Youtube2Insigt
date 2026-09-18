> Pro-Testcheckout (18.09.2026): [Aktuelle Einrichtung und Abnahme](PRO_CHECKOUT_ACCESS.md). Dieser Branch erfordert `BILLING_MODE=test`; Live-Schlüssel bleiben gesperrt. Die ältere Checkliste unten allein aktiviert keine Zahlungen.

# MVP setup and reversible recovery

This is a release-candidate setup, not evidence of an existing deployment.
Use **one existing project directory**, Node 24 LTS and the release branch. Never
send `.env`, bearer tokens, database backups or keys in chat or commit them.

## 1. Windows checkout without losing local work

Stop the Node server before changing branches. Run each complete block; never
continue after a nonzero Git/test exit code. No automatic stash/pop/reset is used.

```powershell
Set-Location 'C:\Users\j.krayenbuehl\Desktop\dev\Youtube2Insigt'
git status --short --branch
git stash list -n 10
if (@(git status --porcelain).Count -gt 0) {
    throw 'Local changes exist. Back them up and resolve them before switching; nothing was discarded.'
}
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed.' }
git show-ref --verify --quiet refs/heads/release/paid-beta-rc1
if ($LASTEXITCODE -eq 0) {
    git switch release/paid-beta-rc1
} else {
    git switch -c release/paid-beta-rc1 --track origin/release/paid-beta-rc1
}
if ($LASTEXITCODE -ne 0) { throw 'Branch switch failed.' }
git merge --ff-only origin/release/paid-beta-rc1
if ($LASTEXITCODE -ne 0) { throw 'Local branch differs; do not reset it.' }
```

Before **any configuration change**, back up `.env` and current data to your
existing recovery location, with a new timestamped filename. Keep it private.
Existing stashes and the existing recovery directory remain in place.

```powershell
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Recovery = 'C:\Users\j.krayenbuehl\Desktop\dev\Youtube2Insigt-Recovery-20260901-115727'
if (-not (Test-Path -LiteralPath $Recovery -PathType Container)) { throw 'Confirm the recovery path first.' }
if (Test-Path -LiteralPath '.env') {
    Copy-Item -LiteralPath '.env' -Destination (Join-Path $Recovery "env-before-mvp-$Stamp.txt") -ErrorAction Stop
} else {
    Copy-Item -LiteralPath '.env.example' -Destination '.env' -ErrorAction Stop
}
git check-ignore --quiet .env
if ($LASTEXITCODE -ne 0) { throw '.env is not ignored.' }
node --version
npm ci --prefix server --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
npm test --prefix server
if ($LASTEXITCODE -ne 0) { throw 'Regression failed.' }
```

Do not stage `server/data/videos.json` or recovery files as part of this release.
The branch does not rewrite original data or claim access to the Windows workspace.

## 2. Account-mode configuration

Edit the existing root `.env` privately; retain unrelated keys and legacy paths.

| Variable | Required value / purpose |
| --- | --- |
| `APP_MODE` | `accounts` (default); `legacy` only for localhost compatibility |
| `PUBLIC_BASE_URL` | `http://localhost:3000` locally; real HTTPS origin in production |
| `ACCOUNT_DB_PATH` | Absolute SQLite filename; e.g. project `server/runtime/accounts.sqlite`; persistent `/data/accounts.sqlite` in container |
| `EXTENSION_ORIGINS` | Exact `chrome-extension://` ID shown in `chrome://extensions` |
| `GEMINI_API_KEY`, `YOUTUBE_API_KEY` | Server-only configured AI model + YouTube Data API v3 |
| `RESEND_API_KEY`, `MAIL_FROM` | Verified sending domain/address; required for registration |
| `STRIPE_SECRET_KEY` | Stripe **test-mode** secret during acceptance |
| `STRIPE_PRO_PRICE_ID` | One test-mode **monthly recurring** Price; no client-controlled amount |
| `STRIPE_WEBHOOK_SECRET` | Secret for this exact test endpoint/listener |
| `PRO_MONTHLY_ANALYSES` | Positive integer, default 20; monthly quota, not a selling-price decision |
| `COMMERCIAL_MARKET_DATA_APPROVED` | `false` until actual commercial rights are confirmed |

Restart after changing `.env`. No keys belong in extension code. Account tokens
use extension session storage, not content-script accessible local storage.

```powershell
node .\server\server.js
```

In a second terminal:

```powershell
Invoke-RestMethod 'http://localhost:3000/health' | Format-List
Invoke-RestMethod 'http://localhost:3000/config' | Format-List
node .\server\scripts\release-check.js
```

The last command is a **production configuration check**, not a health probe.
Exit 1 is expected for a localhost setup/missing credentials; exit 0 only means
configuration is present, **not** that a provider, deployment or payments work.

Open `http://localhost:3000/account/`, choose **Konto erstellen**, enter email,
confirm email, password and confirm password, confirm the email, then sign into
the panel with that account. One free analysis appears only after verification.
Sign-in remains email + password. A pending account can request another link via
**Bestätigungslink erneut anfordern** with its original credentials. Provider
acceptance is not inbox delivery. Follow the current
[authentication acceptance and email setup](AUTH_PRODUCTION_READINESS.md).
The UI's Pro button opens Checkout; the verified webhook grants access, never the
redirect URL. Missing mail/Stripe configuration fails clearly rather than faking it.

## 3. Build and load the extension

From the project root, use a **new** output name on each build; the builder will
not overwrite an existing folder. These are generated extension assets, not a
second repository or backend. The old unused popup is excluded from the package.

```powershell
node .\server\scripts\build-extension.js --api-base http://localhost:3000 --output build/extension-rc1-local --development
if ($LASTEXITCODE -ne 0) { throw 'Extension build failed.' }
```

In `chrome://extensions`: enable Developer mode → Load unpacked → select that
`build/extension-rc1-local` directory. Record its ID in `EXTENSION_ORIGINS` and
restart the server. Reload the extension **and the open YouTube tab** after code
updates so the content script is current. Do not install both old and new copies.

For a deployed backend, replace the URL (no path) with the real HTTPS origin:

```text
node server/scripts/build-extension.js --api-base https://YOUR-BETA-DOMAIN --output build/extension-rc1-production
```

Production host permissions contain that origin, not localhost. Pack only the
contents of the generated extension folder for store submission. Do not upload
the backend, `.env`, database, original reports or recovery bundle.

## 4. HTTPS deployment template — not yet deployed or container-tested

Use a server with Docker, a real DNS name pointing at it, persistent local disk,
ports 80/443 and backup monitoring. Choose **one application replica**: quota
reservations are transactional SQLite operations; provider deduplication and
Stripe canonical reconciliation also use process-local locks. No multi-host/NFS
deployment is supported by this MVP.

Set `BETA_DOMAIN` in the operator environment/root `.env`, production API keys and
the production extension ID. `deploy/compose.yaml` enforces accounts mode, HTTPS
public origin and the persistent volume. It does not publish the Node port.

```text
docker compose --env-file .env -f deploy/compose.yaml config --quiet
docker compose --env-file .env -f deploy/compose.yaml up -d --build
```

`config --quiet` avoids printing environment secrets. This deployment command is
for the operator after configuration review; it was **not executed here**.
Do not enable live Stripe keys until the test-mode acceptance matrix is complete.
Configure provider timeouts/egress, monitoring and durable off-host backup storage.

## 5. Optional providers and source limits

YouTube sync: configure OAuth web-client ID/secret, callback
`PUBLIC_BASE_URL/youtube/callback`, consent screen and test users/approval.
`APP_ENCRYPTION_KEY` is a secret random 32-byte base64 value, retained across
restarts and backed up separately. Scope is `youtube.readonly`, maximum 200
subscriptions per scan, selection maximum 100. The scan never analyzes histories.
Without these credentials use manual @handle/channel-URL selection. An operator
flag about OAuth approval is not a genuine approval check.

DE/EN caption analysis: at most 60 minutes, verified duration, bounded segments.
No caption or rejected language returns a failed job and releases the credit.
An optional HTTPS `AUDIO_TRANSCRIPTION_URL` + server-only key adapter requests
authorized original-language speech alignment: maximum 15 minutes/30 MB. The
gateway itself is **not supplied** by this repository; no media-access restriction
is bypassed. It must return `translated:false`, matching `source_video_id`,
`timing_origin:"speech_alignment"`, language, and segments with `text`, `offset`,
`duration` in seconds. Do not advertise working transcript-free analysis until it
has been supplied and verified.

Visual extraction is an optional Pro **API**, not an automatic panel feature:
`POST /videos/:id/visual-evidence` with `confirmVisual:true`, `startSeconds`,
`endSeconds`; at most a 30-second window, 3 attempts/day, own saved video only.
Enable `ENABLE_VISUAL_EXTRACTION=true` only after genuine provider testing.
Observations are stored separately, labelled unverified; no chart is redrawn and
no visual observation is turned into a verbatim transcript quotation.

## 6. Data preservation and reversible repair

The new account DB does **not** silently import all creator JSON records into each
customer's library. Existing creator-v2 JSON and market snapshots stay at their
configured paths. To inspect the old working collection, stop accounts mode and
use `APP_MODE=legacy` locally with the original environment; never expose it.
Bulk customer assignment/import of old reports is **not implemented** in this RC.

For an affected JSON report, `repair-evidence.js` defaults to a write-free plan:

```text
node server/scripts/repair-evidence.js --source ABSOLUTE_VIDEOS_JSON --video-id VIDEO_ID --output ABSOLUTE_NEW_REVISION_DIRECTORY
```

After reviewing the plan, append `--apply` to call the configured source/AI
providers. The original is backed up and unchanged; the new immutable revision is
inactive, not automatically applied to personal libraries. Inspect source matches
and timestamp navigation before an explicitly approved adoption. An Arabic legacy
quote is not retroactively labelled verified just because the code was upgraded.

Back up an account DB with the supplied SQLite-aware utility (includes WAL data):

```text
node server/scripts/backup-accounts.js --source ABSOLUTE_ACCOUNTS_SQLITE --output ABSOLUTE_NEW_BACKUP_SQLITE
```

It refuses overwrites, checks the copy's integrity and leaves the source intact.
Restore drill: stop the app; back up the current DB first; point
`ACCOUNT_DB_PATH` at a **separate verified backup filename**; start and verify both
accounts/library/quota. Do not overwrite a live DB or delete its WAL files.
After a process crash, expired job leases are released on account/job access or
the next reservation. Original reports, stashes and snapshots are never deleted.
