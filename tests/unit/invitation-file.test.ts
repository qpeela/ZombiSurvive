import { readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import { expect, test } from 'vitest';

import { createInvitationFile } from '../../apps/server/src/invitation-file.ts';
import { WorldAccess } from '../../apps/server/src/world-access.ts';

test('invitation files and their directory are private and disappear on cleanup', async () => {
    const access = new WorldAccess(true, 3001);
    const file = await createInvitationFile(access, 'http://192.168.1.5:3001');

    try {
        expect((await stat(file.path)).mode & 0o777).toBe(0o600);
        expect((await stat(dirname(file.path))).mode & 0o777).toBe(0o700);
        const text = await readFile(file.path, 'utf8');
        expect(text).toContain('http://192.168.1.5:3001/#invite=');
        expect(text).toContain(access.invitations[0]);
    } finally {
        await file.cleanup();
    }

    await expect(stat(file.path)).rejects.toThrow();
});
