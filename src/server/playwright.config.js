const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './test/browser',
    timeout: 30_000,
    retries: 0,
    use: { headless: true },
    reporter: process.env.CI ? [['line'], ['junit', { outputFile: 'artifacts/browser.xml' }]] : 'line'
});
