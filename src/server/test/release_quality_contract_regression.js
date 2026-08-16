const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../..');
const quality = fs.readFileSync(path.join(root, '.github/workflows/quality.yml'), 'utf8');
const release = fs.readFileSync(path.join(root, '.github/workflows/release-on-package-update.yml'), 'utf8');

for (const gate of [
    'npm run typecheck',
    'npm run lint',
    'npm run test:regression',
    'npm run test:coverage',
    'npm run test:browser',
    'npm run verify:client-patches',
    'npm run verify:client-artifacts',
    'npm audit --omit=dev',
    'git diff --exit-code',
    'container-smoke',
    'launcher-smoke'
]) assert.match(quality, new RegExp(gate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing release gate: ${gate}`);

assert.match(release, /workflow_dispatch:/);
assert.doesNotMatch(release, /push:\s*[\s\S]*package\.json/);
assert.match(release, /needs: quality/);
assert.match(release, /contents: write/);
assert.match(release, /cancel-in-progress: false/);
console.log('release_quality_contract_regression: PASS');
