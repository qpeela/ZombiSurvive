import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { WorldAccess } from './world-access.ts';

export const createInvitationFile = async (
    access: WorldAccess,
    origin: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> => {
    const directory = await mkdtemp(join(tmpdir(), 'zombi-invitations-'));
    const path = join(directory, 'invitations.json');
    const cleanup = (): Promise<void> => rm(directory, { recursive: true, force: true });

    try {
        await writeFile(
            path,
            JSON.stringify(
                {
                    explanation:
                        'Одноразовые приглашения действуют 30 минут. Одна ссылка на участника. Не публикуйте файл целиком.',
                    invitations: access.invitations.map((invitation, index) => ({
                        participant: index === 0 ? 'Хост' : `Друг ${String(index)}`,
                        url: `${origin}/#invite=${invitation}`,
                    })),
                },
                null,
                2,
            ) + '\n',
            { mode: 0o600, flag: 'wx' },
        );
    } catch (error) {
        await cleanup();

        throw error;
    }

    return { path, cleanup };
};
