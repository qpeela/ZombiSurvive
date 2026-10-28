import type { MeleeAction, MeleeImpact } from '@zombi-survive/protocol';
import { meleeVersion, protocolVersion } from '@zombi-survive/protocol';
import { expect, test } from 'vitest';

import { meleeEffectDurationMs, MeleeFeedback } from '../../apps/client/src/melee-feedback.ts';

const action = (tick: number, impact?: MeleeImpact): MeleeAction => ({
    type: 'melee-action',
    worldId: 'world',
    playerId: 'solo',
    weapon: 'club',
    tick,
    meleeVersion,
    protocolVersion,
    ...(impact === undefined ? {} : { impact }),
});
const position = { xMeters: 1, yMeters: 0 };

test('miss, hit and kill effects originate once per confirmed event; older events cannot replay', () => {
    const feedback = new MeleeFeedback();
    const impact: MeleeImpact = { outcome: 'hit', zombieId: 'zombie', position, damage: 34 };
    feedback.accept(action(1, { outcome: 'miss', position }));
    feedback.accept(action(2, impact));
    feedback.accept(action(2, impact));
    feedback.accept(action(1, impact));
    feedback.accept(action(3, { ...impact, outcome: 'kill', damage: 32 }));
    expect(feedback.effects.map(effect => effect.impact.outcome)).toEqual(['miss', 'hit', 'kill']);
    feedback.advance({ deltaMs: meleeEffectDurationMs, isLoaded: () => true });
    expect(feedback.effects).toEqual([]);
    feedback.accept(action(3, impact));
    expect(feedback.effects).toEqual([]);
});

test('chunk unload and disconnect remove effects; a legacy animation event does not infer a hit', () => {
    const feedback = new MeleeFeedback();
    feedback.accept(action(1));
    expect(feedback.effects).toEqual([]);
    feedback.accept(action(2, { outcome: 'kill', zombieId: 'zombie', position, damage: 40 }));
    feedback.advance({ deltaMs: 100, isLoaded: () => true });
    expect(feedback.effects).toHaveLength(1);
    feedback.advance({ deltaMs: 0, isLoaded: () => false });
    expect(feedback.effects).toEqual([]);
    feedback.accept(action(3, { outcome: 'miss', position }));
    feedback.clear();
    expect(feedback.effects).toEqual([]);
});

test('effects keep distinct target identities and unload only the affected position', () => {
    const feedback = new MeleeFeedback();
    feedback.accept(action(1, { outcome: 'hit', zombieId: 'first', position, damage: 34 }));
    feedback.accept(
        action(2, {
            outcome: 'hit',
            zombieId: 'second',
            position: { xMeters: 100, yMeters: 0 },
            damage: 20,
        }),
    );
    expect(feedback.effects.map(effect => effect.impact)).toMatchObject([
        { zombieId: 'first' },
        { zombieId: 'second' },
    ]);
    feedback.advance({ deltaMs: 0, isLoaded: target => target.xMeters < 64 });
    expect(feedback.effects.map(effect => effect.tick)).toEqual([1]);
});
