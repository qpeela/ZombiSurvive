import { createInvitationFile } from '../../apps/server/dist/invitation-file.js';
import { startLocalServer } from '../../apps/server/dist/local-server.js';
import { WorldAccess } from '../../apps/server/dist/world-access.js';

// Exercise co-op authentication on loopback in CI without requiring a LAN interface.
const access = new WorldAccess(true, 3105);
const invitations = await createInvitationFile(access, 'http://127.0.0.1:3105');
const server = await startLocalServer(
    3105,
    'http://127.0.0.1:3105',
    new URL('../../apps/client/dist/', import.meta.url),
    { access },
);
let isStopping = false;
const shutdown = () => {
    if (isStopping) {
        return;
    }

    isStopping = true;
    server
        .gracefullyShutdown(false)
        .then(invitations.cleanup)
        .catch(() => {
            process.exitCode = 1;
        });
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
process.stdout.write(`Invitations file: ${invitations.path}\n`);
