import { hungerSettings, movementSettings, thirstSettings } from '@zombi-survive/content';
import type { PlayerMovementState } from '@zombi-survive/domain';
import { sprintDrainMultiplier } from '@zombi-survive/simulation';

type MovementStatus = Pick<PlayerMovementState, 'stamina' | 'isExhausted' | 'carriedWeightGrams'>;
type HealthStatus = {
    readonly isBleeding: boolean;
    readonly combatTicks: number;
    readonly thirstMs: number | undefined;
    readonly hungerMs: number | undefined;
};
const recoveryPercent = Math.round(movementSettings.sprintRecoveryThreshold * 100);

const setText = (element: HTMLElement, text: string): void => {
    if (element.textContent !== text) element.textContent = text;
};

const updateNeed = (
    label: HTMLElement,
    name: string,
    currentMs: number,
    { maximumMs, noticeableMs }: { readonly maximumMs: number; readonly noticeableMs: number },
): void => {
    label.hidden = currentMs < noticeableMs;
    if (!label.hidden) {
        const percentage = Math.min(100, Math.floor((currentMs * 100) / maximumMs));
        setText(label, `${name}: ${String(percentage)}%`);
    }
};

export const createCharacterHud = ({
    bleedingLabel,
    combatStatus,
    combatIdle,
    thirstLabel,
    hungerLabel,
    stamina,
    staminaLabel,
    loadLabel,
}: {
    readonly bleedingLabel: HTMLElement;
    readonly combatStatus: HTMLElement;
    readonly combatIdle: HTMLElement;
    readonly thirstLabel: HTMLElement;
    readonly hungerLabel: HTMLElement;
    readonly stamina: HTMLProgressElement;
    readonly staminaLabel: HTMLElement;
    readonly loadLabel: HTMLElement;
}): {
    setMovement: (state: MovementStatus) => void;
    setHealth: (state: HealthStatus) => void;
    reset: () => void;
} => ({
    setMovement: ({ stamina: endurance, isExhausted, carriedWeightGrams = 0 }) => {
        stamina.hidden = false;
        stamina.value = endurance;
        staminaLabel.dataset['exhausted'] = String(isExhausted);
        const percentage = String(Math.round(endurance * 100));
        const recovery = isExhausted
            ? ` · Истощение · Восстановление до ${String(recoveryPercent)}%`
            : '';
        setText(staminaLabel, `Выносливость: ${percentage}%${recovery}`);
        const multiplier = sprintDrainMultiplier(carriedWeightGrams).toFixed(2).replace('.', ',');
        setText(
            loadLabel,
            `Нагрузка: ${String(carriedWeightGrams)} г · Расход спринта: ×${multiplier}`,
        );
    },
    setHealth: ({ isBleeding, combatTicks, thirstMs = 0, hungerMs = 0 }) => {
        updateNeed(thirstLabel, 'Жажда', thirstMs, thirstSettings);
        updateNeed(hungerLabel, 'Голод', hungerMs, hungerSettings);
        setText(bleedingLabel, isBleeding ? 'Кровотечение: есть' : 'Кровотечение: нет');
        bleedingLabel.dataset['bleeding'] = String(isBleeding);
        const isInCombat = combatTicks > 0;
        combatStatus.hidden = !isInCombat;
        combatStatus.dataset['remainingTicks'] = String(combatTicks);
        combatIdle.hidden = isInCombat;
        setText(combatIdle, 'Вне боя');
    },
    reset: () => {
        thirstLabel.hidden = true;
        hungerLabel.hidden = true;
        setText(bleedingLabel, 'Кровотечение: —');
        delete bleedingLabel.dataset['bleeding'];
        combatStatus.hidden = true;
        delete combatStatus.dataset['remainingTicks'];
        setText(combatIdle, 'Бой: —');
        combatIdle.hidden = false;
        stamina.hidden = true;
        stamina.value = 0;
        delete staminaLabel.dataset['exhausted'];
        setText(staminaLabel, 'Выносливость: —');
        setText(loadLabel, 'Нагрузка: —');
    },
});
