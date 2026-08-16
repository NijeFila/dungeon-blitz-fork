# Defensive findings detail

## DATA-01 — Account authority integrity

Character writes use a queue and atomic rename (`JsonAdapter.ts:10-13,165-205,661-677`); account link/create/reset operations use independent read/modify/direct-write flows (`:442-463,484-515,532-551,567-583`). Invalid JSON returns an empty account array (`:336-376`). These facts establish crash/concurrency risk without active fault injection. Remediation and acceptance criteria are in the main audit.

## DATA-02 — Tracked runtime data

Both `src/server/data/Accounts.json` and `src/server/data/saves/9.json` are tracked. The account file contains 14 identifiers and three scrypt verifier records; the save is a developed character and is explicitly unignored by `.gitignore:6-7`. The standard seeder only owns one different synthetic identity (`seedTestAccount.ts:25,289-313`). The review does not assert that the remaining identifiers belong to real people, only that provenance/reuse is unknown and the snapshot is broader than the documented fixture.

## AUTH-01 — Client trust in encounter lifecycle

`BossAuthority.ts:9-16` documents a client-copy convergence model. `CombatHandler.ts:1094-1183,6434-6515` uses reported damage and derived pools before committing terminal death. `AILogic.ts:42,308-310` gates broader server-hostile AI. This is an architectural trust and correctness risk; no malicious packet reproduction was attempted.

## OPS-02 — Runtime hardening

`Container/Containerfile:9-34` defines no non-root `USER` or `HEALTHCHECK`. `StaticServer.ts:1060-1069` exposes a process-only health response plus `/debug-path`. The admin proxy itself is loopback-bound and fails closed, so it was not reported as unauthenticated public admin access.

## DEP-01 — Dependency advisory

The server lock contains the high-severity `brace-expansion` advisory through `nodemon -> minimatch`, but the audited path is development-only and `npm audit --omit=dev` was reported clean. It is dependency governance debt, not a claimed production exploit.

## Rejected candidates

- Plaintext passwords: current records are scrypt verifier material, not plaintext.
- Missing admin authentication: rejected; proxy retains a secret and upstream validates it.
- Spoofable auth rate-limit key: rejected; implementation intentionally keys socket address rather than `X-Forwarded-For`.
- Production manual password reset enabled by default: rejected; default is non-production only.
- Admin `innerHTML` injection: rejected for observed dynamic fields because strings are escaped.

## Validation limitation

Formal exploit validation was not available. Accordingly, this directory contains no confirmed exploit record and no reproduction payloads. These risks should be validated through authorized concurrency, crash-injection, deployment, and protocol tests during remediation.
