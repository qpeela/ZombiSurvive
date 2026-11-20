import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMapStorage } from '../../apps/client/src/map-storage.ts';

const useStorage = (): Map<string, string> => {
    const records = new Map<string, string>();
    vi.stubGlobal('window', {
        localStorage: {
            get length() {
                return records.size;
            },
            key: (index: number) => [...records.keys()][index] ?? null,
            getItem: (key: string) => records.get(key) ?? null,
            setItem: (key: string, value: string) => {
                records.set(key, value);
            },
            removeItem: (key: string) => {
                records.delete(key);
            },
        },
    });

    return records;
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('map storage', () => {
    it('keeps independent records per host and world', () => {
        useStorage();
        const store = createMapStorage('https://host.example');
        store.load('one');
        store.visit('-1,2');
        const marker = { id: '1-2-3-4', label: 'Медпункт', xMeters: -64, yMeters: 128 };
        store.save(marker);

        const sameHost = createMapStorage('https://host.example');
        expect(sameHost.load('two')).toEqual({ visited: new Set(), markers: new Map() });
        expect(createMapStorage('https://other.example').load('one')).toEqual({
            visited: new Set(),
            markers: new Map(),
        });
        const world = sameHost.load('one');
        expect(world.visited).toEqual(new Set(['-1,2']));
        expect(world.markers.get(marker.id)).toEqual(marker);
        sameHost.remove(marker.id);
        expect(store.load('one').markers.size).toBe(0);
    });

    it('ignores corrupt records and keeps the rest of the map available', () => {
        const records = useStorage();
        const host = 'https://host.example';
        const store = createMapStorage(host);
        store.load('one');
        store.visit('0,0');
        const prefix = `zombi-map-v1:${JSON.stringify([host, 'one'])}:`;
        records.set(`${prefix}chunk:2,1`, 'invalid');
        records.set(`${prefix}chunk:2000000,0`, 'visited');
        records.set(`${prefix}marker:1-2-3-4`, '{');
        records.set(`${prefix}marker:2-3-4-5`, '{"label":"invalid","xMeters":"0","yMeters":0}');
        const marker = { id: '5-6-7-8', label: 'Дом', xMeters: 0, yMeters: 0 };
        store.save(marker);

        expect(store.load('one')).toEqual({
            visited: new Set(['0,0']),
            markers: new Map([[marker.id, marker]]),
        });
    });
});
