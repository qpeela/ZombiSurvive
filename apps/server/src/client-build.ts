import { readdir, readFile } from 'node:fs/promises';
import { extname } from 'node:path';

interface ClientAsset {
    readonly body: Uint8Array<ArrayBuffer>;
    readonly contentType: string;
}

const contentTypes: Readonly<Record<string, string>> = {
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
};

export const loadClientBuild = async (
    directory: URL,
): Promise<(request: Readonly<Pick<Request, 'url' | 'method'>>) => Response | undefined> => {
    const assets = new Map<string, ClientAsset>();
    const loadAssets = async (assetDirectory: URL, prefix: string): Promise<void> => {
        const entries = await readdir(assetDirectory, { withFileTypes: true });

        for (const entry of entries) {
            const path = `${prefix}/${entry.name}`;
            const url = new URL(encodeURIComponent(entry.name), assetDirectory);

            if (entry.isDirectory()) {
                await loadAssets(new URL(`${url.href}/`), path);
            }

            const contentType = contentTypes[extname(entry.name)];
            const isSupportedFile = entry.isFile() && contentType !== undefined;

            if (isSupportedFile) {
                assets.set(path, { body: new Uint8Array(await readFile(url)), contentType });
            }
        }
    };

    try {
        const html = new Uint8Array(await readFile(new URL('index.html', directory)));
        const index = { body: html, contentType: 'text/html; charset=utf-8' };
        assets.set('/', index);
        assets.set('/index.html', index);
        await loadAssets(new URL('assets/', directory), '/assets');
    } catch (cause) {
        throw new Error(
            'Client build is missing or unreadable. Run npm run build before npm start.',
            {
                cause,
            },
        );
    }

    return request => {
        const path = new URL(request.url).pathname;
        const asset = assets.get(path);

        if (asset === undefined) {
            return undefined;
        }

        const isHead = request.method === 'HEAD';

        if (request.method !== 'GET' && !isHead) {
            return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
        }

        return new Response(isHead ? null : asset.body, {
            headers: {
                'Content-Type': asset.contentType,
                'Content-Length': String(asset.body.byteLength),
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
            },
        });
    };
};
