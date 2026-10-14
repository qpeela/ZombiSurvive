import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), 'GAME_SERVER_URL');
    const target =
        process.env['GAME_SERVER_URL'] ?? env['GAME_SERVER_URL'] ?? 'http://127.0.0.1:3001';
    const proxy = {
        '/matchmake': { target, changeOrigin: true },
        '^/[^/]+/local-world': { target, changeOrigin: true, ws: true },
    };

    return {
        server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
        preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
    };
});
