import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';

const panelRoot = path.resolve(__dirname, '../tools/admin-panel');
const app = fs.readFileSync(path.join(panelRoot, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(panelRoot, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(panelRoot, 'styles.css'), 'utf8');

assert.doesNotMatch(app, /\.innerHTML\s*=/, 'live snapshots must not replace interactive subtrees');
assert.match(app, /updateKeyedList/, 'live lists must preserve keyed DOM nodes');
assert.match(app, /aria-pressed/, 'player selection must expose an accessible selected state');
assert.match(app, /settingsDirty/, 'server snapshots must preserve unsaved settings');
assert.match(app, /if\(sent\)input\.value=''/, 'failed announcements must retain their text');
assert.match(app, /state\.pending/, 'mutations must be guarded against duplicate submission');
assert.match(app, /dialog\.showModal\(\)/, 'destructive mutations must use explicit confirmation');
assert.match(html, /<dialog id="confirmDialog"/, 'the confirmation dialog must exist');
assert.match(html, /aria-current="location"/, 'navigation must expose its current location');
assert.doesNotMatch(css, /fonts\.googleapis\.com/, 'the local admin must not require third-party fonts');
assert.match(css, /:focus-visible/, 'keyboard focus must remain visibly indicated');

console.log('admin panel UI contract regression passed');
