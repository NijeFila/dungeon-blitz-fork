const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SERVER_ROOT = path.resolve(__dirname, '..');
const MANIFEST = 'runtime-data-manifest.json';
const MUTABLE_PATHS = [
    'data/Accounts.json',
    'data/Accounts.json.backup',
    'data/saves',
    'data/transactions',
    'data/discord_account_links.json',
    'portraits',
    '.discord-social-channel-link.json'
];

function parseArgs(argv) {
    const [command, ...rest] = argv;
    const options = { command, dataRoot: SERVER_ROOT, archive: '' };
    for (let i = 0; i < rest.length; i += 1) {
        if (rest[i] === '--data-root') options.dataRoot = path.resolve(rest[++i]);
        else if (rest[i] === '--archive') options.archive = path.resolve(rest[++i]);
        else if (rest[i] === '--confirm-offline') options.confirmOffline = true;
        else throw new Error(`Unknown argument: ${rest[i]}`);
    }
    if (!['backup', 'verify', 'restore'].includes(command) || !options.archive) {
        throw new Error('Usage: runtimeDataArchive.js <backup|verify|restore> --archive <directory> [--data-root <server-root>] [--confirm-offline]');
    }
    return options;
}

function assertContained(root, target) {
    const relative = path.relative(path.resolve(root), path.resolve(target));
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Path escapes root: ${target}`);
}

function filesUnder(root) {
    if (!fs.existsSync(root)) return [];
    const stat = fs.statSync(root);
    if (stat.isFile()) return [root];
    return fs.readdirSync(root).sort().flatMap((name) => filesUnder(path.join(root, name)));
}

function digest(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function buildManifest(archiveRoot) {
    const files = filesUnder(archiveRoot)
        .filter((file) => path.basename(file) !== MANIFEST)
        .map((file) => ({
            path: path.relative(archiveRoot, file).replace(/\\/g, '/'),
            bytes: fs.statSync(file).size,
            sha256: digest(file)
        }));
    return { version: 1, createdAt: new Date().toISOString(), files };
}

function verifyArchive(archiveRoot) {
    const manifestPath = path.join(archiveRoot, MANIFEST);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Unsupported archive manifest');
    const declared = new Set();
    for (const entry of manifest.files) {
        if (!entry || typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid archive entry');
        const file = path.resolve(archiveRoot, entry.path);
        assertContained(archiveRoot, file);
        if (!fs.statSync(file).isFile() || fs.statSync(file).size !== entry.bytes || digest(file) !== entry.sha256) {
            throw new Error(`Archive verification failed: ${entry.path}`);
        }
        declared.add(entry.path.replace(/\\/g, '/'));
    }
    const actual = filesUnder(archiveRoot)
        .filter((file) => path.basename(file) !== MANIFEST)
        .map((file) => path.relative(archiveRoot, file).replace(/\\/g, '/'));
    if (actual.some((file) => !declared.has(file)) || actual.length !== declared.size) throw new Error('Archive contains undeclared files');
    return manifest;
}

function backup(dataRoot, archiveRoot) {
    if (fs.existsSync(archiveRoot) && fs.readdirSync(archiveRoot).length > 0) throw new Error('Archive directory must be empty');
    fs.mkdirSync(archiveRoot, { recursive: true, mode: 0o700 });
    for (const relative of MUTABLE_PATHS) {
        const source = path.join(dataRoot, relative);
        if (!fs.existsSync(source)) continue;
        const target = path.join(archiveRoot, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.cpSync(source, target, { recursive: true, errorOnExist: true });
    }
    const manifest = buildManifest(archiveRoot);
    fs.writeFileSync(path.join(archiveRoot, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    verifyArchive(archiveRoot);
    return manifest;
}

function restore(dataRoot, archiveRoot, confirmOffline) {
    if (!confirmOffline) throw new Error('Restore requires --confirm-offline after all game-server writers are stopped');
    const manifest = verifyArchive(archiveRoot);
    const stage = path.join(dataRoot, `.runtime-restore-${process.pid}-${Date.now()}`);
    const rollback = path.join(dataRoot, `.runtime-rollback-${process.pid}-${Date.now()}`);
    fs.mkdirSync(stage, { recursive: true });
    fs.mkdirSync(rollback, { recursive: true });
    try {
        for (const relative of MUTABLE_PATHS) {
            const archived = path.join(archiveRoot, relative);
            if (fs.existsSync(archived)) {
                const staged = path.join(stage, relative);
                fs.mkdirSync(path.dirname(staged), { recursive: true });
                fs.cpSync(archived, staged, { recursive: true, errorOnExist: true });
            }
        }
        for (const relative of MUTABLE_PATHS) {
            const current = path.join(dataRoot, relative);
            const staged = path.join(stage, relative);
            const saved = path.join(rollback, relative);
            if (fs.existsSync(current)) {
                fs.mkdirSync(path.dirname(saved), { recursive: true });
                fs.renameSync(current, saved);
            }
            if (fs.existsSync(staged)) {
                fs.mkdirSync(path.dirname(current), { recursive: true });
                fs.renameSync(staged, current);
            }
        }
        fs.rmSync(rollback, { recursive: true, force: true });
        return manifest;
    } catch (error) {
        for (const relative of MUTABLE_PATHS.slice().reverse()) {
            const current = path.join(dataRoot, relative);
            const saved = path.join(rollback, relative);
            if (fs.existsSync(current)) fs.rmSync(current, { recursive: true, force: true });
            if (fs.existsSync(saved)) {
                fs.mkdirSync(path.dirname(current), { recursive: true });
                fs.renameSync(saved, current);
            }
        }
        throw error;
    } finally {
        fs.rmSync(stage, { recursive: true, force: true });
        fs.rmSync(rollback, { recursive: true, force: true });
    }
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const result = options.command === 'backup'
        ? backup(options.dataRoot, options.archive)
        : options.command === 'restore'
            ? restore(options.dataRoot, options.archive, options.confirmOffline)
            : verifyArchive(options.archive);
    console.log(`[runtime-data] ${options.command} verified (${result.files.length} files)`);
}

if (require.main === module) {
    try { main(); } catch (error) { console.error(`[runtime-data] ${error.message}`); process.exitCode = 1; }
}

module.exports = { backup, restore, verifyArchive };
