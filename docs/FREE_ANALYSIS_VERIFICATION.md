# Free-user analysis: diagnosis and local verification

## Current fix: evidence text is owned by the source, not the model

The user's job `c8f3013d-49e2-40c7-9a98-afd464fe2b41` reached the second
extraction response and still failed at company 1 / evidence 2. Prompt-only
exact-copy retries did not resolve the mismatch. The rejected text itself is
not logged, so its exact wording difference is unknown.

The production Gemini schema now asks for **segment IDs only** in evidence.
The model selects short, contiguous passages supporting each company. The
server obtains their original text and times from the validated source; the
model no longer transcribes a second copy that can introduce wording changes.
The output still passes the original exact-match validator and includes
`quote_origin: source_segments` and report `evidence_extraction_version: 2`.
Only whitespace/NFC normalization already used by the source validator applies.
This certifies quotation provenance, not semantic correctness of every thesis.

Unknown, duplicate, reversed or non-contiguous IDs, excessive selections,
wrong-language prose and missing evidence remain rejected. A model that still
returns quote text, translations or timestamps in the new selection contract
is rejected rather than having its invented quote silently replaced. One bounded
selection repair is allowed under the same job deadline and credit reservation.
Legacy quote validation remains available and unchanged in strictness. Existing
reports, their source records, authentication, examples and TradingView UI are
not migrated or overwritten.

Verification: **197/197 automated tests passed**. The production schema and mode
are exercised; the HTTP Free-user account flow uses the new extraction service,
saves source-owned evidence, consumes exactly one credit and supports free reread.
Provider responses are fixtures. Invalid selections are tested to release credit.
No full live Gemini/account success is claimed; local API credentials are absent.

Apply `source-owned-evidence.patch` after all three preceding recovery patches,
run `npm test --prefix server` and restart with `gemini-3.5-flash`. Then submit
`RN_C7a66OSA` as a new account analysis. A verified new report should contain
`evidence_extraction_version: 2` and source-derived evidence markers.

## Follow-up: caption request timeout

Job `147389a0-ff9d-44c2-9232-caca8e6ac759` for `RN_C7a66OSA` failed in
`transcript` with an underlying `TimeoutError`. This is a different failure
from the previous evidence mismatch, and does not prove subtitles are absent.
Previously the 15-second request timeout was wrapped as `TRANSCRIPT_UNAVAILABLE`
with a misleading message about audio configuration/video length.

The source service now permits 20 seconds per request and retries a timed-out
caption acquisition once. Request and response-body timeouts are covered, and
all language fallbacks/retries share a 60-second transcript budget. The job's
existing cancellation and deadline remain authoritative. Persistent timeouts
produce `TRANSCRIPT_TIMEOUT` with the original cause and an explicit account-page
message. Timeout recovery does not invoke the audio fallback or change languages,
quotation validation, account storage or credit accounting.

Verification: **182/182 tests passed**, including header/body timeout recovery,
bounded failure, cancellation, acquisition deadline, no retry for missing captions
and one-credit success/failure accounting. Genuine public YouTube retrieval for
`RN_C7a66OSA` succeeded here: **277 English segments**, duration **666 seconds**.
This is a transcript-only live test, not a full Gemini/account analysis proof;
the user's connection/provider availability can still differ.

Apply `transcript-timeout-recovery.patch` on top of both preceding patches,
run `npm test --prefix server`, restart with `gemini-3.5-flash`, reload the
account page and submit a new job. No .env or database migration is needed.

## Follow-up: exact evidence rejection with Gemini 3.5

The user's live job `70b37697-5046-4684-8a8b-e51c56c848ba` for `RN_C7a66OSA`
reached `evidence_validation` with Gemini 3.5 and failed `QUOTE_SOURCE_MISMATCH`.
This proves the model responded but at least one proposed quote did not match
its cited contiguous source segments. The old log does not contain the quote;
whether the mismatch was paraphrasing, punctuation or incorrect IDs is unknown.

The extraction prompt now explicitly prohibits rewriting spelling, numbers and
punctuation. `evidenceExtractionService` retries extraction once for a quote or
segment mismatch, with exact-copy guidance and the failed company/evidence
position. It revalidates the entire result strictly. It neither accepts fuzzy
matches nor silently deletes an asset nor substitutes arbitrary source text.
Unsupported languages and model/provider errors do not trigger this repair.

Both attempts share the job's abort signal, deadline and credit reservation.
One extra extraction may incur provider usage, but not another app credit.
Persistent mismatch still fails and releases the credit. Errors now include
one-based company/evidence positions without printing customer transcript text.
No existing stored reports are rewritten.

Verification: all **174 tests passed**, including eight new exact-match,
bounded repair, cancellation, original-source preservation and Free credit
tests. These recovery tests use provider fixtures, not live Gemini responses.
A successful full live analysis of `RN_C7a66OSA` remains to be verified locally.

Apply `evidence-source-recovery.patch` after the earlier caption recovery patch,
restart the server with the verified `gemini-3.5-flash` configuration and create
a new analysis from the account page. Do not reapply the old caption patch.

## Update: causes established from the user's uploaded log

The following supersedes the earlier "cause unknown" investigation below:

- Job `8da7dbc3-49dc-4060-bba1-cec93b65ba7d`, video `av1oUOHihtU`:
  YouTube exposed only a German caption track, while metadata requested en-US.
  Requiring that metadata language caused `TRANSCRIPT_UNAVAILABLE`. The corrected
  source service falls back to the available native caption track when the
  requested language is absent. It retains German text/timing and records the
  metadata discrepancy in the hashed source provenance. Arabic/unsupported
  languages, translated URLs and invalid timings remain rejected.
- Job `d05c9dd2-3ab0-488f-b3db-f3f3aa7ecc06`, video `X24Ob9ek9rM`:
  Gemini returned HTTP 503 / UNAVAILABLE with "high demand". The installed JS SDK
  does not retry without explicit `retryOptions`. The model request now uses
  three total attempts with exponential backoff/jitter, a 45-second per-request
  timeout and the existing overall job deadline. No model/key changes or new
  credit reservations. Persistent overload becomes `MODEL_UNAVAILABLE`; 429
  becomes `MODEL_RATE_LIMIT`, both with an actionable UI message and released
  credit. Other client errors are not retried.

Additional files: `server/services/analysisModelService.js` (explicit SDK policy),
`server/test/analysisProviderRecovery.test.js` (nine regression/SDK tests),
`server/evidence/sourceIntegrity.js` (hashed language-selection provenance).

**Live verification:** the affected `av1oUOHihtU` (2,115 seconds) now loads
**1,051 German caption segments** with an en-US metadata hint. The native track
is German ASR (`a.de`). This directly verifies the reported transcript failure
is repaired on that video. The full Gemini report is not live-verified here:
the user's Google keys remain on their Windows machine. SDK retry tests use a
local HTTP provider fixture, including 503→200 success, persistent 503, 429,
non-retryable 400, cancellation and single-credit consumption/release.

**Full regression suite:** `npm test --prefix server` passed all 166 tests
(zero failures/skips) on Node.js 24.19.0. Authentication, account storage,
the extension and TradingView UI were not changed by this repair.

For provider retry guidance see [Google's troubleshooting guide](https://ai.google.dev/gemini-api/docs/troubleshooting).
Temporary recovery is possible; permanent provider availability is not promised.

Update the **existing** `fix/free-analysis-execution` branch, restart Node and
reload the account page. No `.env`, Resend, subscription or data change required.
Run each command separately after stopping the Node server:

```powershell
git -C 'C:\Users\j.krayenbuehl\Desktop\dev\Youtube2Insigt' pull --ff-only origin fix/free-analysis-execution
```

If Git reports a conflict or local changes, stop; do not reset or discard them.

```powershell
node 'C:\Users\j.krayenbuehl\Desktop\dev\Youtube2Insigt\server\server.js'
```

Retry the failed video from the account page. A continuing 503 after all attempts
is a provider outage, and must still return the credit. A new evidence-validation
error needs its own actual log; do not weaken evidence checks to force success.

## Original investigation (before the complete error log was available)

Branch: `fix/free-analysis-execution`, based on `cc6e279`.
The user has manually verified registration, Resend delivery, email verification,
login and the Free account's one credit. Those functions are preserved.

## Findings and limits

**Confirmed defect:** `AnalysisJobs.run()` caught all failures and only stored an
error code. It released the credit but never logged the error message, cause,
stack or stage. The account page displayed only the generic failure sentence.
This explains the silent server terminal, not the underlying provider failure.

**Reproduced source-selection defect:** `SourceService.get()` did not pass a
language to the installed `youtube-transcript` library. That library defaults to
the first caption track. With an English original and Arabic first in the track
list, the actual library selected Arabic and source validation correctly rejected
it as `SOURCE_LANGUAGE_MISMATCH`. The fix selects the metadata's original DE/EN
language, with a bounded retry for its exact regional code (e.g. en-US).
It never converts an unrelated track into an English original.

**The exact cause of the user's failed Windows job is not yet established.**
Neither its job/error code nor the failing video URL/current server log was
supplied. This checkout has no `.env`, YouTube key, Gemini key or existing local
customer credentials. Do not claim that the reproduced language defect was the
cause of that specific job, or that the full live analysis has been proven.

Real public YouTube probe: `https://www.youtube.com/watch?v=J3Y_JBATcWg` was
reachable, its public player metadata reported 829 seconds and English captions,
and the source service loaded 362 original English caption segments. This is a
**live transcript-only check**, not a Gemini/account end-to-end success.

## Changes

| File / function | Change |
| --- | --- |
| `server/accounts/analysisJobs.js` — `run`, `drain` | Stage-aware success/failure logging, credit release retained, hard deadline even if a provider ignores cancellation, no late report persistence |
| `server/accounts/analysisDiagnostics.js` — `atStage`, `logAnalysis`, `redact` | Logs job/video ID, stage, code, actual message/stack/cause with known secrets, credential fields and signed URL parameters redacted |
| `server/services/verifiedAnalysisService.js` — `createReportAnalyzer` | Existing report orchestration extracted without changing report shape, with metadata/transcript stages and injectable providers for tests |
| `server/server.js` — `analyzeTranscript`, `createVerifiedReport` | Wires orchestration; distinguishes model-response and evidence-validation failures; unchanged model/schema/validation rules |
| `server/evidence/sourceService.js` — `get` | Requests original-language captions; retains underlying transcript error as cause |
| `server/accounts/routes.js` — worker construction only | Injectable diagnostic logger; auth/Resend/routes/credits/billing unchanged |
| `server/web/account.js` — analysis submit handler only | Shows failure code/job ID and refreshes the available-credit count without hiding the error |
| `server/scripts/verify-free-analysis.js` | Explicit local acceptance probe against the existing verified Free account; checks saved report, fresh source, credit consumption and free reread |

No database schema change, migration, credit reset, new subscription feature or
extension redesign. Authentication, mailer, database store, examples, instrument
resolution and all extension assets are unchanged from `cc6e279`.

## Verification completed

- `npm test --prefix server`: **157 passed, 0 failed, 0 skipped** on Node 24.19.0.
  Includes the existing 147 tests and 10 new analysis/probe tests.
- HTTP integration uses real account login, SQLite credit/job operations,
  metadata parsing, installed transcript library, source integrity and report
  storage, with **explicit provider fixtures**. Failure returns the credit to 1;
  retry succeeds and leaves 0; reread costs 0; a second new video is refused.
- Incorrect caption selection reproduced against the installed library and fixed.
- A provider ignoring abort times out; the credit returns and a late result is
  never saved. A failing logging transport cannot prevent release.
- Redaction, source causes, model stage/stack, local-only probe, explicit credit
  consent and refusal to label cached sources as fresh live proof are tested.
- Existing authentication, Example Library, IPO report, RKLB/ASTS TradingView,
  source/timestamp and research regressions are green.
- Live public caption retrieval succeeded. Full live Gemini/account proof and
  installed Chrome end-to-end acceptance remain **blocked/not performed here**.

## Run the real acceptance on your existing Windows setup

Stop the Node server. Keep the current `.env` and database path. Do not recreate
an account, clear its credits, overwrite data or change the verified Resend setup.

```powershell
Set-Location 'C:\Users\j.krayenbuehl\Desktop\dev\Youtube2Insigt'
if (@(git status --porcelain).Count -gt 0) { throw 'Preserve local changes before switching.' }
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed.' }
git show-ref --verify --quiet refs/heads/fix/free-analysis-execution
if ($LASTEXITCODE -eq 0) {
    git switch fix/free-analysis-execution
} else {
    git switch -c fix/free-analysis-execution --track origin/fix/free-analysis-execution
}
if ($LASTEXITCODE -ne 0) { throw 'Branch switch failed.' }
git merge --ff-only origin/fix/free-analysis-execution
if ($LASTEXITCODE -ne 0) { throw 'Branch differs. Do not reset.' }
npm test --prefix server
if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
node .\server\server.js
```

Keep that server terminal visible. In another PowerShell terminal, use the
already verified Free account with one remaining analysis. Use the **same video
URL that failed**, assuming it has not subsequently been saved. This explicitly
starts one analysis and consumes its Free credit if successful. Password input
is hidden and piped to Node via stdin, never put in command-line arguments or
printed in the result. Do not run a second analysis concurrently during the probe.

```powershell
Set-Location 'C:\Users\j.krayenbuehl\Desktop\dev\Youtube2Insigt'
$AccountCredential = Get-Credential -Message 'Verified Free account: email and password'
$VideoUrl = Read-Host 'YouTube URL that failed'
$PreviousOutputEncoding = $OutputEncoding
$ProbeExit = 1
try {
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $ProbeInput = @{
        base = 'http://localhost:3000'
        videoUrl = $VideoUrl
        email = $AccountCredential.UserName
        password = $AccountCredential.GetNetworkCredential().Password
    } | ConvertTo-Json -Compress
    $ProbeInput | node .\server\scripts\verify-free-analysis.js --consume-credit
    $ProbeExit = $LASTEXITCODE
} finally {
    $ProbeInput = $null
    $AccountCredential = $null
    $OutputEncoding = $PreviousOutputEncoding
}
if ($ProbeExit -ne 0) { Write-Warning 'No successful fresh live proof yet. Read the result and matching [analysis] server log.' }
```

The probe does not fake verification, create users, grant credits, call Stripe,
alter settings or print report text. It closes only its own temporary session.
For a successful fresh analysis expect:

```json
{
  "status": "success",
  "credits_before": 1,
  "credits_after": 0,
  "report_saved": true,
  "source_verified": true,
  "fresh_source": true,
  "credit_consumed_once": true,
  "reread_free": true
}
```

The above is an **expected shape, not an observed live result**. Failure should
show `status: analysis_failed`, the actual code/job ID, `credits_after: 1` and
`credit_released: true`. `not_verified_cached_source` means the report worked but
was served from an older shared cache, so it is not fresh provider proof.

Then refresh `http://localhost:3000/account/`: the report must appear and the
credit count must match. Open it in the existing extension and verify the report,
evidence and TradingView links. Existing saved reports must remain readable.

## If the analysis still fails

Match the probe's job ID to `[analysis]` in the Node terminal. Send only the probe
result and that redacted log; never send `.env`, login credentials or tokens.

| Stage | What it isolates |
| --- | --- |
| `video_metadata` | YouTube API key/quota, video availability or metadata request |
| `transcript` | Missing/blocked captions, unsupported duration/language or source timing |
| `model_response` | Configured Gemini model access, quota, response completion/JSON or network |
| `evidence_validation` | Missing/incorrect quotations, unsupported language or ungrounded extraction |
| `persistence` | Report identity, reservation expiry or SQLite write |
| `credit_release` | SQLite release failure; requires immediate investigation |

Do not switch models, disable source validation or invent timestamps to make a
test pass. The correct remedy depends on the actual logged failure.

## Production status

**The Free-analysis release gate remains open until the real acceptance above
passes.** Working Resend/authentication is accepted from the user's manual proof
and is not being reconfigured. The missing access is to the user's actual
YouTube/Gemini execution environment; no keys need to be shared in chat.
If another failure occurs, its sanitized job log is the precise remaining input
needed to establish and fix that cause. No domain, hosting, Stripe or unrelated
feature work should begin before this gate is closed. No merge to `main` here.
