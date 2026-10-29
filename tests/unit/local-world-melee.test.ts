import { meleeWeapons } from '@zombi-survive/content';
import type { MeleeWeaponId, WorldObstacle } from '@zombi-survive/domain';
import { isMeleeSnapshot, meleeVersion, protocolVersion } from '@zombi-survive/protocol';
import { expect, test, vi } from 'vitest';

import { LocalWorldMelee } from '../../apps/server/src/local-world-melee.ts';
import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';
import { LocalWorldPickup } from '../../apps/server/src/local-world-pickup.ts';

const setup = () => {
    const pickup = new LocalWorldPickup();
    pickup.initializePlayer('solo');
    pickup.initializePlayer('friend');
    const melee = new LocalWorldMelee(snapshot => pickup.weapon(snapshot));
    const movement = new LocalWorldMovement('world', 'solo');
    movement.join('first');
    movement.join('tab');
    movement.join('friend', 'friend');
    const damage = vi.fn(
        (_id: string, amount: number): { damage: number; isKilled: boolean } | null => ({
            damage: amount,
            isKilled: false,
        }),
    );
    const obstacles: WorldObstacle[] = [];
    const health = vi.fn(() => 100);
    const zombies = [
        { zombieId: 'zombie', position: { xMeters: 1, yMeters: 0 }, targetPlayerId: null },
    ];
    const command = (
        session: string,
        type: 'equip-weapon' | 'melee-attack',
        weapon: MeleeWeaponId = 'club',
    ) => {
        if (type === 'equip-weapon') {
            pickup.receiveEquipment(session, {
                type,
                itemId: `solo:${weapon}`,
                protocolVersion,
                meleeVersion,
            });
        } else {
            melee.receive(session, { type, protocolVersion, meleeVersion });
        }
    };
    const step = () => {
        movement.step();
        const snapshots = new Map(
            ['first', 'tab', 'friend'].map(id => [id, movement.snapshot(id)]),
        );
        pickup.step(snapshots, health);
        melee.step({
            snapshots: new Map(['first', 'tab', 'friend'].map(id => [id, movement.snapshot(id)])),
            zombies,
            obstacles,
            damage,
            health,
        });
    };
    return { melee, movement, damage, health, zombies, obstacles, command, step };
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
    expect(melee.action(movement.snapshot('first'))?.impact).toMatchObject({
        outcome: 'hit',
        zombieId: 'zombie',
        damage: 34,
    });
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

test('only accepted attacks publish an action, once per player and only on their step', () => {
    const { melee, movement, command, step, health, zombies } = setup();
    const read = (session = 'first') => melee.action(movement.snapshot(session));
    command('first', 'melee-attack');
    step();
    expect(read()).toBeNull();
    command('first', 'equip-weapon', 'axe');
    step();
    expect(read()).toBeNull();
    zombies.length = 0;
    command('first', 'melee-attack');
    command('tab', 'melee-attack');
    step();
    expect(read()).toMatchObject({ type: 'melee-action', tick: 3, weapon: 'axe' });
    expect(read('tab')).toEqual(read());
    expect(read('friend')).toBeNull();
    command('tab', 'melee-attack');
    step();
    expect(read()).toBeNull();
    for (let index = 0; index < meleeWeapons.axe.cooldownTicks; index++) step();
    health.mockReturnValue(0);
    command('first', 'melee-attack');
    step();
    expect(read()).toBeNull();
});

test('confirmed impacts report actual damage and kills; walls and stale dead targets are misses', () => {
    const { melee, movement, command, step, damage, obstacles } = setup();
    const impact = () => melee.action(movement.snapshot('first'))?.impact;
    command('first', 'equip-weapon', 'axe');
    step();
    damage.mockReturnValueOnce({ damage: 40, isKilled: true });
    command('first', 'melee-attack');
    step();
    expect(impact()).toMatchObject({ outcome: 'kill', zombieId: 'zombie', damage: 40 });
    for (let index = 0; index < meleeWeapons.axe.cooldownTicks; index++) step();
    damage.mockReturnValueOnce(null);
    command('first', 'melee-attack');
    step();
    expect(impact()).toEqual({ outcome: 'miss', position: { xMeters: 0, yMeters: 0 } });
    for (let index = 0; index < meleeWeapons.axe.cooldownTicks; index++) step();
    obstacles.push({
        id: 'wall',
        minXMeters: 0.4,
        maxXMeters: 0.6,
        minYMeters: -2,
        maxYMeters: 2,
    });
    command('first', 'melee-attack');
    step();
    expect(impact()?.outcome).toBe('miss');
    expect(damage).toHaveBeenCalledTimes(2);
});

test('restored cooldown uses remaining steps, survives switching and elapses without clients', () => {
    const movement = new LocalWorldMovement('world', 'solo');
    movement.join('tab');
    let weapon: MeleeWeaponId = 'axe';
    const melee = new LocalWorldMelee(() => weapon, { playerId: 'solo', cooldownTicks: 9 });
    const damage = vi.fn(() => ({ damage: 20, isKilled: false }));
    const command = { type: 'melee-attack', protocolVersion, meleeVersion };
    const step = (isConnected = true) => {
        movement.step();
        melee.step({
            snapshots: isConnected ? new Map([['tab', movement.snapshot('tab')]]) : new Map(),
            zombies: [
                { zombieId: 'z', position: { xMeters: 1, yMeters: 0 }, targetPlayerId: null },
            ],
            obstacles: [],
            damage,
            health: () => 90,
        });
    };
    expect(melee.remainingCooldown('solo')).toBe(9);
    step(false);
    step(false);
    expect(melee.remainingCooldown('solo')).toBe(7);
    weapon = 'knife';
    for (let tick = 3; tick < 9; tick++) {
        melee.receive('tab', command);
        step();
        expect(melee.action(movement.snapshot('tab'))).toBeNull();
    }
    expect(melee.remainingCooldown('solo')).toBe(1);
    melee.receive('tab', command);
    step();
    expect(damage).toHaveBeenCalledOnce();
    expect(melee.remainingCooldown('solo')).toBe(meleeWeapons.knife.cooldownTicks);
});
