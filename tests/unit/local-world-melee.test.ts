import { combatSettings } from '@zombi-survive/content';
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
    const command = (session: string, type: 'equip-club' | 'melee-attack') => {
        melee.receive(session, { type, protocolVersion, meleeVersion });
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
    command('first', 'equip-club');
    step();
    expect(isMeleeSnapshot(melee.snapshot(movement.snapshot('first')))).toBe(true);
    expect(melee.snapshot(movement.snapshot('tab')).weapon).toBe('club');
    expect(melee.snapshot(movement.snapshot('friend')).weapon).toBeNull();
    command('tab', 'melee-attack');
    step();
    expect(damage).toHaveBeenCalledExactlyOnceWith('zombie');
});
test('spam, duplicate tabs and reconnect cannot bypass the shared cooldown', () => {
    const { melee, command, step, damage } = setup();
    command('first', 'equip-club');
    step();
    for (let tick = 0; tick <= combatSettings.meleeCooldownTicks; tick++) {
        for (let repeat = 0; repeat < 30; repeat++) command('first', 'melee-attack');
        command('tab', 'melee-attack');
        if (tick === 1) melee.leave('first');
        step();
    }
    expect(damage).toHaveBeenCalledTimes(2);
});
test('disconnect discards pending attacks, zero HP and forged commands cannot hit', () => {
    const { melee, command, step, damage, health } = setup();
    command('first', 'equip-club');
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
    command('first', 'equip-club');
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
    for (let tick = 0; tick < combatSettings.meleeCooldownTicks - 1; tick++) step();
    command('first', 'melee-attack');
    step();
    expect(damage).toHaveBeenCalledOnce();
});
