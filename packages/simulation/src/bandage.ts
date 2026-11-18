import { medicalOutpost } from '@zombi-survive/content';
import {
    type BleedingState,
    type ItemLocation,
    type PlayerHealth,
    restockPointId,
} from '@zombi-survive/domain';

type BandageInput = {
    readonly locations: readonly ItemLocation[];
    readonly player: PlayerHealth & BleedingState;
    readonly itemId: string;
};

/** A concrete owned item is consumed once; no health is restored. */
export const useBandage = ({
    locations,
    player,
    itemId,
}: BandageInput): {
    readonly locations: readonly ItemLocation[];
    readonly player: PlayerHealth & BleedingState;
} => {
    const isWoundedAndAlive = player.health > 0 && player.bleedingTicks > 0;
    const bandage = locations.find(location => {
        const isOwned = location.type === 'container' && location.playerId === player.playerId;
        const isBandage = location.item.kind === 'bandage' && location.item.itemId === itemId;

        return isOwned && isBandage;
    });

    if (!isWoundedAndAlive || bandage === undefined) {
        return { locations, player };
    }

    return {
        locations: locations.flatMap(location => {
            if (location !== bandage) return [location];

            const pointId = restockPointId(itemId) ?? itemId;
            // Keep durable world instances in the manifest, just like spent ammo packs.
            return pointId === medicalOutpost.bandageItemId
                ? [{ type: 'consumed' as const, item: { itemId, kind: 'bandage' as const } }]
                : [];
        }),
        player: { ...player, bleedingTicks: 0 },
    };
};
