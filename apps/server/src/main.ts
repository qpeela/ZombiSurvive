import { createHttpServer } from './http-server.ts';

const port = Number(process.env['PORT'] ?? '3001');
const isIntegerPort = Number.isInteger(port);
const isPortInRange = port > 0 && port <= 65535;

if (!isIntegerPort || !isPortInRange) {
    throw new Error('PORT must be an integer between 1 and 65535.');
}

const server = createHttpServer();
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
    server.close(error => {
        if (error) {
            onError(error);
        }
    });
};

server.on('error', onError);
process.once('SIGINT', onShutdown);
process.once('SIGTERM', onShutdown);
server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`Server ready at http://127.0.0.1:${String(port)}/health\n`);
});
