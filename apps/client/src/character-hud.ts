import {
    fatigueSettings,
    hungerSettings,
    movementSettings,
    thirstSettings,
    wetnessSettings,
} from '@zombi-survive/content';
import type { PlayerMovementState } from '@zombi-survive/domain';
import { sprintDrainMultiplier, staminaEffectsFromNeeds } from '@zombi-survive/simulation';

type MovementStatus = Pick<
    PlayerMovementState,
    'stamina' | 'isExhausted' | 'carriedWeightGrams' | 'staminaEffects'
>;
type HealthStatus = {
    readonly isBleeding: boolean;
    readonly combatTicks: number;
    readonly thirstMs: number | undefined;
    readonly hungerMs: number | undefined;
    readonly fatigueMs: number | undefined;
    readonly wetnessMs: number | undefined;
};
const recoveryPercent = Math.round(movementSettings.sprintRecoveryThreshold * 100);

const setText = (element: HTMLElement, text: string): void => {
    if (element.textContent !== text) element.textContent = text;
};

const updateNeed = ({
    label,
    name,
    currentMs,
    settings: { maximumMs, noticeableMs },
    effect,
}: {
    readonly label: HTMLElement;
    readonly name: string;
    readonly currentMs: number;
    readonly settings: { readonly maximumMs: number; readonly noticeableMs: number };
    readonly effect: string | undefined;
}): void => {
    label.hidden = currentMs < noticeableMs;
    if (!label.hidden) {
        const percentage = Math.min(100, Math.floor((currentMs * 100) / maximumMs));
        const detail = effect === undefined ? '' : ` · ${effect}`;
        setText(label, `${name}: ${String(percentage)}%${detail}`);
    }
};

export const createCharacterHud = ({
    bleedingLabel,
    combatStatus,
    combatIdle,
    thirstLabel,
    hungerLabel,
    fatigueLabel,
    wetnessLabel,
    stamina,
    staminaLabel,
    loadLabel,
}: {
    readonly bleedingLabel: HTMLElement;
    readonly combatStatus: HTMLElement;
    readonly combatIdle: HTMLElement;
    readonly thirstLabel: HTMLElement;
    readonly hungerLabel: HTMLElement;
    readonly fatigueLabel: HTMLElement;
    readonly wetnessLabel: HTMLElement;
    readonly stamina: HTMLProgressElement;
    readonly staminaLabel: HTMLElement;
    readonly loadLabel: HTMLElement;
}): {
    setMovement: (state: MovementStatus) => void;
    setHealth: (state: HealthStatus) => void;
    reset: () => void;
} => ({
    setMovement: ({ stamina: endurance, isExhausted, carriedWeightGrams = 0, staminaEffects }) => {
        stamina.hidden = false;
        stamina.value = endurance;
        staminaLabel.dataset['exhausted'] = String(isExhausted);
        const percentage = String(Math.round(endurance * 100));
        const recovery = isExhausted
            ? ` · Истощение · Восстановление до ${String(recoveryPercent)}%`
            : '';
        setText(staminaLabel, `Выносливость: ${percentage}%${recovery}`);
        const multiplier = sprintDrainMultiplier(
            carriedWeightGrams,
            staminaEffects?.isDrainIncreased,
        )
            .toFixed(2)
            .replace('.', ',');
        setText(
            loadLabel,
            `Нагрузка: ${String(carriedWeightGrams)} г · Расход спринта: ×${multiplier}`,
        );
    },
    setHealth: ({
        isBleeding,
        combatTicks,
        thirstMs = 0,
        hungerMs = 0,
        fatigueMs = 0,
        wetnessMs = 0,
    }) => {
        const { isDrainIncreased, isRecoverySlowed, maximumStamina } = staminaEffectsFromNeeds({
            thirstMs,
            hungerMs,
            fatigueMs,
        });
        updateNeed({
            label: thirstLabel,
            name: 'Жажда',
            currentMs: thirstMs,
            settings: thirstSettings,
            effect: isDrainIncreased ? 'Спринт быстрее тратит выносливость' : undefined,
        });
        updateNeed({
            label: hungerLabel,
            name: 'Голод',
            currentMs: hungerMs,
            settings: hungerSettings,
            effect: isRecoverySlowed ? 'Выносливость восстанавливается медленнее' : undefined,
        });
        updateNeed({
            label: fatigueLabel,
            name: 'Усталость',
            currentMs: fatigueMs,
            settings: fatigueSettings,
            effect:
                maximumStamina === undefined
                    ? undefined
                    : `Максимум выносливости ${String(Math.round(maximumStamina * 100))}%`,
        });
        updateNeed({
            label: wetnessLabel,
            name: 'Намокание',
            currentMs: wetnessMs,
            settings: wetnessSettings,
            effect: undefined,
        });
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
        fatigueLabel.hidden = true;
        wetnessLabel.hidden = true;
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
