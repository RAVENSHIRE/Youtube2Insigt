# MVP implementation handoff — 7 September 2026

## Outcome

**Code candidate delivered; NOT a fully verified or deployable paid release yet.**
This closes the current implementation pass with runnable code, test results,
configuration/backup/build tools and exact acceptance steps. Missing credentials
and release approvals must not be hidden behind a green unit-test total.

`release/paid-beta-rc1` is the integrated review branch. No changes were merged to
`main`; its audited reference remains `684865ebed12b05c7530b8af0f042162a981db5e`.

## Preserved and committed feature boundaries

| Branch | GitHub commit | Scope |
| --- | --- | --- |
| `feature/research-library-controls` | `3ab750674b2087caeecb3cae4acdd52cd8cf1014` | Recovered working simplified library |
| `feature/evidence-timestamps-language` | `8e5319bdd2017653fd6c9a96b7dbed4d28d67b79` | Original source segments, language/quote validation, seek/highlight and revisions |
| `feature/accounts-subscriptions` | `f33aed3ca9f58cca5e8827583ea8addf8c44b7f7` | SQLite accounts, persistent transactional credits and Stripe backend |
| `feature/mvp-onboarding-research` | `2aa8227efadb9b67ea48beae41932796c1ee7fe6` | Panel integration, examples, readonly onboarding, scoped research and market gating |
| `release/paid-beta-rc1` | Resolve branch HEAD after fetch | Integrated stack, final read-projection hardening, setup, backup and acceptance tools |

These are stacked feature branches, not separate products. Final release fixes
are on the release branch; test that branch rather than an intermediate feature.
Local commits were published through the configured GitHub Git Data API; remote
tree identities were checked against local commit trees. Local historical commit
IDs can differ from GitHub IDs because commit metadata differs, not file content.

The existing checkout was used, no second project directory was created, no
original `.env`/Windows data was accessed or deleted. Local refs/stashes were
preserved in a verified private recovery Git bundle before changes. Existing
creator storage and snapshots were not migrated or overwritten by account mode.

## Implemented

- Compact Creator Overview, counters/progress, sector Report Mix, instrument
  correction projection and simplified Research Library retained.
- Version-8 reports with original DE/EN transcript segments, source-relative
  timing, quote matching, separately labelled translations and explicit missing
  risks/targets. Failures do not become paid fabricated reports.
- Clickable evidence and existing-tab seek/highlight logic; originals retained
  when an explicit repair creates an inactive immutable revision.
- Verified-email accounts, hashed sessions/passwords, tenant-isolated persistent
  libraries, one free personal analysis, explicit consumption, reservations,
  duplicate-request handling and credit release/recovery on failures.
- Configurable monthly Pro Checkout, signed/reconciled webhooks and Customer
  Portal. Saved reports remain readable without additional analysis consumption.
- Separate three-creator **legacy** example collection, zero invented premium
  records; accessible-research-only extractive answers with citations and coverage.
- Optional readonly YouTube sync with consent, selection and disconnect; manual
  channel selection starts no analyses.
- Commercial market features disabled by default; INDO/INOD identity guard,
  known-listing TradingView links, quote timestamp distinct from retrieval time.
- Node 24/persistent-volume HTTPS deployment templates, scoped extension builder,
  no-secret readiness report and tested SQLite-aware recovery backup.

## Verified vs incomplete

**125 automated tests pass**, including two-account HTTP flows, language and
timestamp fixtures, quota recovery, offline Stripe lifecycle contracts, licensed
data gating, instrument preservation and SQLite backup. The local account API
starts without pretending missing providers are ready. Development extension
assets build successfully. Full details: [acceptance results](MVP_ACCEPTANCE.md).

**Not verified:** installed Chrome/YT playback E2E (local browser access blocked),
real Stripe test-mode lifecycle, live AI/YouTube/speech/visual providers, hosted
HTTPS, Docker execution, email delivery or Chrome Store approval.

**Partial implementations requiring a deliberate release decision:**

- Audio fallback is a bounded gateway **adapter**, not a supplied audio-ingestion
  service. Without an authorized gateway it rejects unsupported transcripts and
  releases credit; it cannot claim all videos can be analyzed.
- Visual extraction is a bounded, separately stored **API path**, not automatic
  extraction or an integrated panel workflow; live reliability remains unproved.
- Example reports are reviewed legacy excerpts, **not source-verified demos**.
  Their original video quotations/times must be reviewed before marketing them.
- Evidence repair creates an inactive revision. Automatic account-library
  adoption and bulk customer import of legacy JSON are not implemented.
- “Ask research” selects and returns accessible stored evidence; it is not a
  general free-form research terminal. Legacy-only material is insufficient.
- Correct TradingView links are provided only where a listing is known; unknown
  exchanges are not guessed. Commercial outcomes and performance sorting stay
  unavailable while market rights are unconfirmed.
- Attribution and financial-metric methodology are still bounded by the existing
  engine. This release makes no independently verified creator-performance claim.

## Consolidated operator actions / blockers

| Priority | Action needed | Release effect |
| --- | --- | --- |
| Required | Supply a hosting target/domain, deploy one Node 24 instance with HTTPS/persistent disk and execute restore drill | No hosted product exists yet |
| Required | Privately configure Gemini, YouTube Data API v3 and verified email sending; run real DE/EN cases | Registration/provider validity not proven |
| Required | Configure Stripe test secret, monthly Price, endpoint signing secret and Portal; execute actual lifecycle matrix | Subscription code is not yet externally verified |
| Required | Run installed Chrome evidence/tab/highlight and two-customer acceptance | Cloud browser could not access local app |
| Required for promised examples | Review original sample videos and redistribution rights; replace/approve samples | Current examples are explicitly unverified legacy sources |
| Required if promising fallback/visuals | Supply authorized speech gateway, validate audio alignment and real visual extraction | Adapters/API alone do not complete these promises |
| Required | Finalize operator identity, privacy/terms, support, retention/deletion, branding and store disclosures | Technical privacy page is a placeholder, not legal approval |
| Optional/deferred | Google OAuth consent verification/approval; otherwise manual creators only | Do not advertise subscription sync as released |
| Optional/deferred | Confirm commercial market-data display/storage rights; otherwise leave flag false | Research-only beta possible after other gates; do not sell market data yet |
| Final approval | User authorizes `main` merge only after acceptance; store review is separate | No main merge/store/live-payment claim |

No raw keys are needed in chat. Configure normal deployment secrets privately and
return sanitized pass/fail evidence. Do not use Massive Basic as an assumed
commercial replacement and do not import a competitor's proprietary corpus.

## Exact next local step

Use [Windows checkout/setup](MVP_SETUP.md), then run:

```text
npm test --prefix server
node server/scripts/release-check.js
node server/server.js
```

Follow the [Chrome and Stripe acceptance checklist](MVP_ACCEPTANCE.md).
Do not continue using a stale branch or old unpacked extension directory. There
is no need to create another repository, reset local changes or merge `main`.
