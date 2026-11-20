import type { WorldPosition } from '@zombi-survive/domain';

export type MapMarker = WorldPosition & { readonly id: string; readonly label: string };

type MapRecords = {
    readonly visited: Set<string>;
    readonly markers: Map<string, MapMarker>;
};

const isChunkId = (id: string): boolean => {
    const coordinates = id.split(',').map(Number);
    const isCanonical = coordinates.length === 2 && coordinates.join(',') === id;

    return (
        isCanonical &&
        coordinates.every(value => Number.isSafeInteger(value) && Math.abs(value) <= 1_000_000)
    );
};

const readMarker = (id: string, raw: string): MapMarker | undefined => {
    if (!/^\d{1,10}(?:-\d{1,10}){3}$/.test(id)) return;

    try {
        const value: unknown = JSON.parse(raw);
        if (typeof value !== 'object' || value === null) return;

        const marker = value as Record<string, unknown>;
        const { label, xMeters, yMeters } = marker;
        const isValidLabel =
            typeof label === 'string' && label.trim().length > 0 && label.length <= 40;
        const isValidX = typeof xMeters === 'number' && Number.isFinite(xMeters);
        const isValidY = typeof yMeters === 'number' && Number.isFinite(yMeters);
        if (!isValidLabel || !isValidX || !isValidY) return;

        return { id, label, xMeters, yMeters };
    } catch {
        return undefined;
    }
};

export const createMapStorage = (
    host: string,
): {
    load: (worldId: string) => MapRecords;
    visit: (chunk: string) => void;
    save: (marker: MapMarker) => void;
    remove: (id: string) => void;
} => {
    let prefix = '';
    const withStorage = (action: (storage: Storage) => void): void => {
        try {
            action(window.localStorage);
        } catch {
            // A blocked or full store leaves the current tab's map usable.
        }
    };

    return {
        load: worldId => {
            prefix = `zombi-map-v1:${JSON.stringify([host, worldId])}:`;
            const visited = new Set<string>();
            const markers = new Map<string, MapMarker>();
            withStorage(storage => {
                for (let index = 0; index < storage.length; index++) {
                    const key = storage.key(index);
                    if (key === null || !key.startsWith(prefix)) continue;

                    const entry = key.slice(prefix.length);
                    const raw = storage.getItem(key);
                    if (entry.startsWith('chunk:') && raw === 'visited') {
                        const id = entry.slice('chunk:'.length);
                        if (isChunkId(id)) visited.add(id);
                    }
                    if (entry.startsWith('marker:') && raw !== null) {
                        const marker = readMarker(entry.slice('marker:'.length), raw);
                        if (marker !== undefined) markers.set(marker.id, marker);
                    }
                }
            });

            return { visited, markers };
        },
        visit: chunk => {
            withStorage(storage => {
                storage.setItem(`${prefix}chunk:${chunk}`, 'visited');
            });
        },
        save: ({ id, label, xMeters, yMeters }) => {
            withStorage(storage => {
                storage.setItem(
                    `${prefix}marker:${id}`,
                    JSON.stringify({ label, xMeters, yMeters }),
                );
            });
        },
        remove: id => {
            withStorage(storage => {
                storage.removeItem(`${prefix}marker:${id}`);
            });
        },
    };
};
