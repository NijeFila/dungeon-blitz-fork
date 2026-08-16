# Security policy

## Supported versions

The latest tagged release receives security fixes. Older releases are unsupported unless a maintainer explicitly announces otherwise.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Older releases | No |

## Report a vulnerability

Do not open a public issue containing exploit details, secrets, account data, or private server addresses. Create a private security advisory in the GitHub repository when available, or create a private Discord ticket in The Minesa Studios server and request the security maintainers.

Include the affected version/commit, deployment mode, reproduction steps, impact, and the smallest safe proof of concept. Remove real account records, save data, tokens, and passwords from logs.

Maintainers should acknowledge a report within seven days, provide an initial assessment within fourteen days, and coordinate disclosure after a fix is available. These are response targets, not a guarantee.

## Operator guidance

- Keep the game and admin APIs behind a firewall or authenticated reverse proxy when exposed beyond localhost.
- Never expose the admin proxy without a long random `ADMIN_CONTROL_SECRET`.
- Back up accounts and saves before upgrades; follow [HOSTING.md](HOSTING.md) for restore and rollback.
- Supply Discord, database, and admin secrets through environment variables or a secret manager, never source control.
- `/healthz` is safe for readiness probes. `/debug-path` is disabled unless explicitly enabled outside production.
