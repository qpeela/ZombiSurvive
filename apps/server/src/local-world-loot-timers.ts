import { worldLootSettings } from '@zombi-survive/content';
import type { GroundItem, ItemLocation, WorldPosition } from '@zombi-survive/domain';
import type { LootRestock } from '@zombi-survive/protocol';
import { replenishLoot, updateLootRestockTimers } from '@zombi-survive/simulation';

export class LocalWorldLootTimers {
    private readonly points = new Map<string, GroundItem>();
    private committed: ReadonlyMap<string, number>;
    private pending: ReadonlyMap<string, number> | null = null;

    constructor(
        points: readonly GroundItem[] = [],
        saved: ReadonlyMap<string, number> = new Map(),
    ) {
        this.register(points);
        this.committed = new Map(saved);
    }

    register(points: readonly GroundItem[]): void {
        for (const point of points) {
            if (point.kind === 'waterBottle' || point.kind === 'ration') continue;
            if (!this.points.has(point.itemId))
                this.points.set(point.itemId, { ...point, position: { ...point.position } });
        }
    }

    stage(locations: readonly ItemLocation[], worldTimeMs: number): void {
        this.pending =
            updateLootRestockTimers({
                points: [...this.points.values()],
                locations,
                deadlines: this.pending ?? this.committed,
                worldTimeMs,
            }) ?? this.pending;
    }

    replenish(
        locations: readonly ItemLocation[],
        worldTimeMs: number,
    ): readonly ItemLocation[] | null {
        return replenishLoot({
            points: [...this.points.values()],
            locations,
            worldTimeMs,
            deadlines: this.committed,
        });
    }

    pendingSave(): ReadonlyMap<string, number> | null {
        return this.pending === null ? null : new Map(this.pending);
    }

    confirmSave(): void {
        if (this.pending !== null) this.committed = this.pending;
        this.pending = null;
    }

    snapshot(position: WorldPosition): readonly LootRestock[] {
        const restocks: LootRestock[] = [];
        for (const [pointId, readyAtWorldMs] of this.committed) {
            const point = this.points.get(pointId);
            if (point === undefined) continue;
            const distance = Math.hypot(
                point.position.xMeters - position.xMeters,
                point.position.yMeters - position.yMeters,
            );
            if (distance <= worldLootSettings.visibilityMeters)
                restocks.push({
                    pointId,
                    kind: point.kind,
                    position: { ...point.position },
                    readyAtWorldMs,
                });
        }
        const distance = (point: LootRestock) =>
            Math.hypot(
                point.position.xMeters - position.xMeters,
                point.position.yMeters - position.yMeters,
            );
        return restocks
            .sort((first, second) => {
                const difference = distance(first) - distance(second);
                return difference === 0 ? first.pointId.localeCompare(second.pointId) : difference;
            })
            .slice(0, 128);
    }
}
