import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, expect, test } from 'vitest';

import { loadClientBuild } from '../../apps/server/src/client-build.ts';

let directory: string;
let buildUrl: URL;

beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'zombi-client-build-'));
    buildUrl = pathToFileURL(`${directory}/`);
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'index.html'), '<html lang="ru">Игра</html>');
    await writeFile(join(directory, 'assets/game-123.js'), 'export const ready = true;');
    await writeFile(join(directory, 'assets/game-123.css'), 'canvas { display: block; }');
});

afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
});

test('serves the built HTML, JS and CSS with browser MIME types and no stale cache', async () => {
    const serve = await loadClientBuild(buildUrl);

    for (const [path, contentType, content] of [
        ['/', 'text/html; charset=utf-8', '<html lang="ru">Игра</html>'],
        ['/index.html', 'text/html; charset=utf-8', '<html lang="ru">Игра</html>'],
        ['/assets/game-123.js?v=1', 'text/javascript; charset=utf-8', 'export const ready = true;'],
        ['/assets/game-123.css', 'text/css; charset=utf-8', 'canvas { display: block; }'],
    ] as const) {
        const response = serve(new Request(`http://127.0.0.1:3001${path}`));
        expect(response?.status).toBe(200);
        expect(response?.headers.get('content-type')).toBe(contentType);
        expect(response?.headers.get('cache-control')).toBe('no-store');
        expect(response?.headers.get('x-content-type-options')).toBe('nosniff');
        expect(await response?.text()).toBe(content);
    }
});

test('HEAD preserves the GET byte length without a body and mutations are rejected', async () => {
    const serve = await loadClientBuild(buildUrl);
    const response = serve(new Request('http://127.0.0.1:3001/', { method: 'HEAD' }));
    expect(await response?.text()).toBe('');
    expect(response?.headers.get('content-length')).toBe(
        String(Buffer.byteLength('<html lang="ru">Игра</html>')),
    );

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const mutation = serve(new Request('http://127.0.0.1:3001/assets/game-123.js', { method }));
        expect(mutation?.status).toBe(405);
        expect(mutation?.headers.get('allow')).toBe('GET, HEAD');
    }
});

test('only build entries are exposed; source maps, symlinks and traversal never read files', async () => {
    await writeFile(join(directory, 'secret.js'), 'private');
    await writeFile(join(directory, 'assets/game-123.js.map'), 'private source map');
    await symlink(join(directory, 'secret.js'), join(directory, 'assets/link.js'));
    const serve = await loadClientBuild(buildUrl);

    for (const path of [
        '/missing',
        '/secret.js',
        '/assets/',
        '/assets/link.js',
        '/assets/game-123.js.map',
        '/assets/../secret.js',
        '/assets/%2e%2e/secret.js',
        '/assets/..%2fsecret.js',
        '/assets/%252e%252e%252fsecret.js',
        '/assets/game-123.js%00',
        '/assets/%ZZ',
        '/matchmake/joinById/local-world',
        '/health',
    ]) {
        expect(serve(new Request(`http://127.0.0.1:3001${path}`))).toBeUndefined();
    }
});

test('fails before starting a host if the client build is missing', async () => {
    await rm(join(directory, 'index.html'));
    await expect(loadClientBuild(buildUrl)).rejects.toThrow('Run npm run build before npm start.');
});
