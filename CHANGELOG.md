# Changelog

All notable user-facing changes are documented here. Versions follow semantic versioning.

## [Unreleased]

No unreleased changes.

## [1.25.0] - 2026-08-16

### Fixed

- Made Mortis Golem and Seelie Ravager deaths permanent in both Back Alley Deals modes without allowing victory before both bosses, room clear, and the authored cinematic.
- Restored deterministic client patch verification and the missing Plague Battalion client state.
- Prevented concurrent or interrupted JSON account mutations from losing or corrupting accounts, with validated backup recovery.
- Disposed completed dungeon scope state centrally and made game/AI shutdown drain active resources.
- Preserved unsaved admin settings, keyboard focus, selection semantics, and failed announcements across live updates.
- Added confirmations and duplicate-request guards to destructive admin actions.
- Corrected the local Flash fallback, OAuth result documents, password-reset autocomplete, admin contrast, and offline font behavior.
- Made both launchers reconcile lockfile changes and made Windows open FlashBrowser after readiness.

### Changed

- Replaced tracked mutable account/save authority with a minimal documented synthetic first-run fixture while preserving existing local runtime data.
- Hardened the container for non-root, read-only operation with explicit persistent data mounts and component readiness.
- Made releases explicit and gated them on build, typecheck, regression, client verification, dependency audit, clean-tree validation, and checksummed tested artifacts.
- Added regression timeouts, JUnit output, sharding, admin UI contracts, account fault-injection checks, and scope-disposal checks.
- Expanded local setup, administration, security, hosting, backup, restore, upgrade, and rollback documentation.
