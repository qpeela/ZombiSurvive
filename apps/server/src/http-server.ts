import { createServer, type Server } from 'node:http';

export const createHttpServer = (): Server =>
    createServer((request, response) => {
        const pathname = request.url?.split('?')[0];
        const isHealthRoute = pathname === '/health';

        if (!isHealthRoute) {
            response.writeHead(404);
            response.end();

            return;
        }

        const isGetRequest = request.method === 'GET';
        const isHeadRequest = request.method === 'HEAD';

        if (!isGetRequest && !isHeadRequest) {
            response.writeHead(405, { Allow: 'GET, HEAD' });
            response.end();

            return;
        }

        response.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
        });
        response.end(isHeadRequest ? undefined : JSON.stringify({ status: 'ok' }));
    });
