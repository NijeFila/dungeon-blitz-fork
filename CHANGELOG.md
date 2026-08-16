# Changelog

All notable user-facing and operator-facing changes are documented here. Versions follow semantic versioning.

## [Unreleased]

No unreleased changes.

## [1.25.1] - 2026-08-16

### Documentation

- Expanded the abbreviated 1.25.0 notes into a detailed record of the gameplay, persistence, release, operations, admin, launcher, client-verification, testing, and migration changes.
- Added an explicit audit implementation status to the README and audit plan so completed remediations are not confused with the remaining architectural program.
- Clarified the local verification limits: 100 regression programs passed, while FFDec-dependent client checks are enforced by CI rather than claimed as locally executed.

## [1.25.0] - 2026-08-16

Version 1.25.0 is the first implementation pass against the complete audit at revision `db88c86`. It fixes the audit's immediate release blockers and several P2/P3 operational and browser defects. It does **not** represent completion of every long-term architecture recommendation; see **Remaining audit work** below.

### Gameplay and dungeon lifecycle

- Corrected Back Alley Deals in both `JC_Mission2` and `JC_Mission2Hard`:
  - Mortis Golem and Seelie Ravager are tracked as two independent required bosses.
  - A verified terminal death is committed immediately instead of being deferred until the later room-clear signal.
  - Client healing reports cannot restore a terminal boss or make the server accept a resurrected proxy.
  - Client-reported damage may complete a derived server HP estimate only for the explicitly configured Back Alley bosses and only after player damage has been observed.
  - Terminal state is relayed to the client copies using zero HP and the dead entity state, preventing the low-HP respawn/heal loop.
  - Dungeon victory remains separate from individual death: both bosses, the authored room-boss-clear signal, and the post-objective cinematic are still required.
- Updated the generic completion scenario to model authored room-clear signals rather than weakening dungeon conditions to make tests pass.
- Rechecked the shared behavior against the authored boss catalog and the existing multipart, proxy, dual-boss, reward, cinematic, and re-entry scenarios.

### Account and save integrity

- Serialized all JSON account mutations through a process-wide queue keyed by the account authority path.
- Replaced direct `Accounts.json` writes with unique temporary files, file synchronization, atomic replacement, and cleanup.
- Added a validated last-known-good backup and recovery path; malformed primary and backup data now fail closed instead of silently becoming an empty account database.
- Validate account shape and uniqueness before commit, including duplicate user IDs, normalized email aliases, and Discord identities.
- Account creation writes the initial character save before publishing the account record, preventing an account from pointing at a missing initial save when the save write fails.
- Added concurrency and injected-failure coverage for parallel account creation, unique ID allocation, interrupted replacement, backup recovery, and invalid-data refusal.

### Synthetic single-player fixture and repository hygiene

- Removed mutable `src/server/data/Accounts.json` and the live save directory from source control.
- Added ignore rules for runtime accounts, backups, temporary account files, saves, logs, build output, and local regression artifacts.
- Added a minimal, explicitly synthetic first-run fixture containing only the fake `1@gmail.com` account and its `RendzerA` save.
- A fresh clone copies the fixture into ignored runtime storage only when no runtime authority exists. Existing local accounts and saves are never replaced.
- Registration, password reset, and gameplay no longer modify tracked runtime authority files.

### Scope lifecycle and shutdown

- Added one idempotent `disposeLevelScope` owner for completed or abandoned dungeon instances.
- Registered boss authority, room-boss state, Legends Inn, entity tombstone/fingerprint caches, quests, completion state, tutorial state, aliases, contributions, rewards, sessions, and cutscene state for scope cleanup.
- Dispose the scope after the final participant leaves instead of retaining unique instance state until a later run happens to clean it.
- Added an idempotency regression proving a second disposal is safe and all registered scope state is removed.
- Added stoppable AI timers, game-listener draining, active socket tracking, graceful socket close, and a bounded forced-close fallback.

### Health, container, and hosting

- `/healthz` now reports component readiness as JSON and returns `503` until persistence initialization and the game listener are ready.
- `/debug-path` is disabled unless explicitly enabled with `DEBUG_STATIC_SERVER=1` outside production.
- Updated the image to Node.js 24, removed inaccurate UDP declarations, installed runtime dependencies without lifecycle scripts, and copied built server/client artifacts from the builder stage.
- The runtime image now uses the unprivileged `node` user and defines a container health check.
- Documented read-only container operation with only `Accounts.json`, saves, and `/tmp` writable.
- Replaced the old source-masking host mount with explicit persistent-data mounts.
- Added backup, checksum, restore drill, Mongo guidance, upgrade, validation, and rollback procedures.
- Fixed the hosting initialization example so restarting a deployment cannot overwrite an existing account file with `[]`.

### Release and dependency governance

- Replaced automatic release creation on every package-version push with an explicit release workflow.
- Added a reusable quality workflow for pull requests, `main`, and manual releases.
- Release quality now installs locked dependencies on Node.js 24, provisions pinned FFDec 26.2.1, type-checks, builds, runs regression tests, verifies client patches without skips, audits production dependencies, and rejects tracked-source mutation.
- Runtime artifacts are built once, archived, checksummed, uploaded from the quality job, and attached to the release job.
- Release publication has job-scoped write permission and serialized concurrency.
- Added Dependabot coverage for both the root and server package manifests.
- Updated `brace-expansion` to 5.0.9, resolving the audited development dependency advisory; full and production-only npm audits reported zero vulnerabilities locally.

### Client patch verification

- Made verification paths read-only for the pet-fetch, Mystic rarity, and three Clear Bandits patch scripts by removing client revision synchronization from `--verify` flows.
- The verifier snapshots tracked client content and server data and fails if any verification command changes size or modification time.
- Added `VERIFY_CLIENT_PATCHES_REQUIRE_TOOLS=1` so release CI rejects unavailable required tools rather than recording a skip.
- Corrected the Legends Inn portal verifier to recognize the already-patched door and artwork symbols.
- Restored the Plague Battalion client artifact and corresponding power descriptions.
- Locally, 180 patch scripts were examined: 116 of 139 locally checkable patches were present, 23 remained in the pre-existing documented baseline, no new losses occurred, and 41 FFDec-dependent checks were unavailable. Release CI provisions FFDec and treats unavailable checks as failure.

### Regression platform

- Added a default three-minute timeout per regression program so a hung test cannot stall the entire workflow.
- Added deterministic sharding through `TEST_SHARD_TOTAL` and `TEST_SHARD_INDEX`.
- Added JUnit XML output through `JUNIT_OUTPUT` and upload it from CI even when a test fails.
- Added focused regressions for Back Alley normal/hard terminal death and completion ordering, JSON account fault recovery, central scope disposal, and admin UI source contracts.
- Final local evidence for the release was 100 regression programs with zero failures in 286.3 seconds, plus a successful TypeScript type-check.

### Admin console and browser surfaces

- Replaced one-second whole-list `innerHTML` replacement with stable keyed player and room nodes, preserving keyboard focus across live snapshots.
- Exposed player selection through `aria-pressed` and moved focus predictably if the focused player disappears.
- Added a settings draft/dirty model so incoming snapshots cannot overwrite unsaved edits; failed saves retain the draft.
- Added accessible confirmation dialogs for room kill, player kick, and runtime reset operations.
- Added in-flight request guards and disabled controls so double-clicks do not send duplicate mutations.
- Failed announcements retain and refocus their text instead of clearing it.
- Synchronized hash navigation, visual active state, and `aria-current`.
- Removed the Google Fonts request, switched to an offline system stack, raised operational text contrast and size, added visible focus, and increased common control targets.
- Routed all Discord link outcomes through full responsive HTML documents with status/error semantics.
- Added password-reset email autocomplete, a Flash host viewport, and a current FlashBrowser fallback instead of the retired Adobe download.

### Launcher behavior

- Both launchers hash their lockfiles and reconcile dependencies only when the installed marker no longer matches, preventing stale `node_modules` after updates without reinstalling every launch.
- Windows waits for component readiness and opens the configured FlashBrowser executable exactly once.
- Added common Windows installation-path discovery, `FLASH_BROWSER_EXECUTABLE`, `FLASH_BROWSER_AUTO_OPEN`, and an actionable manual fallback.
- Kept the macOS readiness/open flow and moved it onto the same lockfile-aware dependency helper.

### Documentation and security policy

- Added the complete audit, remediation plan, defensive security report, architecture evidence, changelog, and a tracked documentation index.
- Rewrote local setup, account/save behavior, test fixture, launcher recovery, admin secret, and verification instructions.
- Replaced the obsolete security-version table with a latest-release policy, private reporting options, response targets, and operator safeguards.
- Documented secret handling, firewall/reverse-proxy expectations, log sensitivity, data retention, backup, restore, and rollback.

### Compatibility and migration notes

- The server protocol and character-save format are unchanged.
- Existing ignored `src/server/data/Accounts.json` and `src/server/data/saves/` remain in place after updating.
- Do not copy the synthetic fixture over an existing runtime account database.
- Operators should back up account and save data before deploying and retain the previous versioned image for rollback.
- Windows users with a nonstandard FlashBrowser install should set `FLASH_BROWSER_EXECUTABLE`.

### Remaining audit work

The following audit programs remain open or only partially implemented:

- `AUTH-01`: Back Alley now has coherent terminal-death authority, but one canonical server-owned encounter lifecycle has not been migrated across every dungeon and boss phase.
- `CLIENT-01`: verification is read-only and CI provisions FFDec, but the 23-item known-failing baseline, immutable-original rebuild pipeline, patch manifest, and reproducible output hashes still need resolution.
- `ARCH-01`: the large combat, level, entity, and mission handlers have not yet been decomposed into bounded services.
- `ARCH-02`: typed packet boundaries and structured, redacted logging have not replaced the project-wide `any` and `console.*` footprint.
- `TEST-02`: timeouts, JUnit, sharding, and UI contracts exist, but coverage enforcement, lint/format gates, and real browser automation are not complete.
- `OPS-01`: backup/restore/rollback procedures are documented, but scheduled automation and a recorded clean-host restore drill are operational work.
- `STATE-01`: central disposal and focused idempotency coverage exist, but the requested thousands-of-instance heap soak has not yet been run.
