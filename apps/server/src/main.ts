import { fileURLToPath } from 'node:url';

import { readHostAddress } from './host-address.ts';
import { createInvitationFile } from './invitation-file.ts';
import { startLocalServer } from './local-server.ts';
import { SoloWorldStore } from './solo-world-store.ts';
import { WorldAccess } from './world-access.ts';

const port = Number(process.env['PORT'] ?? '3001');
const isIntegerPort = Number.isInteger(port);
const isPortInRange = port > 0 && port <= 65535;

if (!isIntegerPort || !isPortInRange) {
    throw new Error('PORT must be an integer between 1 and 65535.');
}

const isDevelopment = process.argv.includes('--dev');
const host = readHostAddress(process.env['COOP_HOST'], undefined, process.env['COOP_NETWORK']);
const isCooperative = host !== '127.0.0.1';

if (isDevelopment && isCooperative) {
    throw new Error(
        'Co-op requires the built game. Use npm run build and COOP_HOST=<interface IPv4> npm start.',
    );
}

const serverOrigin = `http://${host}:${String(port)}`;
const defaultClientOrigin = isDevelopment ? 'http://127.0.0.1:5173' : serverOrigin;
const soloStore = isCooperative
    ? undefined
    : new SoloWorldStore(
          process.env['WORLD_SAVE_PATH'] ??
              fileURLToPath(new URL('../../../.local/solo.sqlite', import.meta.url)),
      );
const access = new WorldAccess(isCooperative, port, Date.now(), soloStore?.initialWorld.playerId);
const invitationFile = isCooperative ? await createInvitationFile(access, serverOrigin) : null;
const server = await startLocalServer(
    port,
    process.env['CLIENT_ORIGIN'] ?? defaultClientOrigin,
    isDevelopment ? undefined : new URL('../../client/dist/', import.meta.url),
    { host, access, ...(soloStore === undefined ? {} : { soloStore }) },
).catch(async (error: unknown) => {
    soloStore?.close();
    await invitationFile?.cleanup();

    throw error;
});
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
    server
        .gracefullyShutdown(false)
        .then(() => invitationFile?.cleanup())
        .catch(onError);
};

process.once('SIGINT', onShutdown);
process.once('SIGTERM', onShutdown);
process.stdout.write(`Local world ready at ${serverOrigin}/\n`);

if (invitationFile !== null) {
    process.stdout.write(`Invitations file: ${invitationFile.path}\n`);
}
