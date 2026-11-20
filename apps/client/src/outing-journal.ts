import { itemDisplayName } from '@zombi-survive/content';
import type { HealthSnapshot, PickupSnapshot } from '@zombi-survive/protocol';

type JournalHealth = Pick<
    HealthSnapshot,
    'tick' | 'worldId' | 'playerId' | 'lifeRevision' | 'lifeState' | 'health' | 'bleedingTicks'
>;
type JournalInventory = Pick<
    PickupSnapshot,
    'tick' | 'worldId' | 'playerId' | 'items' | 'hands' | 'groundItem' | 'corpses'
>;

const eventLimit = 12;

export const trackOutingEvents = (
    onChange: (events: readonly string[]) => void,
): {
    acceptHealth: (snapshot: JournalHealth) => void;
    acceptInventory: (snapshot: JournalInventory) => void;
    disconnect: () => void;
} => {
    let pendingHealth: JournalHealth | null = null;
    let pendingInventory: JournalInventory | null = null;
    let previous: { health: JournalHealth; inventory: JournalInventory } | null = null;
    let lastLife: JournalHealth | null = null;
    let events: readonly string[] = [];

    const sync = (): void => {
        const health = pendingHealth;
        const inventory = pendingInventory;
        if (
            health === null ||
            inventory === null ||
            health.tick !== inventory.tick ||
            health.worldId !== inventory.worldId ||
            health.playerId !== inventory.playerId ||
            (previous !== null && health.tick <= previous.health.tick)
        ) {
            return;
        }

        const isNewLife =
            lastLife !== null &&
            (lastLife.worldId !== health.worldId ||
                lastLife.playerId !== health.playerId ||
                (lastLife.lifeRevision ?? 0) !== (health.lifeRevision ?? 0) ||
                (lastLife.lifeState === 'dead' && health.lifeState === 'alive'));
        const before = previous;
        previous = { health, inventory };
        lastLife = health;
        if (isNewLife) {
            events = [];
            onChange(events);

            return;
        }
        if (before === null || before.health.lifeState === 'dead') return;

        const newEvents: string[] = [];
        const damage = before.health.health - health.health;
        if (damage > 0) newEvents.push(`Получен урон: ${String(damage)} HP.`);

        if (health.lifeState === 'alive') {
            if (before.health.bleedingTicks > 0 && health.bleedingTicks === 0)
                newEvents.push('Кровотечение остановлено.');

            const previouslyOwnedIds = new Set(before.inventory.items.map(item => item.itemId));
            if (before.inventory.hands !== null)
                previouslyOwnedIds.add(before.inventory.hands.itemId);

            const owned =
                inventory.hands === null ? inventory.items : [...inventory.items, inventory.hands];
            const added = owned.filter(item => !previouslyOwnedIds.has(item.itemId));
            for (const item of added) {
                if (before.inventory.groundItem?.itemId === item.itemId) {
                    newEvents.push(`Подобрано с земли: ${itemDisplayName(item)}.`);
                } else if (
                    before.inventory.corpses?.some(corpse =>
                        corpse.items.some(candidate => candidate.itemId === item.itemId),
                    ) === true
                ) {
                    newEvents.push(`Подобрано с тела: ${itemDisplayName(item)}.`);
                }
            }
        }
        if (newEvents.length === 0) return;

        events = [...newEvents, ...events].slice(0, eventLimit);
        onChange(events);
    };

    return {
        acceptHealth: snapshot => {
            pendingHealth = snapshot;
            sync();
        },
        acceptInventory: snapshot => {
            pendingInventory = snapshot;
            sync();
        },
        disconnect: () => {
            pendingHealth = null;
            pendingInventory = null;
            previous = null;
        },
    };
};

export const createOutingJournal = ({
    list,
    empty,
}: {
    readonly list: HTMLElement;
    readonly empty: HTMLElement;
}): ReturnType<typeof trackOutingEvents> => {
    const render = (events: readonly string[]): void => {
        const rows = events.map(message => {
            const row = document.createElement('li');
            row.textContent = message;

            return row;
        });
        list.replaceChildren(...rows);
        list.hidden = rows.length === 0;
        empty.hidden = rows.length > 0;
    };
    render([]);

    return trackOutingEvents(render);
};
