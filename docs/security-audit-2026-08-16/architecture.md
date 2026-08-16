# Defensive security architecture

Scope revision: `db88c864cdade1eb42f41cc26da7917342d2ca3b`.

## Assets

- Account identifiers, password verifier records, Discord link/profile data.
- Character saves, inventory/progression, uploaded portraits.
- Admin API secrets, Discord OAuth/bot/social tokens, Mongo credentials.
- Live sessions, transfer tokens, party/room state, authoritative combat/reward state.
- Shipped SWF/SWZ client artifacts and patch provenance.

## Trust boundaries and entry points

1. Flash client -> TCP game server: custom packet protocol; clients participate in movement, combat, hostile AI, boss-copy, and cinematic signals.
2. Browser -> static/auth HTTP server: assets, password reset, Discord OAuth/linking, portraits, health/debug endpoints.
3. Admin browser -> loopback admin proxy -> server admin API: proxy retains bearer secret; server validates and rate-limits.
4. Server -> JSON filesystem or Mongo: accounts and character state.
5. Server/bridge -> Discord: OAuth, bot DMs, presence/social integration.
6. Build tools -> checked-in client binaries: numerous patch scripts plus optional FFDec.
7. Container/host -> public network: multiplayer mode binds server services to all interfaces.

## Principal controls observed

- Scrypt verifier with random salt and timing-safe comparison.
- Rate limiting on auth routes using the socket address.
- Admin API fail-closed secret configuration, timing-safe bearer comparison, and failure limits.
- Loopback-only admin proxy with upstream path sanitization.
- Local vs multiplayer bind defaults; dev password reset defaults off in production.
- Atomic queued character save replacement and optional Mongo authority.
- Ignored environment/token/link files.

## Principal risks carried into the main audit

- Mutable account authority is non-atomic and unsynchronized (`DATA-01`).
- Tracked runtime account/save snapshot exposes identifiers/verifiers and couples source to mutable authority (`DATA-02`).
- Hybrid boss authority trusts/reconciles multiple client-local copies instead of one canonical lifecycle (`AUTH-01`).
- Container runs as root and lacks meaningful readiness; production exposes a debug path (`OPS-02`).
- Build/release cannot prove client artifact integrity (`CLIENT-01`, `REL-01`).

## Out of scope / not executed

No exploitation, fuzzing, traffic interception, live OAuth, password guessing, secret use, public-host probing, Mongo deployment, native binary analysis, or Flash runtime exercise was performed.
