import { displayNameMaxLength, isDisplayName } from '@zombi-survive/domain';
import type { ProfileResult, ProfileSnapshot } from '@zombi-survive/protocol';

export const createPlayerProfileControls = (options: {
    readonly form: HTMLFormElement;
    readonly input: HTMLInputElement;
    readonly button: HTMLButtonElement;
    readonly message: HTMLElement;
    readonly label: HTMLElement;
    readonly rename: (displayName: string) => Promise<ProfileResult>;
}): { update: (profile: ProfileSnapshot | null) => void; dispose: () => void } => {
    const { form, input, button, message, label, rename } = options;
    let profile: ProfileSnapshot | null = null;
    let isDirty = false;
    let isPending = false;
    let generation = 0;
    const refresh = (): void => {
        input.disabled = profile === null || isPending;
        button.disabled = profile === null || isPending;
        label.textContent = profile === null ? 'Имя: —' : `Имя: ${profile.displayName}`;
    };
    const update = (value: ProfileSnapshot | null): void => {
        profile = value;

        if (value === null) {
            generation++;
            isDirty = false;
            isPending = false;
            input.value = '';
            message.textContent = '';
        } else if (!isDirty) {
            input.value = value.displayName;
        }

        refresh();
    };
    const onInput = (): void => {
        isDirty = true;
        message.textContent = '';
    };
    const onSubmit = (event: SubmitEvent): void => {
        event.preventDefault();

        if (profile === null || isPending) {
            return;
        }

        const displayName = input.value.trim();

        if (!isDisplayName(displayName)) {
            message.textContent = `Имя: 1–${String(displayNameMaxLength)} символа — русские/латинские буквы, цифры, пробел, дефис, _.`;

            return;
        }

        const attempt = generation;
        isPending = true;
        message.textContent = 'Сохраняем имя…';
        refresh();
        rename(displayName)
            .then(result => {
                if (attempt !== generation) {
                    return;
                }

                if (result.status === 'saved') {
                    isDirty = false;
                    input.value = profile?.displayName ?? '';
                    message.textContent = 'Имя сохранено у хоста.';
                } else {
                    message.textContent =
                        result.status === 'invalid'
                            ? 'Хост отклонил имя. Проверьте длину и символы.'
                            : 'Не удалось сохранить имя у хоста. Попробуйте снова.';
                }
            })
            .catch(() => {
                if (attempt === generation) {
                    message.textContent =
                        'Не удалось подтвердить сохранение. Проверьте связь и повторите.';
                }
            })
            .finally(() => {
                if (attempt === generation) {
                    isPending = false;
                    refresh();
                }
            });
    };
    input.maxLength = displayNameMaxLength;
    input.addEventListener('input', onInput);
    form.addEventListener('submit', onSubmit);
    refresh();

    return {
        update,
        dispose: () => {
            generation++;
            input.removeEventListener('input', onInput);
            form.removeEventListener('submit', onSubmit);
        },
    };
};
