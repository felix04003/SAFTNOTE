const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './specs',
  timeout: 30000,
  // Les specs partagent une base (et le blocage de connexion est par adresse) : un seul worker
  workers: 1,
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: 'http://localhost:3003',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // La trace contient aussi console, réseau et instantanés du DOM ; ouvrir avec : npx playwright show-trace <trace.zip>
    trace: 'retain-on-failure',
  },
  reporter: [['html', { open: 'never' }], ['list']],
});
