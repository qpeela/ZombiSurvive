import { findMeleeTarget } from '@zombi-survive/simulation';
import { expect, test } from 'vitest';

const zombie = (id: string, xMeters: number, yMeters = 0) => ({
    zombieId: id,
    position: { xMeters, yMeters },
    targetPlayerId: null,
});
const position = { xMeters: 0, yMeters: 0 };
test('a swing hits one nearest target including exact range, with stable ID ties', () => {
    const first = zombie('a', 1.8);
    expect(findMeleeTarget({ position, zombies: [zombie('b', -1.8), first], obstacles: [] })).toBe(
        first,
    );
    expect(
        findMeleeTarget({ position, zombies: [zombie('far', 1.80001)], obstacles: [] }),
    ).toBeUndefined();
    expect(findMeleeTarget({ position, zombies: [], obstacles: [] })).toBeUndefined();
});
test('a wall blocks melee even inside the attack range', () => {
    expect(
        findMeleeTarget({
            position,
            zombies: [zombie('blocked', 1)],
            obstacles: [
                {
                    id: 'wall',
                    minXMeters: 0.4,
                    maxXMeters: 0.6,
                    minYMeters: -1,
                    maxYMeters: 1,
                },
            ],
        }),
    ).toBeUndefined();
});
