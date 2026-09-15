# Free-user analysis: diagnosis and local verification

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
