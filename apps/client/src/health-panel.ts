import type { HealthSnapshot } from '@zombi-survive/protocol';

export type HealthStatus = Pick<
    HealthSnapshot,
    'health' | 'maxHealth' | 'bleedingTicks' | 'lifeState'
>;
type Treatment = { readonly state: HealthStatus | null; readonly hasBandage: boolean | null };

export const createHealthPanel = ({
    health,
    bleeding,
    action,
    reason,
}: {
    readonly health: HTMLElement;
    readonly bleeding: HTMLElement;
    readonly action: HTMLButtonElement;
    readonly reason: HTMLElement;
}): { update: (treatment: Treatment) => boolean } => ({
    update: ({ state, hasBandage }) => {
        const hp = state === null ? '—' : `${String(state.health)} / ${String(state.maxHealth)} HP`;
        let wound = '—';
        if (state !== null) wound = state.bleedingTicks > 0 ? 'есть' : 'нет';
        const healthLabel = `Здоровье: ${hp}`;
        const bleedingLabel = `Кровотечение: ${wound}`;
        if (health.textContent !== healthLabel) health.textContent = healthLabel;
        if (bleeding.textContent !== bleedingLabel) bleeding.textContent = bleedingLabel;

        let message = 'Бинт остановит кровотечение. Здоровье не восстановится.';
        const isAvailable =
            state !== null &&
            state.lifeState === 'alive' &&
            state.bleedingTicks > 0 &&
            hasBandage === true;

        if (state === null) message = 'Ожидание данных персонажа…';
        else if (state.lifeState === 'dead') message = 'Персонаж погиб.';
        else if (state.bleedingTicks === 0) message = 'Кровотечения нет.';
        else if (hasBandage === null) message = 'Ожидание данных инвентаря…';
        else if (!hasBandage) message = 'В рюкзаке нет бинта.';

        action.disabled = !isAvailable;
        if (reason.textContent !== message) reason.textContent = message;

        return isAvailable;
    },
});
