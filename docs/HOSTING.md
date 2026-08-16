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

Stop writes before a JSON-mode backup so `Accounts.json` and saves describe the same point in time:

```sh
podman stop dungeon-blitz-r
backup="$HOME/backups/dungeon-blitz-r/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$backup"
cp -a "$HOME/.local/share/dungeon-blitz-r/Accounts.json" "$backup/"
cp -a "$HOME/.local/share/dungeon-blitz-r/saves" "$backup/"
sha256sum "$backup/Accounts.json" "$backup"/saves/*.json > "$backup/SHA256SUMS"
podman start dungeon-blitz-r
```

Retain encrypted backups on separate storage. Test restore regularly:

```sh
podman stop dungeon-blitz-r
cp -a "$backup/Accounts.json" "$HOME/.local/share/dungeon-blitz-r/Accounts.json"
rm -rf "$HOME/.local/share/dungeon-blitz-r/saves.restore"
cp -a "$backup/saves" "$HOME/.local/share/dungeon-blitz-r/saves.restore"
mv "$HOME/.local/share/dungeon-blitz-r/saves" "$HOME/.local/share/dungeon-blitz-r/saves.before-restore"
mv "$HOME/.local/share/dungeon-blitz-r/saves.restore" "$HOME/.local/share/dungeon-blitz-r/saves"
podman start dungeon-blitz-r
```

After restore, verify `/healthz`, authenticate a representative test account, and load a character before deleting `saves.before-restore`. For Mongo authority, use `mongodump`/`mongorestore` with the same stop-or-consistent-snapshot policy and protect the archive as sensitive data.

## Upgrade and rollback

1. Back up and verify checksums.
2. Pull the desired tag and build a versioned image, for example `dungeon-blitz-r:1.25.0`.
3. Stop the old container and start the versioned image with the same explicit data mounts.
4. Check health, login, character load, and one dungeon transfer.
5. Keep the old image and pre-upgrade backup for at least two releases.

To roll back, stop the new container, restore the pre-upgrade data only if the release changed its format, and start the prior versioned image. Do not mix a partially migrated account file with older saves.

## First-run fixture migration

Mutable runtime accounts and saves are ignored by Git. A fresh clone materializes only the documented synthetic single-player fixture. Existing `Accounts.json` and `saves/` are never overwritten. Before changing repository versions, copy those runtime files to the backup location above; rollback consists of restoring that copy.
