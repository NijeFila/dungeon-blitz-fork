# Dungeon Blitz R — Complete Project Audit

Audit date: 2026-08-16

Audited revision: `db88c864cdade1eb42f41cc26da7917342d2ca3b` (`main`)

Project version: `1.24.11`

Audit mode: read-only source, configuration, dependency, and automated-test review

## Executive summary

Dungeon Blitz R is a substantial preservation/reimplementation project with several unusually strong qualities: strict TypeScript, broad protocol/gameplay regression coverage, explicit dungeon-completion contracts, rate-limited authentication routes, scrypt password verifiers, atomic character-save replacement, and defensive admin authorization. Its main risk is not a lack of effort or tests. It is that release, binary-patch, persistence, and runtime-control mechanisms have grown faster than the controls around them.

The project should **not publish another release from the current revision without an explicit exception**. The complete regression suite is red for `JC_Mission2Hard`, client-patch verification reports five patches lost since baseline, 41 more patch checks cannot run without FFDec, and the release workflow creates a GitHub release on every root version change without running any of those gates.

The two most consequential design risks are:

1. `Accounts.json` is the default authority but account updates use unsynchronized read/modify/direct-write operations. A crash or concurrent update can truncate the file, duplicate an ID, or lose accounts. Character saves already demonstrate the safer queue + temporary-file + rename pattern.
2. The repository deliberately tracks a runtime bootstrap snapshot containing 14 email identifiers, three password verifier records, and a specific user's character save. This is broader than the documented synthetic test fixture and makes runtime data part of source control.

No P0 issue was confirmed. There are eight P1 release/data/product-integrity issues, followed by focused P2 and P3 work. The recommended sequence is: freeze automated release creation, make account persistence recoverable, replace tracked runtime data with a synthetic migration-safe bootstrap, restore deterministic client-patch verification, fix the red dungeon contract, establish a canonical encounter lifecycle and scope disposal owner, repair the container path, then address admin UI/launcher and handler architecture.

## Overall assessment

| Area | Rating | Summary |
| --- | --- | --- |
| Product/gameplay correctness | At risk | Broad regression suite, but one confirmed hard-mode completion failure and unverified/lost SWF patches. |
| Security/privacy | At risk | Good password/admin controls; tracked account snapshot, root container, exposed debug path, and stale policy/docs remain. |
| Data integrity | High risk | Character saves are protected; account authority is not atomic, serialized, or recoverable. |
| Architecture/maintainability | High debt | Very large stateful handlers, pervasive `any` and console logging, binary patch pipeline, mutable global state. |
| Test quality | Mixed | 97 regression programs and strict type-checking; no coverage/lint/browser suite, slow serial runner, current suite red. |
| Release engineering | High risk | Release automation has no build/test/patch gate and is triggered by every required version bump. |
| Operations | At risk | Health endpoint and container exist; no healthcheck, non-root user, backup/restore runbook, or production observability contract. |
| Web/admin UX | At risk | Semantic shell and escaping are good; live rerenders break focus/drafts, contrast is poor, destructive actions are under-guarded. |
| Documentation | Stale | README improved, but hosting/security guides and launcher promises do not match the current project. |
| SEO/AEO/schema | Not applicable | The reviewed pages are local/operational surfaces rather than public indexable content. |

## Scope and method

Reviewed surfaces:

- root and server package manifests/locks, scripts, configuration, launchers, container, GitHub workflows, and docs;
- TypeScript server architecture, TCP/HTTP entry points, authentication, Discord/admin integrations, JSON and Mongo persistence;
- dungeon completion and combat authority paths, regression harnesses, client binary-patch inventory and verifier;
- local Flash host and browser admin console for UX, accessibility, offline reliability, and browser behavior;
- tracked runtime data and repository hygiene.

Evidence collected:

- 827 tracked files; 364 server TypeScript files; 97 regression programs.
- Largest handlers: `CombatHandler.ts` 6,982 lines, `LevelHandler.ts` 6,708, `EntityHandler.ts` 4,461, `MissionHandler.ts` 4,215.
- 1,305 occurrences of `any` and 1,127 `console.*` calls in non-test server TypeScript.
- Strict TypeScript is enabled; `npm run typecheck` passed.
- Full `npm run test:regression`: 96/97 passed; `dungeon_completion_open_issues_regression.ts` failed.
- Focused rerun reproduced `#571 JC_Mission2Hard: never became ready after its authored objectives`.
- `npm run verify:client-patches`: five new/lost patch failures; 41 unavailable checks because FFDec is absent.
- Root `npm audit`: zero advisories. Server `npm audit`: one high advisory in the development-only `nodemon -> minimatch -> brace-expansion` chain.
- Browser/UI review was source-backed. No authenticated live admin session, Flash runtime, Lighthouse, axe, RUM, or end-to-end browser automation was available.

## Priority definitions

- **P0** — active compromise, unrecoverable corruption, or total outage requiring immediate response.
- **P1** — blocks safe release or can cause material data/product integrity loss; address before the next normal release.
- **P2** — material reliability, security-hardening, accessibility, or maintainability issue; schedule next.
- **P3** — localized polish or preventive improvement.

## P0 findings

No P0 finding was confirmed in the source-only audit.

## P1 findings

### AUTH-01 — Hybrid client/server boss authority has no single lifecycle owner

**Evidence:** `src/server/core/BossAuthority.ts:9-16` explicitly states that every client spawns a boss copy which the server converges; damage is retained per client token at `:26-28`. `CombatHandler.ts:1094-1183` treats some client messages as damage deltas and distinguishes authoritative deaths from derived health pools. `CombatHandler.ts:6434-6515` aggregates reported damage, defers death when an estimated pool is exhausted, and later promotes it to a verified boss death. `src/server/core/AILogic.ts:42,308-310` leaves relevant hostile AI/client-spawned actors client-driven unless the server-authority environment flag is enabled. The central registry is `Map<string, Map<number, any>>` at `GlobalState.ts:195-208`.

**Impact:** HP, phases, death visuals, rewards, and completion are reconstructed from canonical estimates plus local visual copies. This is the common architectural source of recurring 1-HP, duplicate-marker, premature-completion, revive, and stale-copy defects. Adding per-dungeon exceptions can repair symptoms without making the encounter coherent.

**Remediation:** Introduce one canonical server-owned encounter/entity lifecycle per level scope. Treat client entities as visual proxies mapped to canonical IDs and client packets as typed intents/observations. Make phase, terminal death, rewards, and dungeon completion consume the same canonical event. Migrate per dungeon with shadow comparison and a rollback feature flag.

**Acceptance criteria:**

- Exactly one HP/phase/death/reward state exists for each canonical boss and scope.
- Two clients with separate proxy IDs cannot double-count damage or emit duplicate rewards.
- A phase/revive test cannot complete while any required canonical entity is non-terminal.
- Shadow telemetry matches current legitimate encounters before authority is enabled per dungeon.
- Rollback selects the old hybrid implementation without changing save/protocol formats.

### DATA-01 — JSON account authority is non-atomic and unsynchronized

**Evidence:** Character saves use a per-path queue, unique temporary file, retrying rename, and cleanup in `src/server/database/JsonAdapter.ts:10-13`, `:165-205`, and `:661-677`. Account operations independently read the full array and write directly to `Accounts.json` at `:442-463`, `:484-515`, `:532-551`, and `:567-583`. Invalid account JSON is handled by returning an empty array at `:336-376`.

**Impact:** Concurrent creates can calculate the same next ID and overwrite one another. Any concurrent account mutation can lose another update. A crash during direct write can leave truncated JSON; a subsequent operation may treat it as an empty account set and replace it. Account creation also spans `Accounts.json` and a save file without a recoverable transaction.

**Root cause:** The safer character persistence mechanism was not generalized to the account authority or multi-file account creation.

**Remediation:** Introduce one serialized account mutation queue; write a uniquely named temporary file, flush it, and atomically replace the authority; preserve and validate a last-known-good backup; fail closed on invalid JSON; add a recoverable journal/transaction for account + initial save creation. Keep Mongo behavior separate.

**Acceptance criteria:**

- 100 concurrent creates/updates produce unique IDs and no lost records.
- Injected failure before/during/after replacement always leaves either old or new valid JSON.
- Invalid JSON prevents writes and emits an actionable recovery error.
- Account + initial-save creation recovers deterministically after interruption.
- Existing local data is backed up and migrated; rollback restores the backup.

### DATA-02 — Tracked bootstrap includes runtime account and character data

**Evidence:** `src/server/data/Accounts.json` is tracked and contains 14 email identifiers and three scrypt verifier records. `src/server/data/saves/9.json` is explicitly unignored by `.gitignore:6-7` and contains the `RendzerA` character. `seedTestAccount.ts:25,289-313` only owns `test@theminesa.studio`; therefore the full tracked account array is not produced by that seeder. `README.md:122-124` says the matching save remains untracked, contradicting the ignore exception. Both files entered history in commit `75a1bf3`.

**Impact:** Every clone receives stable account identifiers, verifier material, and user-specific game state. `1@gmail.com` was explicitly identified as fake, but the provenance/reuse of the other identifiers cannot be verified. Even if every address is synthetic, source control is acting as runtime database authority and ordinary local registrations can dirty or leak into commits.

**Remediation:** Replace the tracked runtime snapshot with a minimal, explicitly synthetic first-run fixture or generate it on demand. Untrack mutable authority and saves. Provide a one-time migration that backs up existing local files before moving/copying them to an ignored runtime directory. Rotate any verifier whose password may have been reused outside local testing; purge historical identifiers if their owners request it.

**Acceptance criteria:**

- A fresh clone can start and authenticate the intended test account without shipping a runtime snapshot.
- Registering/resetting/playing never modifies a tracked file.
- No non-synthetic identifier or user character exists in the repository tip.
- Migration preserves current local accounts and `RendzerA`; rollback instructions are tested.

### REL-01 — GitHub releases are created without quality gates

**Evidence:** `.github/workflows/release-on-package-update.yml:1-25` triggers on every push to `main` that changes root `package.json`, reads the version, and immediately calls `softprops/action-gh-release`. It does not install, type-check, build, run regression tests, verify patches, inspect a clean tree, or validate artifacts. Project instructions require a version bump for every committed project change, including docs.

**Impact:** Routine maintenance automatically publishes a release, even when the known regression suite and client patch gate are red. Tags can communicate a level of integrity that was never checked, and documentation-only work creates releases.

**Remediation:** Split CI and release. Require lockfile install, type-check, deterministic client verification, regression suite, clean-tree assertion, and artifact checksum validation before a release job. Trigger releases explicitly (signed/tagged workflow dispatch or release PR), not merely because any version field changed.

**Acceptance criteria:**

- A deliberately failing regression or patch verifier blocks tag/release creation.
- Docs-only commits do not publish a release unless explicitly requested.
- Release artifacts are built once in CI, checksummed, and attached from the tested output.
- Workflow permissions are least-privilege per job and concurrent releases are serialized.

### CLIENT-01 — Client patch state is not reproducibly verifiable

**Evidence:** `src/server/tools/verifyClientPatches.js:6-12` describes verification as the guard against silently dropping binary patches. The audit run checked 180 scripts, reported five patches lost since baseline, and skipped 41 because FFDec was unavailable. Lost checks included plague-battalion overrides, Dark Chi AoE scaling, Shadow Legion equipped skills, Shadowstalker Miasma, and the Legends Inn portal. The verifier itself changed the tracked client revision because `patch-dungeonblitz-pet-fetches-loot.ts:639` calls `syncClientRev` on an already-patched `--verify` path; that audit-created change was reverted.

**Impact:** The source revision cannot prove which behavior is present in the shipped SWF/SWZ files. A nominally read-only check mutates tracked output, and unavailable tooling is treated as a skip rather than an enforceable release prerequisite.

**Remediation:** Make every `--verify` path side-effect free; vendor or provision a pinned FFDec version in CI; distinguish expected idempotent states from missing patches; create a manifest of input/output hashes and patch versions; rebuild client artifacts from immutable originals in an isolated directory.

**Acceptance criteria:**

- Verification exits zero with zero skipped checks in the release environment.
- Running verification twice leaves `git status --short` empty.
- Each shipped binary has a manifest linking source hash, patch sequence, tool versions, and final checksum.
- Removing one known patch makes exactly its check fail.

### TEST-01 — Current regression suite is red for hard Back Alley completion

**Evidence:** Full suite result was 96/97. `src/server/test/dungeon_completion_open_issues_regression.ts:122-125` failed for issue 571 / `JC_Mission2Hard`. Both `JC_Mission2` and hard mode require a room-boss clear signal in `src/server/data/dungeon_completion_conditions.json:91-92`, while the generic harness sends client completion and cutscene events but no room-boss-clear event at `dungeon_completion_open_issues_regression.ts:94-120`.

**Impact:** Either the hard-mode runtime contract is incomplete or the regression harness no longer models the authored protocol. In either case the suite cannot certify dungeon completion behavior, and this is adjacent to the recently repaired normal-mode boss lifecycle.

**Remediation:** Trace the real client event sequence and make the condition/harness agree. Do not remove the gate merely to green the test. Add a focused normal/hard Back Alley sequence proving no early rank plate, both bosses visibly die, the required room-clear/cutscene order is respected, and completion occurs once.

**Acceptance criteria:**

- Focused normal and hard integration tests reproduce the observed client/server packet order.
- Neither mode completes before both canonical bosses are dead and the authored gate is satisfied.
- Both modes complete exactly once after the gate.
- Full regression suite reports 97/97 (or its new total) with no failures.

### STATE-01 — Finished dungeon scopes are not comprehensively disposed

**Evidence:** `GlobalState.ts:144-208` owns many scope-indexed maps/sets for entities, completion, quest, cutscene, reward/contribution, aliases, and tombstones. `DungeonCompletionSystem.ts:207-242` clears only a subset when the final participant leaves. `EntityHandler.ts:4297-4322` removes local/player-owned entities but retains a level scope while server-owned canonical entities remain. Comprehensive cleanup exists at `EntityHandler.ts:1373-1411`, but is used when a later fresh run enters. Instance tokens make abandoned scopes unique (`LevelScope.ts:10-35`, `LevelHandler.ts:4665-4683`).

**Impact:** A persistent multiplayer process can retain completed/abandoned instance state indefinitely, increasing heap/cardinality and risking stale aliases, rewards, or encounter data influencing later work.

**Remediation:** Create a single idempotent `disposeLevelScope` owner which cancels timers and clears every registered subsystem after a documented transfer/reconnect grace period. Require subsystems to register cleanup rather than duplicating map lists.

**Acceptance criteria:** A soak test completing thousands of unique instances returns all scope-indexed cardinalities and heap trend to baseline; timers are cancelled; reconnect works within grace; disposal twice is safe.

### OPS-03 — Documented container build and runtime paths are internally inconsistent

**Evidence:** `docs/HOSTING.md:18-23` changes into `Container` and builds with `.`. `Container/Containerfile:3-7` then copies repo-root `src/server`, which is outside that build context. The image installs under `/opt/games/dungeon-blitz-r` (`Containerfile:20-27`), but the run command mounts host `$HOME/Games` over `/opt/games` (`HOSTING.md:30-34`), masking the image application. The runtime client/data copy comes from build context rather than the builder's patched output (`Containerfile:22-27`).

**Impact:** A clean host cannot reliably build using the documented command; a host mount can hide the built `dist`/dependencies; and the served client may differ from the binary verified during the builder stage.

**Remediation:** Build from repository root with `-f Container/Containerfile`; copy all built runtime artifacts from the builder stage; mount only explicit persistent data directories; add a clean-host smoke test.

**Acceptance criteria:** A clean machine builds from the documented command; the container runs without source/node_modules/dist host mounts; client checksums match the verified artifact; health and game socket pass; only documented data paths are writable.

## P2 findings

### ARCH-01 — Core handlers are monolithic and coupled through mutable global state

`CombatHandler.ts` and `LevelHandler.ts` exceed 6,200 and 5,900 lines; `EntityHandler.ts` and `MissionHandler.ts` exceed 3,800. They coordinate through `GlobalState`, dynamic entity shapes, static methods, and shared maps. This makes client/server authority bugs hard to isolate and encourages narrow special cases inside already complex flows.

Remediate by extracting cohesive services behind explicit interfaces: combat-report normalization, boss lifecycle, dungeon completion orchestration, room state, transfer/session persistence, and reward emission. Start with characterization tests and dependency injection; do not rewrite the protocol boundary wholesale.

Acceptance: extracted modules have bounded responsibilities, no direct unrelated `GlobalState` access, focused unit tests, and unchanged packet fixtures.

### ARCH-02 — Type and logging discipline does not scale with the protocol surface

There are 1,305 `any` occurrences and 1,127 `console.*` calls in non-test TypeScript despite strict mode. Dynamic wire entities justify some boundary casting, but uncontained `any` weakens compiler guarantees throughout authority logic. Console output is voluminous, inconsistent, and can include account identifiers.

Remediate with validated packet DTOs and narrow `unknown -> parsed type` adapters at boundaries; introduce a structured logger with levels, event IDs, redaction, context, and sampling. Migrate touched code rather than attempting a flag-day conversion.

### TEST-02 — Test infrastructure lacks coverage, isolation, timeout, and browser gates

`runRegressionTests.js:1-35` enumerates standalone programs and executes them serially with `spawnSync`. It runs every test after failure, but has no per-test timeout, shard support, coverage, flaky-test tracking, or machine-readable report. Package scripts define no linter. Admin tests cover snapshot/settings data, not browser focus, drafts, errors, confirmations, or responsive behavior.

Acceptance: CI produces JUnit/coverage artifacts, enforces timeouts, can shard deterministic tests, has a lint/format gate, and includes browser tests for the admin console.

### OPS-01 — Backup, restore, migration, and recovery are undocumented

`docs/HOSTING.md:1-48` is a minimal Podman/tmux walkthrough. It does not define persistent volume ownership, backups, restore drills, Mongo/JSON migration, secret management, TLS/reverse proxy, log retention, monitoring, or upgrade/rollback. This magnifies DATA-01/02.

Acceptance: a clean host can deploy from documented commands; a scheduled backup and restore drill recovers accounts/saves; an upgrade can roll back without data loss; secrets are supplied out of band.

### OPS-02 — Container hardening and health model are incomplete

`Container/Containerfile:9-34` runs as the image default user (root), declares UDP ports although the reviewed services are TCP, and has no `HEALTHCHECK`. `/healthz` only returns `ok` (`StaticServer.ts:1060-1065`) and does not report readiness of game socket, persistence, or dependencies. `/debug-path` exposes the server content path at `StaticServer.ts:1067-1069`.

Acceptance: non-root runtime, read-only root filesystem where feasible, explicit writable volume, accurate ports, container health/readiness checks, production-disabled debug route, and tested graceful shutdown.

### DEP-01 — Dependency governance is partial

Server audit reports a high `brace-expansion` advisory through development-only `nodemon -> minimatch`; it is not a demonstrated production path but should be updated. `.github/dependabot.yml:6-11` watches only `/src/server`, leaving the root package unmonitored.

Acceptance: both manifests are monitored, audit policy distinguishes prod/dev severity, the advisory is resolved or documented with expiry, and lockfile updates run the same release gates.

### WEB-01 — Live admin snapshots destroy focus and selection semantics

`AdminControlApi.ts:163-174` streams every second. `admin-panel/app.js:14-18` replaces major subtrees using `innerHTML`; selected state is visual-only in `styles.css:3`. Focused keyboard controls are detached and assistive technology cannot identify selection.

Acceptance: keyed stable nodes preserve focus for at least three SSE ticks and after activation; selection is expressed with native/ARIA state; removals move focus predictably.

### WEB-02 — Server snapshots can overwrite unsaved admin settings

`admin-panel/app.js:19-21,25,28` copies server settings into controls on each stream tick under a narrow active-element exception. Moving focus toward Save can restore old values before the request reads the DOM.

Acceptance: a draft model and dirty flag preserve exact edits through multiple snapshots, blur, save failure, and retry; only successful save/reset/discard clears the draft.

### WEB-03 — Destructive admin actions need confirmation and in-flight guards

Kill-room and reset execute immediately (`admin-panel/app.js:23,26`; controls at `index.html:70,72,79`), while only kick is confirmed. Buttons remain active during requests.

Acceptance: every destructive action names scope/target in an accessible confirmation; one gesture sends one request; controls show pending state and re-enable on success/error; focus returns to the invoker.

### WEB-04 — Admin contrast and type size fail operational readability

Muted combinations in `admin-panel/styles.css:3` compute to approximately 2.44:1, 2.92:1, and 3.74:1, often at 7–12px. WCAG 2.2 normal-text guidance is 4.5:1.

Acceptance: automated contrast checks pass all states, operational copy has a practical rem-based floor, and 200% zoom retains all content/function. Reference: [W3C Understanding Success Criterion 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

### LAUNCH-01 — Windows launcher contradicts the documented one-step flow

`README.md:67-69` says the launcher opens the game. `dev-windows.bat:226` only invokes `runDevDiscordWithUrls.js`, whose `:60-80` prints URLs; `dev-mac.command:145-175` does implement readiness and opening.

Acceptance: Windows waits for `/healthz`, opens the configured FlashBrowser once at the actual port, and gives an actionable manual fallback; alternatively, documentation explicitly says it only prints URLs.

### LAUNCH-02 — Dependency install fast paths can remain stale after updates

Windows checks only for `concurrently.cmd` and `nodemon.cmd` (`dev-windows.bat:112-145`); macOS checks whether `node_modules` exists (`dev-mac.command:212-228`). Neither proves lockfiles were reconciled after a pull.

Acceptance: a lockfile hash change forces deterministic install on both OSes; unchanged hashes may fast-path; install failures state the command and recovery.

### DOC-01 — Security, hosting, and local documentation are stale or hidden

`docs/SECURITY.md:3-12` lists `0.9.x` twice with conflicting support states and only a Discord ticket route. `docs/HOSTING.md` clones an old organization URL and omits production concerns. `README.md:126-128` points only to the Wiki and does not index tracked guides or explain the admin command/secret.

Acceptance: current supported versions, private reporting channel, response expectations, hosting/backup/rollback, admin startup/security, and every tracked guide are linked from a local docs index.

## P3 findings

### WEB-05 — Announcement input is cleared after failed send

`action()` catches failures and returns normally (`admin-panel/app.js:23`); submit clears the input unconditionally at `:27`. Return/throw success explicitly and retain/focus the draft on failure.

### WEB-06 — Flash fallback points at retired Adobe downloads

`src/client/content/localhost/index.html:74-85` links Adobe's removed debug downloads while `README.md:55-58` identifies FlashBrowser as the supported path. Replace the link and include a copyable local URL.

### WEB-07 — Navigation state and OAuth result documents are incomplete

Overview is permanently marked active (`admin-panel/index.html:23-26`) with no hash state. OAuth outcomes send bare fragments at `StaticServer.ts:894-901,944-968` despite a complete renderer at `:424-462`. Synchronize active/`aria-current` state and route all outcomes through the full document renderer.

### WEB-08 — Local admin loads a third-party font

`admin-panel/styles.css:1` imports Google Fonts in an otherwise offline workflow. Use a system stack or self-hosted WOFF2 with `font-display: swap`.

### WEB-09 — Small browser hardening gaps

The Flash host lacks viewport metadata (`localhost/index.html:3-5`); many admin targets are 32–40px; password-reset email disables autocomplete (`StaticServer.ts:413-416`). Add viewport, responsive touch sizing, and `autocomplete="email"`.

## Positive controls

- Passwords use scrypt with random 16-byte salts, recorded parameters, and timing-safe comparison (`PasswordAuth.ts:160-209`).
- Auth routes use socket-address rate limits and intentionally avoid spoofable forwarded headers (`StaticServer.ts:101-129`).
- Admin APIs fail closed without configured secrets, use bearer tokens, timing-safe comparison, and failed-auth rate limiting (`DiscordMaintenanceApi.ts:97-150`).
- Admin proxy binds loopback, refuses to start without a secret, sanitizes proxied paths, and never sends the secret to browser JavaScript (`adminPanelServer.js:12-21,30-77`).
- Character saves are queued and atomically replaced with retry/cleanup (`JsonAdapter.ts:147-205,661-677`).
- Mongo support provides an alternative persistence authority and migration tooling.
- TypeScript strict mode is enabled and current type-check passes.
- Regression runner continues after failures, avoiding the former “first red test hides later failures” behavior.
- Admin HTML has language/viewport/title, semantic controls/labels, an ARIA live toast, reduced-motion rules, responsive layouts, and escaping of dynamic user strings.
- Static assets use revalidation/keep-alive rather than unconditional redownloads.
- `.env`, Discord token/link files, portraits, logs, and most saves are ignored.

## Rejected or downgraded candidates

- **Admin `innerHTML` XSS:** rejected. Dynamic player/level strings are escaped before interpolation; remaining values are numeric/static.
- **Missing admin authentication:** rejected. The browser talks to a loopback proxy which injects a server-held secret; upstream APIs validate it.
- **Plaintext password storage:** rejected. Current verifier records are scrypt hashes, not plaintext.
- **Production password reset open by default:** rejected. Manual reset defaults off under `NODE_ENV=production`; Discord delivery has separate controls.
- **SEO/schema defects:** not applicable to local/operational surfaces. If these endpoints are public, `X-Robots-Tag: noindex, nofollow` is reasonable hardening; rich-result schema is not.
- **Production dependency compromise from `brace-expansion`:** downgraded. The observed chain is development-only; the advisory still belongs in dependency hygiene.
- **SWF client accessibility:** unresolved, not claimed. Browser shell review cannot assess accessibility inside the Flash binary.

## Technical-debt register

| Debt | Principal now | Ongoing interest | Trigger for action | Dependencies / rollback |
| --- | --- | --- | --- | --- |
| Monolithic handlers/global state | High extraction cost | Every boss/protocol fix touches broad state | Before more cross-dungeon authority features | Characterization packet tests; incremental adapters; revert module-by-module |
| Imperative binary patch chain | High | Lost patches, unavailable tooling, opaque artifacts | Before next client release | Pinned FFDec, immutable originals, checksums; retain last known-good binaries |
| JSON account authority | Medium | Corruption/lost-update exposure | Immediate | Backup/migration; atomic writer; rollback from versioned backup |
| Tracked runtime data | Medium migration/social cost | Privacy and merge conflicts | Immediate after backups | Synthetic fixture; migration tool; preserve local ignored copy |
| Console/`any` protocol model | High | Weak diagnostics/compiler guarantees | Whenever a handler is touched | DTO validators/logger; compatibility adapters |
| Standalone serial regressions | Medium | ~5 minute feedback, no coverage | Before CI gating becomes mandatory | JUnit/coverage/timeout wrapper; retain direct test invocation |
| Stale operations docs | Low | Operator errors and unrecoverable upgrades | Before public hosting guidance | Validate on clean host; version docs with release |

## Coverage gaps and limitations

- The Flash/SWF internals were not interactively exercised; client patch scripts and hashes were inspected instead.
- No live multiplayer load, packet fuzzing, authenticated admin browser, real Discord OAuth/IPC, Mongo replica, Windows launcher, macOS launcher, or container deployment was executed.
- No Lighthouse/axe/RUM measurement was performed. Core Web Vitals are not meaningful for the Flash gameplay surface.
- The specialist defensive security lane was blocked twice by the environment's safety filter. A manual source/config review covered auth, secrets, admin, persistence, dependencies, and container controls, but no active security testing was attempted. Formal schema output therefore contains no independently validated exploit findings; operational security risks remain in this report.
- The regression suite is slow; the full result and focused failure were captured during this audit, but it should be rerun after remediation rather than interpreted as proof for untouched external integrations.

## Decision

**Release posture: hold.** Resume ordinary releases after DATA-01, REL-01, CLIENT-01, TEST-01, and OPS-03 have passing acceptance evidence; DATA-02 may ship in the same migration release if existing local users have a tested preservation path. AUTH-01 and STATE-01 should begin behind compatibility flags and observability rather than a risky flag-day rewrite. The detailed execution order is in [AUDIT-PLAN.md](AUDIT-PLAN.md).
