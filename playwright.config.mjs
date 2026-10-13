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
            reuseExistingServer: false,
            gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
        },
        {
            command: 'node apps/server/dist/main.js',
            url: 'http://127.0.0.1:3101/health',
            env: { PORT: '3101' },
            name: 'server',
            reuseExistingServer: false,
            gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
        },
    ],
});
