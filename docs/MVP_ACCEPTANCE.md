# MVP acceptance — results and repeatable checks

Date: 2026-09-07. Do not mark an item passed based only on a configured key,
`/health`, a fake webhook, an old screenshot or this checklist.

## Results produced in this implementation session

| Level | Result | What it proves / does not prove |
| --- | --- | --- |
| Node automated regression | **125 passed, 0 failed** | Source fixtures, domain logic, storage, security and HTTP contracts |
| Two-account HTTP integration | Passed with injected AI/email fixtures | Empty personal libraries, explicit credit, 402 limit, own rereads, cross-account 401/404; not real email/AI |
| Stripe contract tests | Passed with simulated canonical Stripe responses | Signature checking, duplicate/out-of-order events, renewal grants, failed payment and cancellation logic; **not a Stripe test-mode lifecycle** |
| Evidence navigation | Automated VM/unit tests passed | Tab reuse/seek-message and rendering contracts; not actual YouTube playback |
| Browser E2E | **Blocked / not passed** | Cloud browser local account URL returned `net::ERR_BLOCKED_BY_CLIENT`; no bypass attempted |
| API startup | Passed locally without provider keys | Default account mode starts and reports missing configuration honestly |
| SQLite recovery | Passed with synthetic persisted data | WAL-aware backup opens with `integrity_check=ok`; no production restore claimed |
| Extension packaging | Local development build generated and inspected | Manifest paths/config/packaging; not installed in Chrome or store-approved |
| Live Gemini / YouTube / speech / visuals | Not run: credentials/gateway unavailable | Prior user-provided snapshot evidence is historical, not this RC's proof |
| Hosted HTTPS / Docker / Stripe live payments | Not performed | Deployment files are templates, not deployment evidence |

Run regression from root: `npm test --prefix server`. Provider network calls are
mocked in automated tests; local HTTP sockets/SQLite are real. Fixtures explicitly
use synthetic accounts and test values, not claimed live investment performance.

## Local Chrome acceptance — operator must execute

Follow [setup](MVP_SETUP.md), build/load **one** extension and configure its exact
origin. Start the backend; open DevTools for both side panel and service worker.

1. **Fresh onboarding:** logged out, switch to examples. Three labelled example
   creators appear; switch back and no personal reports should appear. Register
   account A via real email verification. Exactly one free analysis; personal
   library empty. Repeat with account B in a separate Chrome profile.
2. **No silent consumption:** open an unanalysed English finance video. Opening,
   refreshing and switching tabs must not call `POST /analyze`. The explicit
   button states one analysis. Click once; rapid duplicate requests must reuse
   the same job. Poll to complete or a clear failure with released credit.
3. **Free limit and privacy:** A can reread its saved video at zero cost. A's
   second new video returns 402 without starting AI. B cannot read A's video/job
   ID (404), still has one free credit and an empty library. Logged-out reads
   return 401. Switching accounts/scopes must clear old cards and research answers.
4. **Sources:** test one real English IPO Market Watch video and one German
   DER AKTIONÄR video. Check original subtitle track, quotation text, segment
   start/end and report language. No unexpected Arabic. Missing risks/targets
   must stay missing. Compare against the actual source, not just AI output.
5. **Navigation:** with that video's existing tab open, click an `mm:ss` evidence
   marker. The same tab must be focused, the video must seek to the segment start,
   and its evidence highlight must be active only during that segment. No new
   duplicate tab. Repeat with a closed video (one tab created), a tab with playlist
   parameters, a reloaded extension and YouTube SPA navigation to another video.
6. **Current UI:** creator switching scopes counters, sector drilldown, full
   reports and Research Library to the selected creator. Test search and
   newest/oldest-analysis ordering; report numbers remain unchanged. Performance
   sort has no priced rows while the commercial-data gate is disabled—do not
   fabricate performance scores to fill it.
7. **Research questions:** ask a question supported by A's validated saved
   evidence, then one unsupported question. Citations must open the correct
   accessible video/time. An empty or legacy-only library returns insufficient
   verified evidence; it must not pretend to have searched the public internet.
8. **Failures:** run automated source-language/provider-outage tests. With a
   separate local test setup, disable the AI key and verify a clear unavailable
   result without quota loss. Test unavailable transcript and audio-off behavior.
   Restore configuration afterward; do not edit or tamper with production reports.
9. **Market gate:** authenticated `/videos/:id/companies/0/outcome` must return
   `MARKET_DATA_LICENSE_REQUIRED` while rights are not confirmed, including cached
   outcomes. INDO remains Indonesia Energy; INOD remains Innodata. An identity
   conflict must not obtain a misleading price. Known listings open the correct
   TradingView chart, not a guessed exchange/symbol.
10. **OAuth:** manual @handle selection works without OAuth. If configured and
    approved, consent requests read-only access, scan shows selectable channels,
    no analysis starts, disconnect revokes/clears credentials and preserves saved
    reports. Verify denied consent, expired state, empty list and >200 subscriptions.

Record browser/extension versions, commit, video IDs, source language, observations
and console failures. Do not put credentials or customers' research into a public
issue. Until this list passes, the browser release gate remains open.

## Authenticated API inspection (PowerShell, no secret output)

Use an already verified **test account**. This reads saved data and quota only.

```powershell
$Credential = Get-Credential -Message 'Verified local beta test account'
$LoginBody = @{ email = $Credential.UserName; password = $Credential.GetNetworkCredential().Password } | ConvertTo-Json
$Session = Invoke-RestMethod 'http://localhost:3000/auth/login' -Method Post -ContentType 'application/json' -Body $LoginBody
Remove-Variable LoginBody -ErrorAction SilentlyContinue
$Headers = @{ Authorization = "Bearer $($Session.token)" }
Invoke-RestMethod 'http://localhost:3000/me' -Headers $Headers | Select-Object plan, analyses_available
Invoke-RestMethod 'http://localhost:3000/creators' -Headers $Headers | Select-Object totalCreators, totalAnalyzedVideos
```

Do not print `$Session`, `$Headers` or `.env`. To test consumption, use the explicit
UI action. For raw API tests the required JSON is
`{"videoId":"YOUR_VIDEO_ID","confirmCredit":true}` at `POST /analyze`;
poll the returned own `jobId` at `GET /analysis-jobs/:id`. Do not reuse a stale
PowerShell result after an HTTP exception.

## Genuine Stripe test-mode lifecycle — still required

1. Use a dedicated Stripe test/sandbox environment and a verified test sender.
   Create **one monthly recurring Pro Price** and configure it server-side.
   Enable Customer Portal payment-method updates and cancel-at-period-end.
2. Register a webhook at the test backend's `/billing/webhook`, or forward locally
   with Stripe CLI: `stripe listen --forward-to localhost:3000/billing/webhook`.
   Save its signing secret privately in `.env` and restart. Never copy it to Git.
3. Select events: `checkout.session.completed`, `invoice.paid`,
   `invoice.payment_failed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`.
   This implementation pins Stripe API `2025-06-30.basil`; use compatible test
   events. Requests after webhook delivery reconcile the current Stripe object,
   not an event's stale subscription snapshot.
4. With account A, open **real test Checkout from the app** and complete it using
   Stripe's official test payment details. Record non-secret test customer,
   subscription, invoice and event IDs. Verify webhook 2xx, Pro active and exactly
   the configured monthly grant. A success redirect alone does not pass.
5. Resend the same event from Stripe Dashboard. Credits must not increase. Replay
   older events after a newer subscription update; canonical current state must
   win. Random `stripe trigger` fixtures with unrelated customer IDs do **not**
   demonstrate the app's customer entitlement lifecycle.
6. Exercise a second billing period with a properly associated Stripe test-clock
   customer/subscription, or a real test subscription renewal. Verify exactly one
   new period grant and expiration of the preceding period; duplicates add none.
   A mocked timer/unit test is not a substitute for this external acceptance.
7. Exercise a payment failure on that same associated test subscription. Confirm
   `past_due` blocks new Pro analyses; existing reports remain accessible. Recover
   payment and confirm only the correct paid-period entitlement is available.
8. Open **real Customer Portal** as A and schedule cancellation. Access remains
   through the paid period, then stops. Verify B cannot open A's billing session
   or read its research. Cancellation does not delete stored reports.
9. Save a sanitized acceptance record with API/Stripe timestamps and outcomes.
   No test or live Stripe credentials were available for these steps in this run.

Only after these tests and the other P0 gates pass should the operator configure
live Stripe separately, review tax/invoices/refunds/terms and authorize charging.

## Release decision

**Current decision: NO-GO for paid launch.** Independent code/test work is available
for review; external acceptance and the explicitly listed provider/content gaps
remain. No promise of completion this week or store acceptance is implied.
