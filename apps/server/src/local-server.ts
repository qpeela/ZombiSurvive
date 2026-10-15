import { createServer, type RequestListener } from 'node:http';

import {
    createEndpoint,
    createRouter,
    defineRoom,
    defineServer,
    matchMaker,
    type Server,
} from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { localWorldRoomId } from '@zombi-survive/protocol';

import { loadClientBuild } from './client-build.ts';
import { LocalWorldRoom } from './local-world-room.ts';
import { WorldAccess } from './world-access.ts';

export const startLocalServer = async (
    port: number,
    clientOrigin: string,
    clientDirectory?: URL,
    options: { readonly host?: string; readonly access?: WorldAccess } = {},
): Promise<Server> => {
    const host = options.host ?? '127.0.0.1';
    const access = options.access ?? new WorldAccess(false, port);
    const clientUrl = new URL(clientOrigin);
    const isClientHostAllowed =
        clientUrl.hostname === host || (host === '127.0.0.1' && clientUrl.hostname === 'localhost');
    const isPlainOrigin = clientUrl.origin === clientOrigin;

    if (!isClientHostAllowed || !isPlainOrigin || clientUrl.protocol !== 'http:') {
        throw new Error('CLIENT_ORIGIN must be an HTTP origin on the selected host.');
    }

    const serveClient =
        clientDirectory === undefined ? undefined : await loadClientBuild(clientDirectory);
    const serverOrigin = `http://${host}:${String(port)}`;
    const allowedOrigins = new Set([serverOrigin, clientOrigin]);
    const isAllowedRequest = (headers: Headers, isOriginRequired: boolean): boolean => {
        const isLocalHost = headers.get('host') === `${host}:${String(port)}`;
        const origin = headers.get('origin');
        const isAllowedOrigin = origin === null ? !isOriginRequired : allowedOrigins.has(origin);

        return isLocalHost && isAllowedOrigin;
    };

    const httpServer = createServer();
    const transport = new WebSocketTransport({
        server: httpServer,
        maxPayload: 4096,
        beforeUpgrade: request => {
            if (!isAllowedRequest(request.headers, true)) {
                return new Response('Forbidden', { status: 403 });
            }

            if (access.authenticate(request.headers) === null) {
                return new Response('Invitation required', { status: 403 });
            }

            return undefined;
        },
    });
    const server = defineServer({
        transport,
        greet: false,
        gracefullyShutdown: false,
        rooms: { [localWorldRoomId]: defineRoom(LocalWorldRoom) },
        routes: createRouter(
            {
                session: createEndpoint('/session', { method: 'POST' }, context => {
                    const headers = context.request?.headers ?? new Headers();

                    if (access.authenticate(headers) !== null) {
                        return Promise.resolve(new Response(null, { status: 204 }));
                    }

                    const body: unknown = context.body;
                    const isObject = typeof body === 'object' && body !== null;
                    const invitation = isObject && 'invitation' in body ? body.invitation : null;
                    const cookie = access.redeem(invitation);

                    if (cookie === null) {
                        return Promise.resolve(
                            new Response('Invalid or expired invitation', { status: 403 }),
                        );
                    }

                    return Promise.resolve(
                        new Response(null, {
                            status: 204,
                            headers: { 'Set-Cookie': cookie, 'Cache-Control': 'no-store' },
                        }),
                    );
                }),
                health: createEndpoint(
                    '/health',
                    { method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] },
                    context => {
                        const method = context.request?.method;
                        const isHead = method === 'HEAD';

                        if (method !== 'GET' && !isHead) {
                            return Promise.resolve(
                                new Response(null, {
                                    status: 405,
                                    headers: { Allow: 'GET, HEAD' },
                                }),
                            );
                        }

                        return Promise.resolve(
                            new Response(isHead ? null : JSON.stringify({ status: 'ok' }), {
                                headers: {
                                    'Content-Type': 'application/json; charset=utf-8',
                                    'Cache-Control': 'no-store',
                                },
                            }),
                        );
                    },
                ),
            },
            {
                onRequest: request => {
                    const path = new URL(request.url).pathname;
                    const isMatchmaking = path.startsWith('/matchmake/');
                    const isOriginRequired = isMatchmaking || path === '/session';

                    if (!isAllowedRequest(request.headers, isOriginRequired)) {
                        return new Response('Forbidden', { status: 403 });
                    }

                    if (isMatchmaking && access.authenticate(request.headers) === null) {
                        return new Response('Invitation required', { status: 403 });
                    }

                    return undefined;
                },
            },
        ),
    });
    matchMaker.controller.exposedMethods = ['joinById'];
    matchMaker.controller.getCorsHeaders = headers => ({
        'Access-Control-Allow-Origin': allowedOrigins.has(headers.get('origin') ?? '')
            ? (headers.get('origin') ?? serverOrigin)
            : serverOrigin,
    });

    try {
        await Promise.race([
            server.listen(port, host),
            new Promise<never>((_, reject) => httpServer.once('error', reject)),
        ]);
        await matchMaker.createRoom(localWorldRoomId, { access });

        if (serveClient !== undefined) {
            // The Colyseus response adapter can leave a large response open after
            // backpressure. Node's end(body) owns completion for static responses.
            const requestListeners = httpServer.listeners('request') as RequestListener[];
            httpServer.removeAllListeners('request');
            httpServer.on('request', (request, response) => {
                let clientResponse: Response | undefined;

                try {
                    clientResponse = serveClient({
                        url: new URL(request.url ?? '/', serverOrigin).href,
                        method: request.method ?? 'GET',
                    });
                } catch {
                    response.writeHead(400).end('Bad Request');

                    return;
                }

                if (clientResponse === undefined) {
                    for (const listener of requestListeners) {
                        listener.call(httpServer, request, response);
                    }

                    return;
                }

                const headers = new Headers({ host: request.headers.host ?? '' });

                if (request.headers.origin !== undefined) {
                    headers.set('origin', request.headers.origin);
                }

                if (!isAllowedRequest(headers, false)) {
                    response.writeHead(403).end('Forbidden');

                    return;
                }

                clientResponse
                    .arrayBuffer()
                    .then(body => {
                        response.writeHead(
                            clientResponse.status,
                            Object.fromEntries(clientResponse.headers),
                        );
                        response.end(Buffer.from(body));
                    })
                    .catch((error: unknown) => {
                        response.destroy(
                            error instanceof Error ? error : new Error('Client response failed.'),
                        );
                    });
            });
        }
    } catch (error) {
        await server.gracefullyShutdown(false);

        throw error;
    }

    return server;
};
