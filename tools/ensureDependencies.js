const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function reconcile(projectDirectory) {
    const root = path.resolve(projectDirectory);
    const lockPath = path.join(root, 'package-lock.json');
    const modulesPath = path.join(root, 'node_modules');
    const markerPath = path.join(modulesPath, '.dungeon-blitz-lock.sha256');
    if (!fs.existsSync(lockPath)) throw new Error(`Missing lockfile: ${lockPath}`);
    const lockHash = crypto.createHash('sha256').update(fs.readFileSync(lockPath)).digest('hex');
    const installedHash = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8').trim() : '';
    if (fs.existsSync(modulesPath) && installedHash === lockHash) {
        process.stdout.write(`${path.relative(process.cwd(), root) || 'root'} dependencies match the lockfile; skipping.\n`);
        return;
    }
    process.stdout.write(`Reconciling ${path.relative(process.cwd(), root) || 'root'} dependencies...\n`);
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(npm, ['install', '--include=dev'], { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm install failed with exit code ${result.status}`);
    fs.writeFileSync(markerPath, `${lockHash}\n`);
}

try {
    const projects = process.argv.slice(2);
    if (!projects.length) throw new Error('Usage: node tools/ensureDependencies.js <project> [...]');
    projects.forEach(reconcile);
} catch (error) {
    console.error(`[dependencies] ${error.message}`);
    process.exit(1);
}
