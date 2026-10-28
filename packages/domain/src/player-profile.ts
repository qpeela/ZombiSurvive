export const defaultDisplayName = 'Выживший';
export const displayNameMaxLength = 24;

/** Names are labels, never identity or authentication credentials. */
export const isDisplayName = (value: unknown): value is string => {
    if (typeof value !== 'string') {
        return false;
    }

    const isLengthValid = value.length >= 1 && value.length <= displayNameMaxLength;
    const isTrimmed = value.trim() === value;
    const hasAllowedCharacters = /^[A-Za-zА-Яа-яЁё0-9 _-]+$/u.test(value);

    return isLengthValid && isTrimmed && hasAllowedCharacters;
};
