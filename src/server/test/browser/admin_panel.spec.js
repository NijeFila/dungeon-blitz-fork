const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { pathToFileURL } = require('url');
const path = require('path');

const pageUrl = pathToFileURL(path.resolve(__dirname, '../../tools/admin-panel/index.html')).href;
const settings = { oneHitEnabled: false, godModeEnabled: false, freezeEnemies: false, damageMultiplier: 1, playerSpeedMultiplier: 1, gearDropMultiplier: 1, materialDropMultiplier: 1, goldMultiplier: 1, xpMultiplier: 1 };
const snapshot = (overrides = {}) => ({ generatedAt: Date.now(), uptimeSeconds: 60, onlinePlayers: 1, connections: 1, players: [{ token: 7, name: 'RendzerA', level: 'JC_Mission2', roomId: 3, hp: 100, maxHp: 100 }], rooms: [{ level: 'JC_Mission2', roomId: 3, players: 1, hostiles: 2 }], settings, ...overrides });

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        window.__requests = [];
        window.__fetchFailure = false;
        window.fetch = async (url, options) => {
            window.__requests.push({ url, options });
            return window.__fetchFailure
                ? { ok: false, status: 500, json: async () => ({ error: 'simulated failure' }) }
                : { ok: true, status: 200, json: async () => ({ defeated: 2, settings: {} }) };
        };
        class FakeEventSource {
            constructor() { window.__events = this; this.listeners = {}; }
            addEventListener(name, callback) { this.listeners[name] = callback; }
            emit(name, data) { this.listeners[name]?.({ data: JSON.stringify(data) }); }
        }
        window.EventSource = FakeEventSource;
    });
    await page.goto(pageUrl);
});

test('live snapshots preserve focus and selected semantics', async ({ page }) => {
    await page.evaluate((value) => window.__events.emit('snapshot', value), snapshot());
    const player = page.locator('.player');
    await player.focus();
    for (let tick = 0; tick < 3; tick += 1) {
        await page.evaluate((value) => window.__events.emit('snapshot', value), snapshot({ generatedAt: Date.now() + tick }));
        await expect(player).toBeFocused();
        await expect(player).toHaveAttribute('aria-pressed', 'true');
    }
});

test('dirty settings survive snapshots and failed save', async ({ page }) => {
    await page.evaluate((value) => window.__events.emit('snapshot', value), snapshot());
    await page.locator('label.toggle-card', { has: page.locator('#oneHitEnabled') }).click();
    await page.evaluate((value) => window.__events.emit('snapshot', value), snapshot({ settings: { ...settings, oneHitEnabled: false } }));
    await expect(page.locator('#oneHitEnabled')).toBeChecked();
    await page.evaluate(() => { window.__fetchFailure = true; });
    await page.locator('#saveSettings').click();
    await expect(page.locator('#oneHitEnabled')).toBeChecked();
    await expect(page.locator('#toast')).toContainText('simulated failure');
});

test('failed announcement is retained and refocused', async ({ page }) => {
    await page.evaluate((value) => window.__events.emit('snapshot', value), snapshot());
    await page.evaluate(() => { window.__fetchFailure = true; });
    await page.locator('#announcement').fill('Keep this message');
    await page.locator('#announceForm button').click();
    await expect(page.locator('#announcement')).toHaveValue('Keep this message');
    await expect(page.locator('#announcement')).toBeFocused();
});

test('destructive room action requires confirmation and sends once', async ({ page }) => {
    await page.evaluate((value) => window.__events.emit('snapshot', value), snapshot());
    await page.locator('[data-action="kill-room"]').click();
    await expect(page.locator('#confirmDialog')).toBeVisible();
    expect(await page.evaluate(() => window.__requests.length)).toBe(0);
    await page.locator('#confirmSubmit').click();
    await expect.poll(() => page.evaluate(() => window.__requests.length)).toBe(1);
});

test('rendered dashboard has no automated WCAG A or AA violations', async ({ page }) => {
    await page.evaluate((value) => window.__events.emit('snapshot', value), snapshot());
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
});
