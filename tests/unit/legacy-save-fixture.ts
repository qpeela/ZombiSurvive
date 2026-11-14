import type { DatabaseSync } from 'node:sqlite';

/** New-store fixtures must remove the later overlays when recreating v4–v9. */
export const removePistolForLegacySave = (database: DatabaseSync): void => {
    const raw = database.prepare('SELECT item_location FROM solo_world WHERE id = 1').get()?.[
        'item_location'
    ];
    if (typeof raw !== 'string') throw new Error('Missing legacy fixture manifest.');
    const locations: unknown = JSON.parse(raw);
    if (!Array.isArray(locations)) throw new Error('Expected an array fixture manifest.');
    const legacy = (locations as unknown[]).filter(entry => {
        if (typeof entry !== 'object' || entry === null || !('item' in entry)) return true;
        const item = entry.item;
        if (typeof item !== 'object' || item === null || !('kind' in item)) return true;
        return item.kind !== 'pistol' && item.kind !== 'ammo9mm';
    });
    database
        .prepare('UPDATE solo_world SET item_location = ? WHERE id = 1')
        .run(JSON.stringify(legacy));
};
