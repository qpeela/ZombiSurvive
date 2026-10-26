import { combatSettings } from '@zombi-survive/content';
import type {
    PlayerHealth,
    PlayerMovementState,
    WorldObstacle,
    ZombieAttackState,
    ZombieState,
} from '@zombi-survive/domain';

import { distanceBetween, isSegmentClear } from './zombie-navigation.ts';

/** One call per fixed world tick, after movement. Losing reach cancels the windup. */
export const stepZombieAttack = ({
    zombie,
    attack,
    target,
    health,
    obstacles,
}: {
    zombie: ZombieState;
    attack: ZombieAttackState;
    target: PlayerMovementState | undefined;
    health: PlayerHealth | undefined;
    obstacles: readonly WorldObstacle[];
}): { attack: ZombieAttackState; health: PlayerHealth | undefined } => {
    const idle: ZombieAttackState = { targetPlayerId: null, ticksUntilHit: 0 };

    if (target === undefined || health === undefined) {
        return { attack: idle, health };
    }

    const isTarget = target.playerId === zombie.targetPlayerId;
    const isAlive = health.playerId === target.playerId && health.health > 0;
    const isInRange =
        distanceBetween(zombie.position, target.position) <= combatSettings.attackRangeMeters;
    const isReachable = isSegmentClear({
        start: zombie.position,
        end: target.position,
        obstacles,
    });

    if (!isTarget || !isAlive || !isInRange || !isReachable) {
        return { attack: idle, health };
    }

    const ticksUntilHit =
        (attack.targetPlayerId === target.playerId
            ? attack.ticksUntilHit
            : combatSettings.attackIntervalTicks) - 1;

    if (ticksUntilHit > 0) {
        return { attack: { targetPlayerId: target.playerId, ticksUntilHit }, health };
    }

    return {
        attack: {
            targetPlayerId: target.playerId,
            ticksUntilHit: combatSettings.attackIntervalTicks,
        },
        health: { ...health, health: Math.max(0, health.health - combatSettings.zombieDamage) },
    };
};
