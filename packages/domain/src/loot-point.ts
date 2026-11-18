/** Replenished instances keep their source point separate from their owner. */
export const restockPointId = (itemId: string): string | null => {
    const match = /^(.+):restock:(0|[1-9]\d*)$/.exec(itemId);
    if (match === null || !Number.isSafeInteger(Number(match[2]))) return null;

    return match[1] ?? null;
};
