const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { backup, restore, verifyArchive } = require('../tools/runtimeDataArchive');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'db-runtime-data-'));
const live = path.join(root, 'live');
const archive = path.join(root, 'archive');

try {
    fs.mkdirSync(path.join(live, 'data', 'saves'), { recursive: true });
    fs.mkdirSync(path.join(live, 'portraits'), { recursive: true });
    fs.writeFileSync(path.join(live, 'data', 'Accounts.json'), '[{"user_id":1}]');
    fs.writeFileSync(path.join(live, 'data', 'saves', '1.json'), '{"user_id":1,"characters":[]}');
    fs.writeFileSync(path.join(live, 'portraits', 'hero.png'), 'portrait');

    const manifest = backup(live, archive);
    assert.equal(manifest.files.length, 3);
    verifyArchive(archive);
    fs.writeFileSync(path.join(live, 'data', 'Accounts.json'), 'changed');
    assert.throws(() => restore(live, archive, false), /confirm-offline/);
    restore(live, archive, true);
    assert.equal(fs.readFileSync(path.join(live, 'data', 'Accounts.json'), 'utf8'), '[{"user_id":1}]');
    assert.equal(fs.readFileSync(path.join(live, 'portraits', 'hero.png'), 'utf8'), 'portrait');

    fs.appendFileSync(path.join(archive, 'data', 'saves', '1.json'), 'tampered');
    assert.throws(() => verifyArchive(archive), /verification failed/);
    console.log('runtime_data_archive_regression: PASS');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
