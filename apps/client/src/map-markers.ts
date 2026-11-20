import type { WorldPosition } from '@zombi-survive/domain';

import type { MapMarker } from './map-storage';

export const createMapMarkerControls = ({
    form,
    canMark,
    save,
    remove,
    locate,
    signal,
}: {
    readonly form: HTMLFormElement;
    readonly canMark: () => boolean;
    readonly save: (label: string, id: string | null) => MapMarker | null;
    readonly remove: (id: string) => void;
    readonly locate: (position: WorldPosition) => void;
    readonly signal: AbortSignal;
}): {
    setMarkers: (markers: ReadonlyMap<string, MapMarker>) => void;
    updateTarget: () => void;
} => {
    const select = form.querySelector<HTMLSelectElement>('#map-marker-select');
    const labelInput = form.querySelector<HTMLInputElement>('#map-marker-label');
    const saveButton = form.querySelector<HTMLButtonElement>('#map-marker-save');
    const removeButton = form.querySelector<HTMLButtonElement>('#map-marker-remove');
    const status = form.querySelector<HTMLElement>('#map-marker-status');
    if (!select || !labelInput || !saveButton || !removeButton || !status) {
        throw new Error('Map marker controls are missing.');
    }

    let markers: ReadonlyMap<string, MapMarker> = new Map();
    const updateTarget = (): void => {
        saveButton.disabled = select.value === '' && !canMark();
    };
    const renderOptions = (selectedId: string): void => {
        const options = Array.from(markers.values(), marker => new Option(marker.label, marker.id));
        select.replaceChildren(new Option('Новая метка', ''), ...options);
        select.value = selectedId;
        const isEditing = selectedId !== '';
        saveButton.textContent = isEditing ? 'Переименовать' : 'Поставить метку';
        removeButton.hidden = !isEditing;
        updateTarget();
    };
    const onSelect = (): void => {
        const marker = markers.get(select.value);
        labelInput.value = marker?.label ?? '';
        status.textContent = '';
        renderOptions(marker?.id ?? '');
        if (marker !== undefined) locate(marker);
    };
    const onSubmit = (event: SubmitEvent): void => {
        event.preventDefault();
        const label = labelInput.value.trim();
        if (label.length === 0) {
            status.textContent = 'Введите название метки.';
            labelInput.focus();

            return;
        }

        const selectedId = select.value === '' ? null : select.value;
        const marker = save(label, selectedId);
        if (marker === null) return;

        renderOptions(marker.id);
        labelInput.value = marker.label;
        status.textContent = selectedId === null ? 'Метка поставлена.' : 'Название сохранено.';
    };
    const onRemove = (): void => {
        if (select.value === '') return;

        remove(select.value);
        renderOptions('');
        labelInput.value = '';
        status.textContent = 'Метка удалена.';
        select.focus();
    };
    select.addEventListener('change', onSelect, { signal });
    form.addEventListener('submit', onSubmit, { signal });
    removeButton.addEventListener('click', onRemove, { signal });

    return {
        setMarkers: nextMarkers => {
            markers = nextMarkers;
            renderOptions('');
            labelInput.value = '';
            status.textContent = '';
        },
        updateTarget,
    };
};
