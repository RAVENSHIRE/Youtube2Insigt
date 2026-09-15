# Authentication fix — 15 September 2026

Branch: `fix/auth-registration-verification`, based on tested release commit
`ad0691e` (Example Library/channel counters/TradingView fixes included).
No merge to `main`. No existing customer, creator, report or snapshot migration.

## What was broken

- The account page reused the two-field sign-in form for registration. Neither
  client nor server required confirmation of email/password.
- The supplied local `/health` response reported `emailConfigured: false`.
  This means the configured Mailer could not send: the old implementation required
  `RESEND_API_KEY`, `MAIL_FROM` and a public URL. It correctly refused registration
  in that condition; changing Gemini/YouTube keys cannot enable email delivery.
- Presence of email settings was treated as sufficient configuration; provider
  errors lacked actionable explanations, and successful HTTP responses were not
  checked for a provider receipt. Provider acceptance is not inbox delivery.
- A registration retry for an existing verified account could return a generic
  "link sent if necessary" message even though no mail was sent.
- An unverified account and an incorrect password produced the same login error.
  There was no visible resend flow. A send failure left a pending account with
  no clear recovery instructions.

The Windows `.env` and Resend delivery logs are not accessible here. There are no
Resend credentials in this checkout/session. The **current** sender-domain or
inbox failure cannot be diagnosed from a screenshot alone; no real delivery is
claimed. The historical `emailConfigured: false` is evidence of missing setup,
not evidence that Resend accepted an email and lost it.

## Changes

- Separate registration form: email, confirm email, password, confirm password.
  Both client and server validate confirmations. Passwords remain 12–128
  characters and use the existing salted scrypt implementation. Sign-in remains
  email + password, including in the extension.
- Resend configuration validates sender syntax and a credential-free HTTPS
  origin (HTTP allowed only on localhost for development). Successful API replies
  require a message ID. UI says **accepted by provider, delivery unconfirmed**.
  Missing config, provider rejection, rate limits, network/response errors fail
  explicitly. Raw provider bodies and credentials are never returned.
- A pending account is retained after a send failure; the failed token is revoked.
  Existing successfully sent links remain valid until use/expiry. Authenticated
  resend uses the existing email/password. Per-IP and per-email limits apply.
- Registration retries do not replace existing passwords. Pending accounts can
  recover their password via email and request a new verification link. Password
  recovery invalidates old verification links and sessions.
- Verification links use `/account/#verify=…`. Only hashes are stored. Tokens
  expire after one hour, can be consumed once, and grant one free analysis once.
  The page clears the token from its visible URL before sending it to the server.
- No schema change or data rewrite. TradingView, examples, analysis, billing and
  extension rendering code are unchanged.

## Automated verification

Result on 15 September 2026: **147 tests passed, 0 failed, 0 skipped** using
`npm test --prefix server` on Node 24.19.0. This includes all 126 previous tests
and 21 new authentication/page tests. `git diff --check` passed. Extension,
example fixtures, instrument projection and analysis implementation files have
no changes relative to `ad0691e`.

Run the complete existing suite, including the new tests:

```powershell
npm test --prefix server
if ($LASTEXITCODE -ne 0) { throw 'Tests failed. Do not deploy.' }
```

New HTTP/DOM-contract coverage includes successful registration and login after
verification, both mismatches, missing confirmations, invalid email, pending
login, missing configuration, provider rejection, timeout/network failure,
malformed success replies, resend/recovery, invalid/expired/replayed/wrong-purpose
links, concurrent verification, email limits and no duplicate free grants.

Existing regressions explicitly cover the public Example Library, the IPO Market
Watch report and exact RKLB/ASTS TradingView URLs, personal-library isolation,
analysis consumption, source failures/credit recovery, timestamps, instrument
resolution and Stripe contracts. These are automated fixtures. The account-page
tests run real event handlers against a small DOM fixture, **not Chrome E2E**.

Genuine Resend acceptance/inbox delivery, production-domain verification and
installed-extension/browser acceptance remain to be performed below. No live
YouTube/Gemini, Stripe payments or deployment is claimed by this patch.

## Exact local update and acceptance

Stop your Node server. Use your existing project directory. If local changes
exist, stop and preserve them; these commands do not stash, delete or reset them.

```powershell
Set-Location 'C:\Users\j.krayenbuehl\Desktop\dev\Youtube2Insigt'
if (@(git status --porcelain).Count -gt 0) { throw 'Preserve local changes before switching.' }
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed.' }
git show-ref --verify --quiet refs/heads/fix/auth-registration-verification
if ($LASTEXITCODE -eq 0) {
    git switch fix/auth-registration-verification
} else {
    git switch -c fix/auth-registration-verification --track origin/fix/auth-registration-verification
}
if ($LASTEXITCODE -ne 0) { throw 'Branch switch failed.' }
git merge --ff-only origin/fix/auth-registration-verification
if ($LASTEXITCODE -ne 0) { throw 'Branch differs; do not reset.' }
npm test --prefix server
if ($LASTEXITCODE -ne 0) { throw 'Regression failed.' }
```

Back up the existing root `.env` privately before editing it (see
[MVP setup](MVP_SETUP.md)). Keep all unrelated settings. Configure:

| Setting | Required action |
| --- | --- |
| `RESEND_API_KEY` | Valid Resend key with sending permission for your domain; server only |
| `MAIL_FROM` | `YT Research <verify@YOUR-VERIFIED-DOMAIN>`; use your own verified sender |
| `PUBLIC_BASE_URL` | `http://localhost:3000` for testing on this PC; real `https://YOUR-DOMAIN` for launch, no path |
| `ACCOUNT_DB_PATH` | Keep the current persistent absolute SQLite path; do not point to a new empty database |

In Resend, verify the sending domain using its supplied DNS records. A test
`resend.dev` sender is restricted and is not a production sender. Check the key's
permissions, sending quota and domain restrictions. See official
[domain setup](https://resend.com/docs/dashboard/domains/introduction),
[send API](https://resend.com/docs/api-reference/emails/send-email) and
[error reference](https://resend.com/docs/api-reference/errors).

Start the server with `node .\server\server.js`. In another terminal:

```powershell
(Invoke-RestMethod 'http://localhost:3000/health').emailConfigured
Start-Process 'http://localhost:3000/account/'
```

`True` verifies configuration syntax/presence only. Then:

1. Choose **Konto erstellen**; confirm exactly four fields. Try mismatched emails
   and passwords: no registration request should succeed.
2. Register using an inbox you control. Check Resend's email log for acceptance
   and delivery/bounce status, then check the actual inbox/spam. The page must not
   promise delivery. Never paste the verification link or token into chat.
3. Open the email on the same PC while testing localhost. For external devices,
   use the hosted HTTPS address; their localhost does not reach your server.
4. Confirm the link grants one free analysis. Log out, then sign in with just
   email/password. Repeat from the extension's existing sign-in form.
5. Open the link again: explicit invalid/used-link error, no additional credit.
   For a pending account use **Bestätigungslink erneut anfordern** with the
   original email/password; use password reset if it is forgotten.
6. Reload the account page after updating code. Extension files are unchanged:
   keep the currently working installation. Recheck Example Library → IPO Market
   Watch → RKLB and ASTS ticker links and **View TradingView**; test the normal
   explicit YouTube analysis flow with a separate test account.

If no email arrives, check the explicit error code first. `EMAIL_NOT_CONFIGURED`
requires settings; `EMAIL_PROVIDER_REJECTED` requires checking Resend's key/domain
and restrictions; `EMAIL_RATE_LIMIT` requires quota reset. `EMAIL_UNAVAILABLE`
requires checking connectivity/provider logs. Accepted-but-not-delivered needs
Resend delivery/bounce diagnostics and inbox checks. Do not delete accounts or
disable verification to bypass these issues.

## Remaining production deployment gates

1. Confirm the live email acceptance → inbox → verification → logout/login test
   using the **production HTTPS origin**. Repeat for two independent customers.
2. Select the hosting target/domain, configure DNS and deployment secrets,
   preserve/back up the current SQLite data. Deploy one instance with persistent
   disk using the existing [HTTPS template](MVP_SETUP.md#4-https-deployment-template--not-yet-deployed-or-container-tested):
   `docker compose --env-file .env -f deploy/compose.yaml up --build -d`.
   Set `BETA_DOMAIN` and all required variables first. Run a restore drill.
3. Set the actual extension origin, build against the HTTPS backend and run the
   installed Chrome acceptance. Do not package `.env`, backend data or backups.
4. Complete the outstanding real Stripe test-mode Checkout/webhook/Portal
   lifecycle before enabling paid registration. `billingConfigured: false` still
   blocks subscriptions independently of email. Configure live billing only after
   that validation; no live payment has been taken here.
5. Complete example-source review, privacy/terms/operator/support information and
   store disclosures. Keep commercial market data disabled until rights exist.
   Keep unapproved OAuth sync optional/manual-only.
6. Approve the merge/release after acceptance. No merge, hosted deployment, real
   email delivery, live payments or store approval is implied by passing tests.

No new product features are included in this fix.
