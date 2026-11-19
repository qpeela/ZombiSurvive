import {
    type DaylightPhase,
    daylightPhases,
    weatherPhases,
    type WorldWeather,
} from '@zombi-survive/content';

import { formatWorldTime } from './world-clock';

type WorldHudState = {
    readonly worldTimeMs: number;
    readonly phase: DaylightPhase;
    readonly weather: WorldWeather;
};

const setText = (element: HTMLElement, text: string): void => {
    if (element.textContent !== text) element.textContent = text;
};

export const createWorldHud = ({
    summary,
    time,
    daylight,
    weather,
    waiting,
    onFocus,
}: {
    readonly summary: HTMLElement;
    readonly time: HTMLElement;
    readonly daylight: HTMLElement;
    readonly weather: HTMLElement;
    readonly waiting: HTMLElement;
    readonly onFocus: () => void;
}): {
    setState: (state: WorldHudState | null) => void;
    dispose: () => void;
} => {
    const onKeyDown = (event: KeyboardEvent): void => {
        event.stopPropagation();
    };
    summary.addEventListener('keydown', onKeyDown);
    summary.addEventListener('focus', onFocus);

    return {
        setState: state => {
            waiting.hidden = state !== null;
            if (state === null) {
                setText(time, 'Время мира: —');
                setText(daylight, 'Освещение: —');
                setText(weather, 'Погода: —');
                delete time.dataset['worldMs'];
                delete daylight.dataset['phase'];
                delete weather.dataset['weather'];

                return;
            }

            const { worldTimeMs, phase, weather: currentWeather } = state;
            time.dataset['worldMs'] = String(worldTimeMs);
            daylight.dataset['phase'] = phase;
            weather.dataset['weather'] = currentWeather;
            setText(time, `Время мира: ${formatWorldTime(worldTimeMs)}`);
            setText(daylight, `Освещение: ${daylightPhases[phase].label}`);
            setText(weather, `Погода: ${weatherPhases[currentWeather].label}`);
        },
        dispose: () => {
            summary.removeEventListener('keydown', onKeyDown);
            summary.removeEventListener('focus', onFocus);
        },
    };
};
