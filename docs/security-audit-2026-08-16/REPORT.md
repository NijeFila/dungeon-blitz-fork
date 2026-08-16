# Defensive security review report

This source-only review is subordinate to the complete [project audit](../../AUDIT.md). It is not a penetration test.

## Formal vulnerability result

No exploit finding was promoted into the formal security schema. The specialist security agent was blocked twice by the environment safety filter, so independent exploit validation required by the security-audit workflow was unavailable. `findings.json` is therefore an empty, schema-valid array rather than overstating manual review as a verified exploit.

## Evidence-backed security and resilience risks

| Audit ID | Risk | Confidence | Treatment |
| --- | --- | --- | --- |
| DATA-01 | Direct, concurrent account-file writes can lose/corrupt authority | High | P1 data integrity remediation |
| DATA-02 | Repository contains a 14-account runtime snapshot, 3 verifiers, and user save | High on exposure; medium on real-person impact | P1 privacy/repository migration |
| AUTH-01 | Boss lifecycle is reconstructed from multiple client-local copies | High | P1 architectural trust reduction |
| REL-01 / CLIENT-01 | Release cannot prove source/test/client artifact integrity | High | P1 supply/release integrity |
| OPS-02 | Root container, shallow health, production debug path | High static confidence | P2 hardening |
| DEP-01 | High dev-only dependency advisory and incomplete monitoring | High | P2/P3 dependency hygiene |

See [FINDINGS-DETAIL.md](FINDINGS-DETAIL.md) for defensive evidence and rejected candidates.

## Positive controls

- Password verifier implementation: `src/server/auth/PasswordAuth.ts:160-209`.
- Auth rate limits: `src/server/core/StaticServer.ts:101-129`.
- Admin authorization: `src/server/integrations/DiscordMaintenanceApi.ts:97-150`.
- Loopback proxy and path validation: `src/server/tools/adminPanelServer.js:12-21,30-77`.
- Dev reset production default: `src/server/core/config.ts:236` and `StaticServer.ts:599-605`.
- Character atomic-write path: `src/server/database/JsonAdapter.ts:147-205,661-677`.

## Recommended security order

1. Back up, serialize, validate, and atomically replace JSON account authority.
2. Remove tracked mutable authority through a migration-safe synthetic bootstrap.
3. Gate releases on tests and reproducible client hashes.
4. Move boss decisions toward a canonical server lifecycle with shadow telemetry.
5. Harden container user/readiness/debug routing and update security policy.
