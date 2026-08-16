const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const serverRoot = path.resolve(__dirname, '..');
const contentRoot = path.resolve(serverRoot, '..', 'client', 'content', 'localhost');
const manifest = require('./client-artifact-manifest.json');
const baseline = require('./client-patch-baseline.json');

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

if (manifest.version !== 1 || !Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw new Error('Client artifact manifest is empty or unsupported');
}
for (const artifact of manifest.artifacts) {
    const file = path.resolve(contentRoot, artifact.path);
    const relative = path.relative(contentRoot, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Artifact path escapes content root: ${artifact.path}`);
    const stat = fs.statSync(file);
    if (stat.size !== artifact.bytes || sha256(file) !== artifact.sha256) throw new Error(`Client artifact hash mismatch: ${artifact.path}`);
    if (!/^[a-f0-9]{40}$/.test(artifact.gitBlob)) throw new Error(`Missing immutable Git blob identity: ${artifact.path}`);
}

const today = new Date().toISOString().slice(0, 10);
for (const exception of baseline.knownFailing ?? []) {
    if (typeof exception !== 'object' || !exception.name || !exception.owner || !exception.rationale || !exception.expires) {
        throw new Error('Every client verifier exception requires name, owner, rationale, and expiry');
    }
    if (exception.expires < today) throw new Error(`Expired client verifier exception: ${exception.name}`);
}

const packageJson = require('../package.json');
for (const [name, command] of Object.entries(packageJson.scripts ?? {}).filter(([name]) => name.startsWith('patch:'))) {
    const match = String(command).match(/(?:scripts[\\/])([^ ]+\.(?:js|ts))/);
    if (!match || !fs.existsSync(path.join(serverRoot, 'scripts', match[1]))) throw new Error(`Declared patch script is missing: ${name}`);
}
console.log(`[client-manifest] ${manifest.artifacts.length} artifact hashes and ${(baseline.knownFailing ?? []).length} time-bounded exceptions verified`);
