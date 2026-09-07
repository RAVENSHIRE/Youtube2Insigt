# Youtube2Insigt — paid-beta implementation candidate

Compact Chrome Manifest V3 extension and Node.js backend for retail investors:
save financial-video research, inspect original evidence, return to the relevant
video moment, and rediscover research across selected creators.

**2026-09-07: implementation candidate, NOT approved for paid release.**
Provider credentials, deployment and acceptance checks are still required.
No merge to `main`, production deployment or live payment verification is claimed.

- [Release handoff and verification status](docs/MVP_RELEASE_HANDOFF.md)
- [Local setup, HTTPS deployment and recovery](docs/MVP_SETUP.md)
- [Chrome and real-provider acceptance checklist](docs/MVP_ACCEPTANCE.md)
- [Current scoped roadmap](ROADMAP.md)
- [Long-term product direction](docs/GRAND_PICTURE_ROADMAP_2026.md)

Requires Node.js 24 LTS (built-in SQLite). From this repository root:

```sh
npm ci --prefix server --ignore-scripts
npm test --prefix server
node server/scripts/release-check.js
node server/server.js
```

The readiness check deliberately exits nonzero when deployment configuration is
missing. It never prints secrets and never equates configuration with live proof.
Configure `.env` from `.env.example` **without overwriting an existing `.env`**.
Open `http://localhost:3000/account/` for account setup; see the setup guide for the
exact Chrome extension-origin allowlist and production build command.

Default `APP_MODE=accounts` uses a new tenant-isolated SQLite library. Existing
creator JSON files, immutable snapshots, stashes and original reports are not
deleted, imported into a customer account or overwritten. `APP_MODE=legacy` is a
localhost-only development compatibility mode, forbidden in production.

One verified account gets one personal analysis. A configured monthly Stripe Pro
plan grants a server-defined quota. Analysis starts only after explicit
confirmation; saved reports are free to reread. Commercial market data is disabled
until the operator has confirmed the necessary rights.
