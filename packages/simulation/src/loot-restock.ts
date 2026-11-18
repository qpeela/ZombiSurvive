import { ammoSettings, lootRestockSettings } from '@zombi-survive/content';
import { type GroundItem, type ItemLocation, restockPointId } from '@zombi-survive/domain';

/** A stable point uses its original manifest ID, independently of its current owner. */
export const updateLootRestockTimers = ({
    points,
    locations,
    deadlines,
    worldTimeMs,
}: {
    readonly points: readonly GroundItem[];
    readonly locations: readonly ItemLocation[];
    readonly deadlines: ReadonlyMap<string, number>;
    readonly worldTimeMs: number;
}): ReadonlyMap<string, number> | null => {
    const isValidTime = Number.isSafeInteger(worldTimeMs) && worldTimeMs >= 0;
    if (!isValidTime) throw new RangeError('Invalid restock world time.');
    const occupied = new Set(
        locations
            .filter(location => location.type === 'ground')
            .map(location => restockPointId(location.item.itemId) ?? location.item.itemId),
    );
    let next: Map<string, number> | null = null;
    for (const point of points) {
        const pointId = point.itemId;
        if (occupied.has(pointId)) {
            if (deadlines.has(pointId)) {
                next ??= new Map(deadlines);
                next.delete(pointId);
            }
            continue;
        }
        if (deadlines.has(pointId)) continue;
        const deadline = worldTimeMs + lootRestockSettings.periodWorldMs;
        if (!Number.isSafeInteger(deadline)) throw new RangeError('Restock timer limit reached.');
        next ??= new Map(deadlines);
        next.set(pointId, deadline);
    }
    return next;
};

/** A missed period produces one pack, never a backlog of accumulated stock. */
export const replenishAmmo = ({
    points,
    locations,
    deadlines,
    worldTimeMs,
}: {
    readonly points: readonly GroundItem[];
    readonly locations: readonly ItemLocation[];
    readonly deadlines: ReadonlyMap<string, number>;
    readonly worldTimeMs: number;
}): readonly ItemLocation[] | null => {
    const occupied = new Set(
        locations
            .filter(location => location.type === 'ground')
            .map(location => restockPointId(location.item.itemId) ?? location.item.itemId),
    );
    const additions: ItemLocation[] = [];
    for (const point of points) {
        if (point.kind !== 'ammo9mm' || occupied.has(point.itemId)) continue;

        const deadline = deadlines.get(point.itemId);
        if (deadline === undefined || deadline > worldTimeMs) continue;

        const itemId = `${point.itemId}:restock:${String(deadline)}`;
        if (locations.some(location => location.item.itemId === itemId))
            throw new Error('Restock instance already exists for an empty point.');

        additions.push({
            type: 'ground',
            item: {
                itemId,
                kind: 'ammo9mm',
                quantity: ammoSettings.stackQuantity,
                position: { ...point.position },
            },
        });
    }

    return additions.length === 0 ? null : [...locations, ...additions];
};
