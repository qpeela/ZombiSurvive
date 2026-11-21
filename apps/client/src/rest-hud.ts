import type { RestCancellation, RestState } from '@zombi-survive/protocol';

const cancellationText: Readonly<Record<RestCancellation, string>> = {
    movement: 'Передышка прервана из-за движения.',
    damage: 'Передышка прервана после получения урона.',
    control: 'Передышка прервана из-за потери управления.',
};

export const createRestHud =
    ({
        chip,
        label,
        progress,
    }: {
        readonly chip: HTMLElement;
        readonly label: HTMLElement;
        readonly progress: HTMLProgressElement;
    }): ((rest?: RestState) => void) =>
    rest => {
        chip.hidden = rest === undefined || rest.state === 'idle';
        progress.hidden = rest?.state !== 'resting';
        let text = '';

        if (rest?.state === 'resting') {
            progress.max = rest.durationWorldMs;
            progress.value = rest.elapsedWorldMs;
            text = 'Передышка…';
        } else if (rest?.state === 'completed') {
            text = 'Передышка завершена.';
        } else if (rest?.state === 'cancelled') {
            text = cancellationText[rest.reason];
        }

        if (label.textContent !== text) label.textContent = text;
    };
