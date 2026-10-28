import { meleeWeapons, movementSettings } from '@zombi-survive/content';
import type { MeleeWeaponId } from '@zombi-survive/domain';
import { type MeleeAction, meleeVersion, protocolVersion } from '@zombi-survive/protocol';
import { expect, test } from 'vitest';

import { MeleeAnimation } from '../../apps/client/src/melee-animation.ts';

const action = (weapon: MeleeWeaponId, tick = 10): MeleeAction => ({
    type: 'melee-action',
    worldId: 'world',
    playerId: 'player',
    tick,
    weapon,
    protocolVersion,
    meleeVersion,
});

test.each(['club', 'knife', 'crowbar', 'axe'] as const)(
    '%s animates preparation, strike and return within its server cooldown',
    weapon => {
        const animation = new MeleeAnimation();
        animation.setWeapon(weapon);
        expect(animation.advance(0).phase).toBe('idle');
        expect(animation.accept(action(weapon))).toBe(true);
        const durationMs =
            (meleeWeapons[weapon].cooldownTicks / movementSettings.ticksPerSecond) * 1000;
        expect(animation.advance(durationMs * 0.1).phase).toBe('prepare');
        const strike = animation.advance(durationMs * 0.3);
        expect(strike.phase).toBe('strike');
        if (weapon === 'knife') {
            expect(strike.reach).toBeGreaterThan(0);
            expect(strike.rotation).toBe(0);
        } else {
            expect(strike.rotation).toBeGreaterThan(0);
            expect(strike.reach).toBe(0);
        }
        expect(animation.advance(durationMs * 0.3).phase).toBe('return');
        expect(animation.advance(durationMs).phase).toBe('idle');
    },
);

test('duplicates do not rewind a swing; switch, disconnect and cleanup cancel it', () => {
    const animation = new MeleeAnimation();
    animation.setWeapon('axe');
    animation.accept(action('axe'));
    const pose = animation.advance(500);
    expect(animation.accept(action('axe'))).toBe(false);
    expect(animation.accept(action('axe', 9))).toBe(false);
    expect(animation.advance(0)).toEqual(pose);
    animation.setWeapon('knife');
    expect(animation.advance(0).phase).toBe('idle');
    expect(animation.accept(action('axe', 11))).toBe(false);
    expect(animation.accept(action('knife', 11))).toBe(true);
    animation.setWeapon(null);
    expect(animation.advance(0).phase).toBe('idle');
    animation.setWeapon('knife');
    expect(animation.advance(0).phase).toBe('idle');
});
