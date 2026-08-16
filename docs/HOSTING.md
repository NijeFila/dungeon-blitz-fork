# Hosting and recovery

This guide uses rootless Podman. Run long-lived commands through a service manager; `tmux` is acceptable for a development host but is not process supervision.

## Prerequisites

- Podman
- Git
- Node.js 24 for host-side verification
- A reverse proxy with TLS if HTTP is exposed publicly
- A secret manager or protected environment file

## Build

Build from the repository root so the Containerfile can access both server and client sources:

```sh
git clone https://github.com/theminesastudios/dungeon-blitz-r.git
cd dungeon-blitz-r
podman build --no-cache -f Container/Containerfile -t dungeon-blitz-r:latest .
```

The image builds the server and patched client once, then copies the tested runtime into a non-root image. Do not mount a host source tree, `node_modules`, or `dist` over the application.

## Persistent data and secrets

Create only the declared writable runtime data:

```sh
install -d -m 700 "$HOME/.local/share/dungeon-blitz-r/saves"
test -f "$HOME/.local/share/dungeon-blitz-r/Accounts.json" || printf '[]\n' > "$HOME/.local/share/dungeon-blitz-r/Accounts.json"
chmod 600 "$HOME/.local/share/dungeon-blitz-r/Accounts.json"
```

Store database, Discord, and admin credentials outside the repository. If using an environment file, restrict it to mode `600` and pass it with `--env-file`. Never expose the admin proxy directly to the internet.

## Run

```sh
podman run --replace -d \
  --name dungeon-blitz-r \
  --network=host \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  -v "$HOME/.local/share/dungeon-blitz-r/Accounts.json:/opt/games/dungeon-blitz-r/src/server/data/Accounts.json:Z" \
  -v "$HOME/.local/share/dungeon-blitz-r/saves:/opt/games/dungeon-blitz-r/src/server/data/saves:Z" \
  dungeon-blitz-r:latest
```

The services use TCP: static HTTP on 8000 and the game socket on 8080 by default. With host networking, restrict those ports at the host firewall. For bridged networking, publish only the required TCP ports.

Place public HTTP behind a TLS reverse proxy and retain the original client address only through a trusted proxy configuration. The game socket is raw TCP and needs a TCP-capable proxy if terminated elsewhere.

## Readiness and logs

```sh
podman healthcheck run dungeon-blitz-r
curl --fail http://127.0.0.1:8000/healthz
podman logs --since 10m dungeon-blitz-r
```

`/healthz` returns component JSON and is ready only when HTTP, persistence initialization, and the game listener are ready. Collect logs with rotation and access controls; logs can contain character names and operational identifiers.

## Backup and restore

The archive tool includes accounts, the last-known-good account copy, character saves, unfinished transaction journals, Discord link state, and portraits. Stop writers so the archive represents one point in time, then create and verify it:

```sh
podman stop dungeon-blitz-r
backup="$HOME/backups/dungeon-blitz-r/$(date -u +%Y%m%dT%H%M%SZ)"
cd /path/to/dungeon-blitz-r/src/server
npm run data:backup -- --archive "$backup"
npm run data:verify-backup -- --archive "$backup"
podman start dungeon-blitz-r
```

The manifest records every file's byte count and SHA-256 hash; verification rejects missing, changed, or undeclared files. Retain encrypted copies on separate storage. Test restore regularly into a temporary server root first, then perform the production restore while all writers are offline:

```sh
podman stop dungeon-blitz-r
cd /path/to/dungeon-blitz-r/src/server
npm run data:verify-backup -- --archive "$backup"
npm run data:restore -- --archive "$backup" --confirm-offline
podman start dungeon-blitz-r
```

Restore stages every archived path and retains the live files until replacement succeeds; a failed replacement rolls the prior data back. After restore, verify `/healthz`, authenticate a representative test account, and load a character. For Mongo authority, use `mongodump`/`mongorestore` with the same stop-or-consistent-snapshot policy and protect the archive as sensitive data.

For systemd deployments, install `deploy/systemd/dungeon-blitz-backup.service` and `.timer`, adjust paths/environment, then enable the timer. It stops the game service, creates and verifies a timestamped archive, applies retention, and restarts the service:

```sh
systemctl enable --now dungeon-blitz-backup.timer
systemctl list-timers dungeon-blitz-backup.timer
```

## Upgrade and rollback

1. Back up and verify checksums.
2. Pull the desired tag and build a versioned image, for example `dungeon-blitz-r:1.26.0`.
3. Stop the old container and start the versioned image with the same explicit data mounts.
4. Check health, login, character load, and one dungeon transfer.
5. Keep the old image and pre-upgrade backup for at least two releases.

To roll back, stop the new container, restore the pre-upgrade data only if the release changed its format, and start the prior versioned image. Do not mix a partially migrated account file with older saves.

Back Alley's canonical encounter pilot can be returned to shadow behavior without changing save data by setting `CANONICAL_ENCOUNTER_AUTHORITY_ENABLED=0` and restarting the server. Use this only as an emergency diagnostic rollback and attach the structured `BossAuthority` timeline to the incident.

## First-run fixture migration

Mutable runtime accounts and saves are ignored by Git. A fresh clone materializes only the documented synthetic single-player fixture. Existing `Accounts.json` and `saves/` are never overwritten. Before changing repository versions, copy those runtime files to the backup location above; rollback consists of restoring that copy.
