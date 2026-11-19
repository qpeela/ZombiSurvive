export type LootSource = { readonly kind: 'ground' | 'corpse'; readonly id: string };

export const isLootInViewport = (
    position: { readonly x: number; readonly y: number },
    viewport: {
        readonly scrollX: number;
        readonly scrollY: number;
        readonly width: number;
        readonly height: number;
    },
): boolean => {
    const { x, y } = position;
    const { scrollX, scrollY, width, height } = viewport;

    return x >= scrollX && x < scrollX + width && y >= scrollY && y < scrollY + height;
};
