# Open the saved Free report in the account page and extension

The user confirmed a genuine local completion for `RN_C7a66OSA`, job
`fe9ef3c8-2c53-45c5-97c6-dd91c171cdce`. The API logs `analysis_completed`
only after account storage completes. Do not analyze the video again to read it.

## Findings and change

- `EXTENSION_ORIGINS` is an exact allowlist. An unpacked extension whose ID is
  absent receives `ORIGIN_DENIED`. Keep this check; do not allow every extension.
  The extension now displays the precise origin needed for its own ID.
- Extension login now switches from example scope to the personal library.
  Web and extension login sessions are separate; sign into the same verified
  email address in the extension. No cookie/token copying is required.
- The account page previously rendered only a title/summary and a YouTube link.
  It now has **Vollständigen Report öffnen**, which reads the authenticated
  `/videos/:videoId` route and renders theses, actions, targets, levels, risks,
  original quotations and source timestamp links. Existing verified TradingView
  links remain clickable. Reopening a loaded report does not repeat the request.
- No source, account, credit, authentication, Resend, analysis or market-data
  migration is required. The completed report is reused. Read responses remain
  owner-scoped. Logout clears rendered personal records and invalidates pending
  report responses in the page.

## Local setup

1. Apply `saved-report-access.patch` on top of the preceding recovery patches.
2. Open `chrome://extensions`, enable Developer mode and copy the ID of the
   extension actually loaded from this project's `extension` directory.
3. In the project-root `.env`, set (replace the placeholder with that actual ID):

```dotenv
EXTENSION_ORIGINS=chrome-extension://YOUR_ACTUAL_32_CHARACTER_ID
GEMINI_MODEL=gemini-3.5-flash
```

Preserve all other settings. If multiple extensions are deliberately allowed,
append comma-separated exact origins to the existing `EXTENSION_ORIGINS` entry.
The expected ID contains 32 letters from `a` through `p`, with no trailing slash.
A PowerShell environment variable overrides the same dotenv entry; keep them
consistent or start a fresh terminal after updating `.env`.

4. Run `npm test --prefix server`, restart `node server/server.js` from the
   project root, then reload the extension in `chrome://extensions`.
5. Open `/account/` and click **Vollständigen Report öffnen** on Report 1.
6. Reopen the side panel, sign into the same account, select **Meine Bibliothek**
   and the report's creator. The existing Research Library report opens normally.
   There is no need to start another analysis or purchase another credit.

## Verification and limitations

Full regression run: **202 tests passed, 0 failed, 0 skipped** on Node.js 24.19.0.

Automated HTTP tests cover explicit extension-origin allow/deny, preflight,
real login against fixture accounts, owner-scoped report reads, isolation of a
second account and unchanged credit balance. DOM contract tests cover the real
account-page click handler and open/close/reopen with no analysis POST. Rendering
tests cover full report fields, RKLB/ASTS TradingView URLs, timestamp links,
escaping and unverified legacy evidence. The existing full suite also covers
authentication, examples and analysis regressions.

These are automated HTTP/DOM tests, not a verified installed-Chrome-extension
test. The attempted cloud-browser session did not remain available, so no browser
pass is claimed. The user's actual extension ID and local login/display must be
verified on their Windows machine. No personal data or API credentials were used
in these fixture tests.
