export type SavedWorldProgress = { readonly worldTimeMs: number };

export const readSavedWorldTime = (value: unknown): number => {
    const isValidTime = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    if (!isValidTime) throw new Error('Solo save contains invalid world time.');

    return value;
};
