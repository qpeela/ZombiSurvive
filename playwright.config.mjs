import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/smoke',
    forbidOnly: true,
    retries: 0,
    workers: 1,
    reporter: 'list',
    use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:4173',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: [
        {
            command: 'node node_modules/vite/bin/vite.js preview apps/client',
            url: 'http://127.0.0.1:4173',
            name: 'client',
            env: { GAME_SERVER_URL: 'http://127.0.0.1:3101' },
            reuseExistingServer: false,
            gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
        },
        {
            command: 'node tests/fixtures/solo-host.mjs',
            url: 'http://127.0.0.1:3101/health',
            env: { PORT: '3101', CLIENT_ORIGIN: 'http://127.0.0.1:4173' },
            name: 'server',
            reuseExistingServer: false,
            gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
        },
    ],
});
