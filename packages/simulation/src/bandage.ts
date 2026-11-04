import type { BleedingState, ItemLocation, PlayerHealth } from '@zombi-survive/domain';

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
        locations: locations.filter(location => location !== bandage),
        player: { ...player, bleedingTicks: 0 },
    };
};
