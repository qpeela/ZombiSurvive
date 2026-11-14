import { pistolSettings } from '@zombi-survive/content';
import {
    copyItem,
    type ItemLocation,
    type PistolItem,
    type WorldObstacle,
    type ZombieState,
} from '@zombi-survive/domain';
import {
    firearmVersion,
    isShootCommand,
    isShotAction,
    protocolVersion,
    type ShotAction,
} from '@zombi-survive/protocol';
import { spendPistolRound, tracePistolShot } from '@zombi-survive/simulation';
import { expect, test, vi } from 'vitest';

import { ShotFeedback } from '../../apps/client/src/shot-feedback.ts';
import { LocalWorldFirearm } from '../../apps/server/src/local-world-firearm.ts';
import { LocalWorldMelee } from '../../apps/server/src/local-world-melee.ts';
import { LocalWorldMovement } from '../../apps/server/src/local-world-movement.ts';
import { LocalWorldPickup } from '../../apps/server/src/local-world-pickup.ts';

const origin = { xMeters: 0, yMeters: 0 };
const zombie = (x: number, y = 0, id = 'zombie'): ZombieState => ({
    zombieId: id,
    position: { xMeters: x, yMeters: y },
    targetPlayerId: null,
});
const wall: WorldObstacle = {
    id: 'wall',
    minXMeters: 3,
    maxXMeters: 4,
    minYMeters: -2,
    maxYMeters: 2,
};
const trace = (
    zombies: readonly ZombieState[] = [],
    obstacles: readonly WorldObstacle[] = [],
    aim = { x: 1, y: 0 },
) => tracePistolShot({ origin, aim, zombies, obstacles });
const pistol: PistolItem = {
    itemId: 'pistol-v1:0:0',
    kind: 'pistol',
    rounds: 8,
    magazineCapacity: 8,
};
const command = (weaponRevision = 0) => ({
    type: 'shoot-pistol',
    protocolVersion,
    firearmVersion,
    itemId: pistol.itemId,
    weaponRevision,
    aim: { x: 1, y: 0 },
});

test('a normalized shot hits only the nearest zombie, including the 18–20m non-pursuit zone', () => {
    expect(trace([zombie(8), zombie(4, 0, 'near')])?.zombie?.zombieId).toBe('near');
    expect(trace([zombie(19)])?.zombie?.zombieId).toBe('zombie');
    expect(trace([zombie(19)], [], { x: 100, y: 0 })).toEqual(trace([zombie(19)]));
    expect(trace([zombie(3, 0, 'b'), zombie(3, 0, 'a')])?.zombie?.zombieId).toBe('a');
});
test('first wall stops a shot; a closer zombie wins, and a wall wins an exact tie', () => {
    expect(trace([zombie(8)], [wall])).toEqual({
        zombie: null,
        position: { xMeters: 3, yMeters: 0 },
    });
    expect(trace([zombie(2)], [wall])?.zombie?.zombieId).toBe('zombie');
    const tied = { ...wall, minXMeters: 0, maxXMeters: 1 };
    expect(trace([zombie(0)], [tied])?.zombie).toBeNull();
    expect(trace([], [{ ...wall, minYMeters: 1 }])?.position.xMeters).toBe(20);
});
test('ray handles behind, tangent, inside, range edge and wall at the muzzle', () => {
    expect(trace([zombie(-2), zombie(25)])?.zombie).toBeNull();
    expect(trace([zombie(4, pistolSettings.targetRadiusMeters)])?.zombie?.zombieId).toBe('zombie');
    expect(trace([zombie(0)])?.position).toEqual(origin);
    expect(trace([zombie(20)])?.zombie?.zombieId).toBe('zombie');
    expect(trace([], [{ ...wall, minXMeters: -1, maxXMeters: 1 }])?.position).toEqual(origin);
    expect(trace([], [], { x: 0, y: -1 })?.position).toEqual({ xMeters: 0, yMeters: -20 });
});
test.each([
    { x: 0, y: 0 },
    { x: NaN, y: 0 },
    { x: 1, y: Infinity },
])('invalid aim %j does not produce a ray', aim => {
    expect(trace([], [], aim)).toBeNull();
    expect(isShootCommand({ ...command(), aim })).toBe(false);
});
test('magazine compare-and-set rejects empty, old revisions and overflow; copying preserves the token', () => {
    const next = spendPistolRound(pistol, 0);
    expect(next).toEqual({ ...pistol, rounds: 7, revision: 1 });
    if (next === null) throw new Error('Missing accepted round');
    expect(spendPistolRound(next, 0)).toBeNull();
    expect(spendPistolRound({ ...next, rounds: 0 }, 1)).toBeNull();
    expect(
        spendPistolRound({ ...next, revision: Number.MAX_SAFE_INTEGER }, Number.MAX_SAFE_INTEGER),
    ).toBeNull();
    const ground = { ...next, position: origin };
    expect(copyItem(ground)).toEqual(next);
});
test('shot wire validators reject malformed revisions, aim, IDs and client claims cannot alter the shape', () => {
    expect(isShootCommand(command())).toBe(true);
    for (const weaponRevision of [-1, 0.5, Infinity, undefined, '0'])
        expect(isShootCommand({ ...command(), weaponRevision })).toBe(false);
    expect(isShootCommand({ ...command(), aim: { x: 1e7, y: 1 } })).toBe(false);
    expect(isShootCommand({ ...command(), firearmVersion: 2 })).toBe(false);
    expect(isShootCommand({ ...command(), itemId: '' })).toBe(false);
});

const setup = ({ rounds = 8, cooldown = 0 } = {}) => {
    const movement = new LocalWorldMovement('world', 'solo');
    movement.join('first');
    movement.join('tab');
    const locations: ItemLocation[] = [
        { type: 'hands', playerId: 'solo', item: { ...pistol, rounds } },
    ];
    const pickup = new LocalWorldPickup(locations);
    const melee = new LocalWorldMelee(() => 'pistol', {
        playerId: 'solo',
        cooldownTicks: cooldown,
    });
    const firearm = new LocalWorldFirearm();
    const damage = vi.fn((): { damage: number; isKilled: boolean } | null => ({
        damage: 30,
        isKilled: false,
    }));
    const health = vi.fn(() => 100);
    const zombies: ZombieState[] = [zombie(8)];
    const step = () => {
        movement.step();
        const snapshots = new Map(['first', 'tab'].map(id => [id, movement.snapshot(id)]));
        melee.step({ snapshots, zombies: [], obstacles: [], damage, health });
        firearm.step({
            snapshots,
            zombies,
            obstacles: [],
            health,
            hands: id => pickup.hands(id),
            stageItem: item => {
                pickup.stageItem(item);
            },
            reserveAttack: input => melee.reserveAttack(input),
            damage,
        });
    };
    const confirm = () => {
        pickup.takePendingSave();
        pickup.confirmSave();
    };
    return { pickup, firearm, melee, movement, damage, health, zombies, step, confirm };
};

test('accepted shot uses server damage, spends one round once across tabs, and shares cooldown', () => {
    const state = setup();
    state.firearm.receive('first', { ...command(), damage: 999, zombieId: 'forged' });
    state.firearm.receive('tab', command());
    state.step();
    const action = state.firearm.action(state.movement.snapshot('tab'));
    expect(action).toMatchObject({
        weaponRevision: 1,
        impact: { outcome: 'hit', damage: 30, zombieId: 'zombie' },
    });
    expect(state.damage).toHaveBeenCalledExactlyOnceWith('zombie', 30);
    expect(isShotAction(action)).toBe(true);
    state.confirm();
    expect(state.pickup.hands('solo')).toMatchObject({ rounds: 7, revision: 1 });
    state.firearm.receive('first', command(1));
    state.step();
    expect(state.firearm.action(state.movement.snapshot('first'))).toBeNull();
    for (let tick = 0; tick < 10; tick++) state.step();
    state.firearm.receive('tab', command());
    state.step();
    expect(state.damage).toHaveBeenCalledTimes(1);
    state.firearm.receive('tab', command(1));
    state.step();
    state.confirm();
    expect(state.pickup.hands('solo')).toMatchObject({ rounds: 6, revision: 2 });
});
test('miss spends a round and produces an impact; empty, dead, unknown and departed clients cannot shoot', () => {
    const state = setup();
    state.zombies.length = 0;
    state.firearm.receive('first', command());
    state.step();
    expect(state.firearm.action(state.movement.snapshot('first'))?.impact).toEqual({
        outcome: 'miss',
        position: { xMeters: 20, yMeters: 0 },
    });
    expect(state.damage).not.toHaveBeenCalled();
    state.confirm();
    const empty = setup({ rounds: 0 });
    empty.firearm.receive('first', command());
    empty.step();
    expect(empty.firearm.action(empty.movement.snapshot('first'))).toBeNull();
    const dead = setup();
    dead.health.mockReturnValue(0);
    dead.firearm.receive('first', command());
    dead.step();
    expect(dead.damage).not.toHaveBeenCalled();
    const left = setup();
    left.firearm.receive('first', command());
    left.firearm.leave('first');
    left.firearm.receive('unknown', command());
    left.step();
    expect(left.damage).not.toHaveBeenCalled();
});
test('restored cooldown blocks gun and a staged unequip retains the consumed round after confirmation', () => {
    const state = setup({ cooldown: 3 });
    state.firearm.receive('first', command());
    state.step();
    expect(state.damage).not.toHaveBeenCalled();
    state.step();
    state.pickup.receiveEquipment('first', {
        type: 'unequip-weapon',
        itemId: pistol.itemId,
        protocolVersion,
        meleeVersion: 3,
    });
    state.pickup.step(new Map([['first', state.movement.snapshot('first')]]));
    state.firearm.receive('first', command());
    state.step();
    const saved = state.pickup.takePendingSave();
    expect(saved).toEqual([
        expect.objectContaining({ type: 'container', item: { ...pistol, rounds: 7, revision: 1 } }),
    ]);
    state.pickup.confirmSave();
    expect(state.pickup.hands('solo')).toBeNull();
    expect(state.damage).toHaveBeenCalledOnce();
});
test('a same-step death receives the already consumed magazine', () => {
    const state = setup();
    state.firearm.receive('first', command());
    state.step();
    state.pickup.stageDeath({
        corpseId: 'body',
        playerId: 'solo',
        position: origin,
        diedAtMs: 1,
        expiresAtMs: 1000,
    });
    expect(state.pickup.takePendingSave()).toEqual([
        { type: 'corpse', corpseId: 'body', item: { ...pistol, rounds: 7, revision: 1 } },
    ]);
});
test('confirmed shot effects deduplicate item revisions, expire and clear across disconnect', () => {
    const feedback = new ShotFeedback();
    const action: ShotAction = {
        type: 'shot-action',
        protocolVersion,
        firearmVersion,
        worldId: 'world',
        playerId: 'solo',
        tick: 1,
        itemId: pistol.itemId,
        weaponRevision: 1,
        origin,
        impact: { outcome: 'miss', position: origin },
    };
    feedback.accept(action);
    feedback.accept({ ...action, tick: 100 });
    expect(feedback.effects).toHaveLength(1);
    feedback.advance(700);
    expect(feedback.effects).toHaveLength(0);
    feedback.accept(action);
    expect(feedback.effects).toHaveLength(0);
    feedback.clear();
    feedback.accept(action);
    expect(feedback.effects).toHaveLength(1);
    expect(isShotAction({ ...action, origin: { xMeters: Infinity, yMeters: 0 } })).toBe(false);
    expect(
        isShotAction({
            ...action,
            impact: { outcome: 'hit', position: origin, damage: 0, zombieId: 'z' },
        }),
    ).toBe(false);
});

test('a melee cooldown blocks shooting and a committed unequip prevents any round from being spent', () => {
    const state = setup();
    state.melee.reserveAttack({ playerId: 'solo', tick: 0, cooldownTicks: 24 });
    state.firearm.receive('first', command());
    state.step();
    expect(state.damage).not.toHaveBeenCalled();
    expect(state.melee.remainingCooldown('solo')).toBe(23);
    const unequipped = setup();
    unequipped.pickup.receiveEquipment('first', {
        type: 'unequip-weapon',
        protocolVersion,
        meleeVersion: 3,
        itemId: pistol.itemId,
    });
    unequipped.pickup.step(new Map([['first', unequipped.movement.snapshot('first')]]));
    unequipped.confirm();
    unequipped.firearm.receive('first', command());
    unequipped.step();
    expect(unequipped.damage).not.toHaveBeenCalled();
    expect(
        unequipped.pickup.snapshot(unequipped.movement.snapshot('first')).items[0],
    ).toMatchObject({ rounds: 8 });
});
