# Dungeon Blitz R — Audit Remediation Plan

This plan implements the findings in [AUDIT.md](AUDIT.md). It is ordered by risk reduction and dependency, not by convenience. Each work item has an owner role, evidence gate, rollout, and rollback expectation. No item is complete merely because code was merged.

## Operating rules

1. Freeze automatic releases until Phase 1 gates are active.
2. Preserve local users before changing tracked/runtime data paths.
3. Never “fix” a red dungeon test by weakening an authored gate without a captured client/server sequence.
4. Client patch verification must be read-only and hermetic before it becomes a mandatory release gate.
5. Canonical encounter authority is migrated dungeon-by-dungeon behind flags and telemetry; no flag-day rewrite.
6. Every committed project change follows `AGENTS.md`: semantic version bump and synchronized root/server manifests and lockfiles.
7. Each phase ends with a clean-tree check and an explicit rollback rehearsal.

## Phase 0 — Release hold and evidence preservation

Target: immediately, before another release.

### R0.1 Hold ungated releases (`REL-01`)

- Owner: release maintainer.
- Files: `.github/workflows/release-on-package-update.yml`, branch protection settings.
- Change: disable automatic release creation or require a protected environment while Phase 1 CI is built.
- Evidence: a test version change on a non-release branch cannot create a tag/release.
- Rollback: re-enable only after R1.1 passes on `main`.

### R0.2 Preserve the exact failing baseline (`TEST-01`, `CLIENT-01`)

- Owner: test/client tooling maintainer.
- Capture:
  - full regression output showing 96/97 and the `JC_Mission2Hard` assertion;
  - client verifier output naming five lost and 41 unavailable checks;
  - current SWF/SWZ SHA-256 checksums, FFDec absence/version, Node/npm/OS versions;
  - clean `git status --short` before and after each verifier.
- Evidence: artifacts are attached to an issue or CI run and contain no account/save data.
- Rollback: not applicable; this is evidence-only.

### R0.3 Back up mutable data (`DATA-01`, `DATA-02`)

- Owner: data/operations maintainer.
- Change: provide a read-only backup command for `Accounts.json`, all saves, portraits, Discord link state, and Mongo collections where enabled.
- Evidence: restore into a temporary data directory; authenticate and load representative characters.
- Rollback: keep timestamped backup untouched until two releases after migration.

## Phase 1 — Minimum safe release gate

Target: first patch release after audit. Do not bundle gameplay features.

### R1.1 Split CI from release (`REL-01`)

- Owner: release maintainer.
- Files: new `.github/workflows/ci.yml`; revised release workflow.
- Required jobs:
  1. checkout with pinned action SHAs or reviewed major tags;
  2. root and server `npm ci`;
  3. `npm run typecheck`;
  4. client-patch verification in a pinned tool image;
  5. regression suite with machine-readable results and timeout;
  6. production dependency audit policy;
  7. build once, assert clean worktree, hash artifacts;
  8. release job consumes exactly those artifacts.
- Acceptance:
  - deliberate type, regression, and patch failures each block release;
  - docs-only version changes do not create a release automatically;
  - concurrent release attempts serialize;
  - job permissions are read-only except release publishing.
- Rollout: required on PR and `main`; release via explicit tag/workflow dispatch.
- Rollback: protected manual release with recorded exception, artifact hashes, approver, and expiry—not the old unconditional workflow.

### R1.2 Make client verification hermetic and read-only (`CLIENT-01`)

- Owner: client tooling maintainer.
- Files: `src/server/tools/verifyClientPatches.js`, every verifier with side effects, patch manifest/tool provisioning.
- Work:
  - remove `syncClientRev` and all writes from `--verify` paths;
  - pin/provision FFDec for CI;
  - enumerate required patch scripts declaratively rather than substring discovery alone;
  - include every declared package patch script in the build graph or explicitly mark it retired;
  - record original hash, ordered patch IDs, tool versions, and output hash;
  - triage the 22 known-failing baseline entries with owner/rationale/expiry;
  - restore the five newly lost patches only after verifying intended behavior.
- Acceptance:
  - two verifier runs leave the tree byte-for-byte unchanged;
  - zero unavailable required checks in CI;
  - zero unexplained lost/recovered checks;
  - two clean builds produce identical hashes;
  - removing a fixture patch fails exactly its verifier.
- Rollout: release gate first in warning mode for one run, then required after green.
- Rollback: ship last signed, verified client binary and manifest; never rebuild ad hoc.

### R1.3 Repair the Back Alley normal/hard contract (`TEST-01`)

- Owner: encounter/completion maintainer.
- Files: focused tests, `DungeonCompletionSystem`, completion condition only if the captured protocol proves it.
- Work:
  - capture the actual packet/cutscene/room-clear order for normal and hard mode;
  - build a focused fixture with both canonical golems and their proxy IDs;
  - assert no rank plate before both terminal deaths;
  - model the required room-clear signal if the client actually emits it;
  - assert one completion after the authored cutscene gate.
- Acceptance: focused normal/hard tests pass, fail when either death/gate is removed, and the full suite is green.
- Rollout: no compatibility flag if this is a test-harness correction; per-level flag if runtime behavior changes.
- Rollback: restore previous condition/handler while keeping diagnostic capture; do not bypass the gate globally.

### R1.4 Repair container build contract (`OPS-03`)

- Owner: operations maintainer.
- Files: `Container/Containerfile`, `docs/HOSTING.md`, container smoke workflow.
- Work: root build context with `-f`; copy builder artifacts; mount only runtime data; verify client checksum.
- Acceptance: clean host builds and starts, `/healthz` and game socket pass, no host source tree is mounted, client hash equals CI artifact.
- Rollback: previous image tag plus compatible data backup.

## Phase 2 — Data integrity and privacy migration

Target: same patch release as Phase 1 only if migration is fully tested; otherwise the next patch.

### R2.1 Atomic serialized account mutations (`DATA-01`)

- Owner: persistence maintainer.
- Design:
  - one process-wide queue keyed by account authority path;
  - all mutations re-read inside the queue;
  - validate schema and uniqueness before commit;
  - write unique temp, flush file, atomic replace, then flush directory where supported;
  - maintain a validated last-known-good backup;
  - invalid primary is a hard error unless recovery succeeds;
  - journal account + initial save creation.
- Tests:
  - 100 concurrent creates; unique IDs and all records retained;
  - concurrent link/reset/create interleavings;
  - fault injection at each persistence step;
  - malformed primary with valid/invalid backup;
  - account/save transaction recovery.
- Metrics/logs: mutation duration, queue depth, recovery count, validation failure; identifiers redacted.
- Rollout: local JSON only; Mongo path unchanged. Back up before first write under new code.
- Rollback: stop writes, restore backup, deploy prior version; replay only validated journal entries.

### R2.2 Remove runtime authority from source control (`DATA-02`)

- Owner: persistence + release maintainers.
- Files: `.gitignore`, first-run/seeder tooling, README, migration script; untrack `Accounts.json` and save 9 after backup.
- Design:
  - minimal synthetic fixture or deterministic first-run generation;
  - explicit local test account creation with overridable password;
  - migrate existing tracked snapshot to ignored runtime path without overwrite;
  - preserve `1@gmail.com`/`RendzerA` for the current developer through migration, not a public runtime snapshot.
- Acceptance:
  - fresh clone starts and creates only documented synthetic identities;
  - registration/play/reset leave a clean Git tree;
  - repository scan rejects unexpected email/verifier patterns;
  - existing local user authenticates and loads the same character after migration;
  - rollback restores the backed-up local authority.
- Privacy response: if any non-synthetic identifier is confirmed, rotate/revoke reused credentials and consider history rewrite with contributor coordination.

## Phase 3 — Canonical encounter lifecycle

Target: incremental minor releases after Phase 1/2 stability.

### R3.1 Define encounter contracts (`AUTH-01`)

- Owner: server architecture/gameplay maintainer.
- New bounded concepts:
  - `CanonicalEncounterId` and `CanonicalEntityId`;
  - typed `ClientEntityProxy` mapping;
  - `DamageIntent`, `HealIntent`, `PhaseTransition`, `TerminalDeath`, `RewardGranted` events;
  - one encounter state machine per level scope;
  - idempotency/life nonce rules.
- Rule: dungeon completion and rewards subscribe to canonical terminal events; they do not independently infer death from proxy HP.
- Acceptance:
  - two-player duplicate proxies cannot double-apply damage or reward;
  - stale-life reports are rejected;
  - legal scripted healing/revival follows explicit state transitions;
  - terminal death is irreversible unless the encounter contract names a revive transition;
  - packet compatibility fixtures remain unchanged.

### R3.2 Shadow comparison and dungeon-by-dungeon rollout (`AUTH-01`)

- Start with normal/hard Back Alley because it exercises dual bosses, healing, and death cinematics.
- Run old decision and new canonical decision in parallel; new path emits diagnostics only.
- Compare HP, phase, death time, completion eligibility, and reward cardinality.
- Promote only after representative solo/party runs match; maintain per-level rollback flag.
- Expand to multipart/marker bosses such as Capstone and Prodigal Son before simple bosses.
- Exit criterion: no generic code depends on local proxy HP as final boss truth.

### R3.3 Central scope disposal (`STATE-01`)

- Owner: encounter/session maintainer.
- Build `disposeLevelScope(scope, reason)` with a registry of cleanup participants and cancellable timers.
- Define reconnect/transfer grace period and bounded tombstone retention.
- Acceptance:
  - thousands-of-runs soak returns map cardinality/heap trend to baseline;
  - no stale rewards, aliases, bosses, or quest state;
  - reconnect within grace succeeds;
  - disposal is idempotent and observable.
- Rollback: extend grace/disable eager disposal while retaining cardinality warnings.

## Phase 4 — Architecture, tests, shutdown, and observability

### R4.1 Extract handler services (`ARCH-01`)

- Sequence: persistence/session cleanup -> dungeon completion -> boss lifecycle -> combat normalization -> rewards.
- Introduce interfaces and adapters around existing static methods; preserve packet router contracts.
- Add module size/complexity budgets to prevent further growth.
- Acceptance: transport/client classes no longer own persistence/encounter cleanup; new modules avoid dynamic `require`; scope/entity registries use explicit types.
- Rollback: adapter delegates to old implementation per service.

### R4.2 Typed boundaries and structured logging (`ARCH-02`)

- Parse raw packets/environment/JSON as `unknown` into validated DTOs.
- Replace direct console calls incrementally with leveled structured events, redacted identifiers, correlation IDs, sampling, and sinks.
- Acceptance: authority modules contain no unbounded `any`; logs can answer one encounter timeline without exposing email/token/secret.

### R4.3 Test platform (`TEST-02`)

- Wrap scenario regressions in a runner with timeout, JUnit, duration, sharding, deterministic environment, and coverage.
- Create typed entity/session/packet builders.
- Establish branch coverage baseline for persistence, auth, transfers, combat authority, completion, and cleanup; prevent regression rather than inventing an arbitrary global percentage.
- Add lint/format checks and flaky-test quarantine policy with owner/expiry.
- Preserve scenario regressions even after unit-service extraction.

### R4.4 Graceful shutdown and operational telemetry (`OPS-02`)

- Drain HTTP/TCP listeners, stop accepting sessions, notify clients, await account/character queues, close dependencies, force-close after a configurable deadline.
- Export readiness for persistence + game listener, packet latency/error counts, queue depths, active scope cardinality, and save failures.
- Test SIGTERM with live socket and pending save.
- Disable `/debug-path` in production.

### R4.5 Container hardening (`OPS-02`)

- Add non-root user, accurate TCP-only exposes, healthcheck, explicit writable data volume, and read-only root filesystem where feasible.
- Pin supported Node line and exercise it in CI.
- Acceptance: container runs non-root and passes read-only filesystem smoke test with only declared data paths writable.

## Phase 5 — Admin UI, launcher, dependencies, and docs

These can proceed in parallel after Phase 1 as independent patch releases.

### R5.1 Stable admin rendering and drafts (`WEB-01`, `WEB-02`)

- Key player/room nodes; patch changed text/classes only.
- Preserve/restore focus on removal; expose selection via native/ARIA state.
- Maintain local draft + dirty flag; server snapshots update only clean fields.
- Browser tests: three SSE ticks, activation, player removal, blur/save, 500/retry.

### R5.2 Safe admin actions (`WEB-03`, `WEB-05`)

- Accessible confirmation naming target/scope for kick, kill-room, reset.
- Central pending state/idempotency; disable relevant controls.
- Return success/failure from action helper; retain failed announcements.
- Server-side request IDs are recommended for destructive action deduplication.

### R5.3 Admin accessibility/offline polish (`WEB-04`, `WEB-07`, `WEB-08`, `WEB-09`)

- AA contrast, practical type floor, zoom/touch checks.
- Hash navigation synchronized with `aria-current`.
- OAuth outcomes use complete semantic renderer.
- Remove Google Fonts dependency; add viewport; enable email autocomplete.
- Automated axe/contrast/browser overflow checks.

### R5.4 Launcher reliability (`LAUNCH-01`, `LAUNCH-02`, `WEB-06`)

- Windows readiness-gated FlashBrowser open with actionable manual fallback.
- Lockfile-hash reconciliation or deterministic `npm ci` on change for Windows/macOS.
- Replace retired Adobe fallback with supported FlashBrowser guidance.
- Smoke-test launchers on clean Windows/macOS runners where possible.
- Because launchers manipulate Git state, require explicit, recoverable behavior and tests around dirty trees.

### R5.5 Dependency governance (`DEP-01`)

- Dependabot for root and server.
- Resolve `brace-expansion` dev advisory or document time-bounded exception.
- Declare supported Node/npm versions and test them.
- Separate runtime and dev advisory thresholds.

### R5.6 Documentation recovery (`DOC-01`, `OPS-01`)

- README index linking all tracked docs and admin startup.
- Current security support table, private reporting route, acknowledgement/response expectations.
- Hosting: exact build context, environment reference, TLS/reverse proxy, firewall/ports, secrets, volumes, backup/restore, health, logs, upgrade/rollback.
- Generate or validate env docs against `config.ts` accesses.
- Test commands on a clean machine/container.

## Release checkpoints

### Checkpoint A — Gate restored

Required: R1.1–R1.4 green, clean tree, signed checksums, explicit release approval.

### Checkpoint B — Data safe

Required: R2.1–R2.2 concurrency/fault/migration/rollback evidence, backup drill complete.

### Checkpoint C — Encounter authority pilot

Required: Back Alley shadow comparison, solo/party parity, no duplicate rewards, per-level rollback flag.

### Checkpoint D — Long-running server readiness

Required: scope-disposal soak, graceful-shutdown test, readiness/metrics, clean container deployment.

## Issue template for each remediation

- Audit ID(s):
- User-visible symptom/risk:
- Exact files and owner:
- Intended invariant:
- Reproduction or baseline evidence:
- Tests to add before changing behavior:
- Migration/data impact:
- Telemetry and redaction:
- Rollout flag/stages:
- Rollback command/data source:
- Acceptance evidence links:
- Version bump level/result:

## Final audit closure criteria

The audit is closed only when:

- every P1 is remediated or explicitly risk-accepted by an owner with expiry;
- release CI is green and artifacts are reproducible;
- account persistence passes concurrency and crash-injection tests;
- runtime account/save state is no longer tracked;
- normal and hard Back Alley complete only after the correct two-boss lifecycle;
- canonical encounter pilot and scope-disposal soak meet thresholds;
- docs and rollback steps have been executed on a clean environment;
- remaining P2/P3 items are assigned and scheduled rather than silently dropped.
