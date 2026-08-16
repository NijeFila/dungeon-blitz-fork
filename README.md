# Dungeon Blitz: R

Dungeon Blitz: R is an open-source fan revival of Dungeon Blitz maintained by The Minesa Studios. It preserves the original game while adding multiplayer support, stability fixes, localization, balance changes, and quality-of-life improvements.

## Play locally

Requirements:

- [Node.js 24](https://nodejs.org/)
- [FlashBrowser](https://github.com/radubirsan/FlashBrowser/releases/tag/v0.8), or another Flash-capable standalone client
- Git is recommended for automatic launcher updates, but the server can run without it

Launch the project with `dev-windows.bat` on Windows or `dev-mac.command` on macOS. The launcher reconciles dependencies whenever a lockfile changes, starts the game and Discord bridge, waits for readiness, and opens `http://localhost:8000/` in FlashBrowser. Set `FLASH_BROWSER_EXECUTABLE` on Windows or `FLASH_BROWSER_APP_NAME` on macOS if FlashBrowser is installed in a nonstandard location.

For a manual start:

```sh
npm install
npm install --prefix src/server
npm run dev
```

Then open `http://localhost:8000/`. The direct SWF URL is `http://localhost:8000/p/cbp/DungeonBlitz.swf?fv=cbp&gv=cbp`.

### Local accounts and saves

Runtime accounts live in ignored `src/server/data/Accounts.json`; characters live in ignored `src/server/data/saves/`. Registration, password changes, and gameplay therefore do not modify tracked files.

A fresh clone materializes the explicitly synthetic `1@gmail.com` fixture and its `RendzerA` save on first use. Existing runtime files are never overwritten. For broader testing, run:

```sh
cd src/server
npm run seed:test-account
```

This creates or refreshes `test@theminesa.studio` with `MaxMage`, `MaxPaladin`, `MaxRogue`, `NewMage`, `NewPaladin`, and `NewRogue`. The default password is `testtest`; override it with `TEST_ACCOUNT_PASSWORD`. The seeder refuses to run in multiplayer mode.

### Troubleshooting

| Symptom | Resolution |
| --- | --- |
| Node/npm is not found | Install Node.js 24 and restart the launcher. |
| FlashBrowser is not found | Install it or set the platform-specific environment variable above, then open the local URL manually. |
| Port 8000 or 8080 is in use | Stop the previous server or configure another static/game port. |
| Dependencies fail after an update | Delete only the affected `node_modules/.dungeon-blitz-lock.sha256` marker and rerun the launcher. |
| A local update was stashed | Inspect `git stash list`, then restore the labelled launcher stash with `git stash pop`. |

## Recent gameplay reliability work

- Back Alley Deals (`JC_Mission2` normal and hard): Mortis Golem and Seelie Ravager now use a canonical encounter record. Client entities are projections of that record, terminal death is irreversible, healing/revival cannot resurrect either boss, and victory still waits for both real defeat signals, the authored room-clear signal, and the completion cinematic.
- The Capstone (`AC_Mission6`): completion follows the encounter's real multi-phase eye entities instead of a persistent marker.
- The Prodigal Son (`JC_Mission3`): Prince Friedrich Hocke recovers his authored wake-up trigger if a room transition skips it, preventing the actor from remaining stuck.
- Mammoth Idols no longer route purchases to the retired payment page.

## Audit remediation status

Release 1.26 completes the audit's concrete release, persistence, gameplay-authority pilot, browser, accessibility, launcher, dependency, backup, soak, and verification deliverables. It adds a recoverable account-plus-save journal, 100-way persistence stress coverage, a 5,000-scope disposal soak, canonical Back Alley encounter state, deterministic client artifact contracts, lint/debt budgets, critical-path coverage, real Chromium/axe tests, scheduled verified backups, and clean-host container/launcher smoke jobs.

The audit is implemented as a release contract, with two deliberate boundaries documented rather than hidden: canonical encounter authority is migrated dungeon-by-dungeon (Back Alley is the production pilot with an emergency shadow-mode flag), and the large legacy handlers are governed by non-growth budgets while extraction continues. The imported client binaries are immutable and hash-verified, but pristine redistributable upstream originals are not available, so the project does not claim a from-original-source rebuild. See [AUDIT-PLAN.md](AUDIT-PLAN.md) for item-level evidence and [CHANGELOG.md](CHANGELOG.md) for the full release record.

### 1.26 highlights

- Boss HP telemetry can no longer award an early Back Alley win; only the bosses' actual terminal destroy signals can close their canonical lives.
- JSON account creation is recoverable across journal, save, and account-publication failures, with verified archive backup and staged restore tooling.
- Every release now exercises type checks, debt budgets, regression tests, coverage thresholds, Chromium/axe acceptance tests, strict client verification, repeat builds, dependency audit, container smoke, and Windows/macOS launcher smoke.
- Structured encounter and persistence logs redact credentials and identifiers and sample high-volume debug events.

## Administration

The optional admin console is loopback-only and requires a shared secret:

```sh
set ADMIN_CONTROL_SECRET=replace-with-a-long-random-secret
npm run admin
```

On PowerShell use `$env:ADMIN_CONTROL_SECRET='...'`; on macOS/Linux use `export ADMIN_CONTROL_SECRET='...'`. The console refuses to start without a secret. Keep it on loopback; use an authenticated tunnel if remote access is required. Destructive actions require confirmation and runtime settings are temporary.

## Development and verification

```sh
npm run build
npm run verify:client-patches
npm run lint --prefix src/server
npm run test:coverage --prefix src/server
npm run test:browser --prefix src/server
npm run test:regression --prefix src/server
```

Client verification and ordinary builds are read-only. Release CI provisions pinned FFDec 26.2.1 and treats unavailable verification tools, changed artifact hashes, expired patch exceptions, source mutation, or a second-build difference as failures. Regression tests have per-test timeouts, JUnit output, and optional sharding through `TEST_SHARD_TOTAL` and `TEST_SHARD_INDEX`.

## Documentation

Start with the tracked [documentation index](docs/README.md):

- [Hosting, backup, restore, upgrades, and rollback](docs/HOSTING.md)
- [Security policy](docs/SECURITY.md)
- [Complete project audit](AUDIT.md)
- [Audit remediation plan](AUDIT-PLAN.md)
- [Changelog](CHANGELOG.md)

The community [How to play wiki](https://github.com/theminesastudios/dungeon-blitz-r/wiki/How-to-play-Dungeon-Blitz%3F) remains available for additional screenshots and walkthroughs.

## Disclaimer

Dungeon Blitz: R is a fan-made revival. Dungeon Blitz and all original assets, trademarks, artwork, audio, characters, and intellectual property belong to their respective owners. This repository licenses only original code and modifications created by The Minesa Studios and project contributors.
