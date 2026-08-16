const fs = require('fs');
const path = require('path');
const { backup } = require('./runtimeDataArchive');

const serverRoot = path.resolve(__dirname, '..');
const backupRoot = path.resolve(process.env.DUNGEON_BLITZ_BACKUP_DIR || path.join(serverRoot, '..', '..', 'backups'));
const filesystemRoot = path.parse(backupRoot).root;
if (backupRoot === filesystemRoot || backupRoot === path.resolve(serverRoot)) {
    throw new Error(`Unsafe backup root: ${backupRoot}`);
}
const retentionDays = Math.max(1, Number.parseInt(process.env.DUNGEON_BLITZ_BACKUP_RETENTION_DAYS || '14', 10));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = path.join(backupRoot, stamp);

fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
const manifest = backup(serverRoot, destination);
const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
for (const entry of fs.readdirSync(backupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}T/.test(entry.name)) continue;
    const target = path.join(backupRoot, entry.name);
    if (fs.statSync(target).mtimeMs < cutoff) fs.rmSync(target, { recursive: true, force: true });
}
console.log(`[runtime-data] scheduled backup created at ${destination} (${manifest.files.length} files, retention ${retentionDays} days)`);
