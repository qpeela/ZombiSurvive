import { meleeWeapons } from '@zombi-survive/content';
import type { MeleeWeaponId } from '@zombi-survive/domain';
import { isMeleeSnapshot, meleeVersion, protocolVersion } from '@zombi-survive/protocol';
import { expect, test, vi } from 'vitest';

import { LocalWorldMelee } from '../../apps/server/src/local-world-melee.ts';
import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';

const setup = () => {
    const melee = new LocalWorldMelee();
    const movement = new LocalWorldMovement('world', 'solo');
    movement.join('first');
    movement.join('tab');
    movement.join('friend', 'friend');
    const damage = vi.fn();
    const health = vi.fn(() => 100);
    const zombies = [
        { zombieId: 'zombie', position: { xMeters: 1, yMeters: 0 }, targetPlayerId: null },
    ];
    const command = (
        session: string,
        type: 'equip-weapon' | 'melee-attack',
        weapon: MeleeWeaponId = 'club',
    ) => {
        melee.receive(session, { type, weapon, protocolVersion, meleeVersion });
    };
    const step = () => {
        movement.step();
        melee.step({
            snapshots: new Map(['first', 'tab', 'friend'].map(id => [id, movement.snapshot(id)])),
            zombies,
            obstacles: [],
            damage,
            health,
        });
    };
    return { melee, movement, damage, health, zombies, command, step };
};
test('equipment is server-owned, shared across tabs, and required to hit', () => {
    const { melee, movement, command, step, damage } = setup();
    command('first', 'melee-attack');
    step();
    expect(damage).not.toHaveBeenCalled();
    command('first', 'equip-weapon');
    step();
    expect(isMeleeSnapshot(melee.snapshot(movement.snapshot('first')))).toBe(true);
    expect(melee.snapshot(movement.snapshot('tab')).weapon).toBe('club');
    expect(melee.snapshot(movement.snapshot('friend')).weapon).toBeNull();
    command('tab', 'melee-attack');
    step();
    expect(damage).toHaveBeenCalledExactlyOnceWith('zombie', 34);
});
test('spam, duplicate tabs and reconnect cannot bypass the shared cooldown', () => {
    const { melee, command, step, damage } = setup();
    command('first', 'equip-weapon');
    step();
    for (let tick = 0; tick <= meleeWeapons.club.cooldownTicks; tick++) {
        for (let repeat = 0; repeat < 30; repeat++) command('first', 'melee-attack');
        command('tab', 'melee-attack');
        if (tick === 1) melee.leave('first');
        step();
    }
    expect(damage).toHaveBeenCalledTimes(2);
});
test('disconnect discards pending attacks, zero HP and forged commands cannot hit', () => {
    const { melee, command, step, damage, health } = setup();
    command('first', 'equip-weapon');
    step();
    command('first', 'melee-attack');
    melee.leave('first');
    step();
    melee.receive('first', { type: 'melee-attack', protocolVersion: 4, meleeVersion });
    step();
    command('unknown', 'melee-attack');
    step();
    health.mockReturnValue(0);
    command('first', 'melee-attack');
    step();
    expect(damage).not.toHaveBeenCalled();
});

test('a miss consumes the cooldown and cannot hit after an immediate move into range', () => {
    const { command, step, damage, zombies } = setup();
    command('first', 'equip-weapon');
    step();
    const zombie = zombies[0];
    if (zombie === undefined) throw new Error('Missing test zombie.');
    zombie.position.xMeters = 5;
    command('first', 'melee-attack');
    step();
    expect(damage).not.toHaveBeenCalled();
    zombie.position.xMeters = 1;
    command('first', 'melee-attack');
    step();
    expect(damage).not.toHaveBeenCalled();
    for (let tick = 0; tick < meleeWeapons.club.cooldownTicks - 1; tick++) step();
    command('first', 'melee-attack');
    step();
    expect(damage).toHaveBeenCalledOnce();
});

test.each([
    ['club', 34, 12],
    ['knife', 20, 6],
    ['crowbar', 40, 16],
    ['axe', 60, 24],
] as const)('%s uses server damage and cooldown across tabs', (weapon, amount, cooldown) => {
    const { melee, movement, command, step, damage } = setup();
    command('first', 'equip-weapon', weapon);
    step();
    expect(melee.snapshot(movement.snapshot('tab')).weapon).toBe(weapon);
    command('tab', 'melee-attack');
    step();
    expect(damage).toHaveBeenCalledExactlyOnceWith('zombie', amount);
    for (let tick = 1; tick < cooldown; tick++) {
        command('first', 'melee-attack');
        command('tab', 'melee-attack');
        step();
        expect(damage).toHaveBeenCalledTimes(1);
    }
    command('tab', 'melee-attack');
    step();
    expect(damage).toHaveBeenCalledTimes(2);
});

test('switching to a faster weapon and reconnecting preserve the previous swing cooldown', () => {
    const { melee, movement, command, step, damage } = setup();
    command('first', 'equip-weapon', 'axe');
    step();
    command('first', 'melee-attack');
    step(); // tick 2: axe, next swing at 26
    melee.leave('first');
    command('tab', 'equip-weapon', 'knife');
    step();
    expect(melee.snapshot(movement.snapshot('first')).weapon).toBe('knife');
    for (let tick = 4; tick < 26; tick++) {
        command('tab', 'melee-attack');
        step();
    }
    expect(damage).toHaveBeenCalledExactlyOnceWith('zombie', 60);
    command('first', 'melee-attack');
    step();
    expect(damage).toHaveBeenLastCalledWith('zombie', 20);
    expect(damage).toHaveBeenCalledTimes(2);
});

test('forged equipment and damage cannot override server rules; zero HP blocks switching', () => {
    const { melee, movement, command, step, damage, health } = setup();
    command('first', 'equip-weapon', 'knife');
    step();
    melee.receive('first', {
        type: 'equip-weapon',
        weapon: 'gun',
        protocolVersion,
        meleeVersion,
    });
    step();
    expect(melee.snapshot(movement.snapshot('tab')).weapon).toBe('knife');
    melee.receive('first', {
        type: 'melee-attack',
        weapon: 'axe',
        damage: 999,
        rangeMeters: 999,
        protocolVersion,
        meleeVersion,
    });
    step();
    expect(damage).toHaveBeenCalledExactlyOnceWith('zombie', 20);
    health.mockReturnValue(0);
    command('tab', 'equip-weapon', 'axe');
    step();
    expect(melee.snapshot(movement.snapshot('first')).weapon).toBe('knife');
    command('tab', 'melee-attack');
    step();
    expect(damage).toHaveBeenCalledTimes(1);
});
