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

- Back Alley Deals (`JC_Mission2` normal and hard): Mortis Golem and Seelie Ravager now enter permanent terminal state independently of the later room-clear signal. Healing/revival cannot undo a verified death, while victory still requires both bosses, the authored room-clear signal, and the completion cinematic.
- The Capstone (`AC_Mission6`): completion follows the encounter's real multi-phase eye entities instead of a persistent marker.
- The Prodigal Son (`JC_Mission3`): Prince Friedrich Hocke recovers his authored wake-up trigger if a room transition skips it, preventing the actor from remaining stuck.
- Mammoth Idols no longer route purchases to the retired payment page.

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
npm run test:regression --prefix src/server
```

Client verification is read-only. Release CI provisions a pinned FFDec build and treats unavailable verification tools as a failure. Regression tests have per-test timeouts, JUnit output, and optional sharding through `TEST_SHARD_TOTAL` and `TEST_SHARD_INDEX`.

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
