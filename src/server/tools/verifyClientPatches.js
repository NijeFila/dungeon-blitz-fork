const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The client-side fixes in scripts/ are byte patches against DungeonBlitz.swf, Game.swz and the
// Levels*.swz files. Nothing re-applies them automatically, so committing a rebuilt SWF silently
// throws them away -- that is how the forge charm durations, the forge tutorial persistence and
// the home timer reductions each came back as "new" bugs.
//
// Every patch script that supports --verify is a self-check for exactly that. Run them all before
// the build so a dropped patch fails loudly here instead of shipping to players.
const scriptsDir = path.resolve(__dirname, '..', 'scripts');
const serverDir = path.resolve(__dirname, '..');
// Deploys run this on the live box while players are connected, so leave a core for the game
// server rather than saturating every one of them for the ~2 minutes the sweep takes.
const concurrency = Math.max(1, Math.min(8, os.cpus().length - 1));
const immutableRoots = [
    path.resolve(serverDir, '..', 'client', 'content'),
    path.resolve(serverDir, 'data')
];

function snapshotFiles(roots) {
    const snapshot = new Map();
    const visit = (entryPath) => {
        const stat = fs.statSync(entryPath);
        if (stat.isDirectory()) {
            for (const name of fs.readdirSync(entryPath).sort()) {
                visit(path.join(entryPath, name));
            }
            return;
        }
        snapshot.set(entryPath, `${stat.size}:${stat.mtimeMs}`);
    };
    for (const root of roots) {
        if (fs.existsSync(root)) visit(root);
    }
    return snapshot;
}

function assertUnchanged(before, after) {
    const paths = new Set([...before.keys(), ...after.keys()]);
    const changed = [...paths].filter((entryPath) => before.get(entryPath) !== after.get(entryPath));
    if (changed.length > 0) {
        throw new Error(
            `Verification mutated ${changed.length} client/data file(s):\n${changed.slice(0, 20).join('\n')}`
        );
    }
}

function discoverVerifiableScripts() {
    return fs
        .readdirSync(scriptsDir)
        .filter((name) => /^patch.*\.(ts|js)$/.test(name))
        .filter((name) => {
            try {
                return fs.readFileSync(path.join(scriptsDir, name), 'utf8').includes('--verify');
            } catch {
                return false;
            }
        })
        .sort();
}

function runVerify(name) {
    const isTypeScript = name.endsWith('.ts');
    const command = process.execPath;
    const args = isTypeScript
        ? ['-r', 'ts-node/register', path.join('scripts', name), '--verify']
        : [path.join('scripts', name), '--verify'];

    return new Promise((resolve) => {
        execFile(command, args, { cwd: serverDir, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
            const output = `${stdout ?? ''}${stderr ?? ''}`.trim();
            // Some verifiers shell out to FFDec to disassemble Levels*.swz. A missing FFDec means
            // the check could not run at all, which is not the same as the patch being gone --
            // report it separately rather than failing a build over a missing local tool.
            const unavailable = Boolean(error) && /FFDec not found|ffdec/i.test(output);
            resolve({
                name,
                ok: !error,
                skipped: unavailable,
                output
            });
        });
    });
}

async function runAll(names) {
    const results = [];
    let cursor = 0;

    async function worker() {
        while (cursor < names.length) {
            const name = names[cursor];
            cursor += 1;
            results.push(await runVerify(name));
        }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return results;
}

async function main() {
    const before = snapshotFiles(immutableRoots);
    const names = discoverVerifiableScripts();
    if (names.length === 0) {
        console.error('[verify-patches] No verifiable patch scripts found -- expected scripts/patch*.{ts,js}');
        process.exitCode = 1;
        assertUnchanged(before, snapshotFiles(immutableRoots));
        return;
    }

    console.log(`[verify-patches] Checking ${names.length} client patches (concurrency ${concurrency})...`);
    const results = await runAll(names);

    // 22 patches already failed when this gate was introduced -- some are deliberate reverts
    // (destroy-entity-without-brain, matching the `revert-destroy-brainless` client revision),
    // others are genuinely dropped. Failing the build on those would block every build before
    // anyone could triage them, so the gate only reacts to changes against that baseline.
    const baseline = new Set(loadBaseline());

    // Under concurrency JPEXS' decompiler worker can time out (it drops a com.jpexs stack trace and
    // a truncated .as export), which makes a patch that is actually present verify as missing.
    // Re-check anything we are about to call lost one at a time before believing it: a starved
    // decompiler passes on the second look, a real loss still fails.
    const suspects = results.filter((result) => !result.ok && !result.skipped && !baseline.has(result.name));
    if (suspects.length > 0) {
        console.warn(`[verify-patches] ${suspects.length} patch(es) failed; re-checking them serially...`);
        for (const suspect of suspects) {
            results[results.indexOf(suspect)] = await runVerify(suspect.name);
        }
    }

    const failures = results.filter((result) => !result.ok && !result.skipped);
    const skipped = results.filter((result) => result.skipped);

    if (skipped.length > 0) {
        console.warn(
            `[verify-patches] ${skipped.length} patch(es) could not be checked (FFDec unavailable): ` +
            skipped.map((entry) => entry.name).sort().join(', ')
        );
        if (process.env.VERIFY_CLIENT_PATCHES_REQUIRE_TOOLS === '1') {
            console.error('[verify-patches] Required verifier tooling is unavailable; strict verification cannot pass.');
            assertUnchanged(before, snapshotFiles(immutableRoots));
            process.exitCode = 1;
            return;
        }
    }

    const regressions = failures.filter((result) => !baseline.has(result.name));
    const recovered = results.filter((result) => result.ok && baseline.has(result.name));

    if (recovered.length > 0) {
        console.error(
            `[verify-patches] ${recovered.length} baseline patch(es) now pass and must be removed from\n` +
            `[verify-patches] tools/client-patch-baseline.json: ${recovered.map((entry) => entry.name).sort().join(', ')}`
        );
    }

    if (regressions.length === 0 && recovered.length === 0) {
        const checked = results.length - skipped.length;
        console.log(
            `[verify-patches] ${checked - failures.length}/${checked} checkable patches present; ` +
            `${failures.length} known-failing (baseline). No new losses.`
        );
        assertUnchanged(before, snapshotFiles(immutableRoots));
        return;
    }

    if (regressions.length > 0) {
        console.error(`[verify-patches] ${regressions.length} client patch(es) were LOST since the baseline:`);
        for (const failure of regressions.sort((left, right) => left.name.localeCompare(right.name))) {
            console.error(`\n  ---- ${failure.name} ----`);
            console.error(failure.output.split('\n').slice(-12).map((line) => `  ${line}`).join('\n'));
        }
        console.error(
            '\n[verify-patches] A rebuilt SWF most likely dropped these. Re-run the listed script(s)\n' +
            '[verify-patches] without --verify to re-apply, then commit the patched asset.'
        );
    }

    assertUnchanged(before, snapshotFiles(immutableRoots));
    process.exitCode = 1;
}

function loadBaseline() {
    const baselinePath = path.resolve(__dirname, 'client-patch-baseline.json');
    try {
        const parsed = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
        return Array.isArray(parsed?.knownFailing) ? parsed.knownFailing : [];
    } catch {
        console.warn('[verify-patches] No baseline found; every failing patch counts as a regression.');
        return [];
    }
}

main().catch((error) => {
    console.error('[verify-patches] Runner failed:', error);
    process.exitCode = 1;
});
