# MVP release roadmap — 7 September 2026

Target: retail investors who consume finance videos, not a large trading terminal.
The extension stays compact. Working Creator Overview, channel counters, sector
Report Mix, instrument resolution and simple Research Library remain the base.

## Implementation completed; acceptance is a separate gate

- [x] Recover and push the simplified Research Library without merging `main`.
- [x] Version-8 original transcript segments, explicit timing units, DE/EN language
  guard, original quotations separate from translations, source-quote matching.
- [x] Evidence `mm:ss` buttons, existing-tab seeking, playback highlight logic;
  versioned inactive repair revisions preserve the original report.
- [x] Bounded authorized-audio gateway adapter and 30-second visual-observation API.
  Neither has a genuine live-provider proof; the audio gateway itself is external.
- [x] Persistent SQLite accounts, verified email, hashed sessions, isolated empty
  personal libraries, one free analysis and transactional quota reservation/release.
- [x] Monthly Pro Checkout, signed Stripe webhooks and Portal; duplicate,
  out-of-order, renewal, failed-payment and cancellation contract tests.
- [x] Explicit analysis action in the panel; no automatic credit consumption.
- [x] Separate three-creator legacy example library with honest source-review labels.
- [x] Compact extractive “Ask your research library”, accessible citations and coverage.
- [x] Optional consent-based readonly YouTube sync; manual creator fallback.
- [x] Commercial market-data gate, INDO/INOD conflict guard, resolved TradingView
  links where listing identity is known, quote time distinct from retrieval time.
- [x] Deployment configuration, extension builder, readiness report and verified
  SQLite backup utility. Templates are not a deployed HTTPS service.

## P0 before charging beta users

- [ ] Deploy one Node 24 instance with HTTPS, persistent storage and tested restore.
- [ ] Configure and verify email delivery, Gemini and YouTube Data API v3.
- [ ] Perform real DE/EN analysis and local Chrome timestamp/highlight acceptance.
- [ ] Configure Stripe test mode and prove actual Checkout → webhook → quota →
  renewal → failed payment → Portal cancellation. Then separately approve live mode.
- [ ] Review example originals and distribution rights; replace unverified legacy
  examples before marketing them as verified research. No invented premium corpus.
- [ ] Supply/verify the audio gateway if promising transcript-free analysis;
  otherwise explicitly restrict the beta to supported transcripts.
- [ ] Verify the targeted visual path with real source video before enabling it.
- [ ] Finalize operator identity, privacy/terms, retention/deletion process, support,
  product name and Chrome Web Store disclosures. Obtain store approval separately.

Google OAuth review may be deferred: ship manual creator selection and label sync
unavailable until approved. Commercial market-data licensing may be deferred:
keep the gate closed and do not include price/outcome features in the paid promise.

## After MVP acceptance — not in this release

Portfolio ledger/watchlists, personal PnL, public creator rankings, Stock Universe,
cross-creator consensus, deeper attribution, creator track record, community,
mobile app, full researcher terminal, strategy backtesting/Jesse and automatic
chart reconstruction. The longer-term Grand Picture is not the current backlog.
