const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const testDir = path.resolve(__dirname, '..', 'test');
const allTests = fs.readdirSync(testDir)
    .filter((name) => /_regression\.(ts|js)$/.test(name))
    .sort();
const shardTotal = Math.max(1, Number.parseInt(process.env.TEST_SHARD_TOTAL || '1', 10));
const shardIndex = Math.max(0, Number.parseInt(process.env.TEST_SHARD_INDEX || '0', 10));
if (shardIndex >= shardTotal) throw new Error(`TEST_SHARD_INDEX ${shardIndex} must be below ${shardTotal}`);
const tests = allTests.filter((_, index) => index % shardTotal === shardIndex);
const timeoutMs = Math.max(1_000, Number.parseInt(process.env.TEST_TIMEOUT_MS || '180000', 10));
const results = [];

// Run every test even after one fails. Bailing on the first failure meant a single known
// red test hid everything sorting after it -- the suite still exits non-zero, it just says
// what else broke first.
const failed = [];

for (const test of tests) {
    const testPath = path.join(testDir, test);
    const args = test.endsWith('.ts')
        ? ['-r', 'ts-node/register', testPath]
        : [testPath];
    console.log(`[regression] ${test}`);
    const result = spawnSync(process.execPath, args, {
        cwd: path.resolve(__dirname, '..'),
        env: {
            ...process.env,
            TS_NODE_COMPILER_OPTIONS: JSON.stringify({ types: ['node'] })
        },
        stdio: 'inherit',
        timeout: timeoutMs
    });
    results.push({ name: test, status: result.status, signal: result.signal, error: result.error });
    if (result.status !== 0) {
        failed.push(test);
    }
}

const xmlEscape = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const junitPath = process.env.JUNIT_OUTPUT;
if (junitPath) {
    const failures = results.filter((result) => result.status !== 0);
    const cases = results.map((result) => {
        const failure = result.status === 0 ? '' : `<failure message="${xmlEscape(result.error?.message || result.signal || `exit ${result.status}`)}"/>`;
        return `<testcase classname="regression" name="${xmlEscape(result.name)}">${failure}</testcase>`;
    }).join('');
    fs.mkdirSync(path.dirname(path.resolve(junitPath)), { recursive: true });
    fs.writeFileSync(
        junitPath,
        `<?xml version="1.0" encoding="UTF-8"?><testsuite name="regression" tests="${results.length}" failures="${failures.length}">${cases}</testsuite>\n`
    );
}

if (failed.length > 0) {
    console.error(`[regression] ${failed.length}/${tests.length} FAILED:`);
    for (const test of failed) {
        console.error(`[regression]   ${test}`);
    }
    process.exit(1);
}

console.log(`[regression] ${tests.length} tests passed (shard ${shardIndex + 1}/${shardTotal})`);
