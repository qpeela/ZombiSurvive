import { startLocalServer } from './local-server.ts';

const port = Number(process.env['PORT'] ?? '3001');
const isIntegerPort = Number.isInteger(port);
const isPortInRange = port > 0 && port <= 65535;

if (!isIntegerPort || !isPortInRange) {
    throw new Error('PORT must be an integer between 1 and 65535.');
}

const isDevelopment = process.argv.includes('--dev');
const serverOrigin = `http://127.0.0.1:${String(port)}`;
const defaultClientOrigin = isDevelopment ? 'http://127.0.0.1:5173' : serverOrigin;
const server = await startLocalServer(
    port,
    process.env['CLIENT_ORIGIN'] ?? defaultClientOrigin,
    isDevelopment ? undefined : new URL('../../client/dist/', import.meta.url),
);
let isShuttingDown = false;

const onError = (error: Error): void => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
};

const onShutdown = (): void => {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;
    server.gracefullyShutdown(false).catch(onError);
};

process.once('SIGINT', onShutdown);
process.once('SIGTERM', onShutdown);
process.stdout.write(`Local world ready at ${serverOrigin}/\n`);
