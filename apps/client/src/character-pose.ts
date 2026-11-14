import type { WorldPosition } from '@zombi-survive/domain';

export type CharacterPose = {
    readonly mode: 'idle' | 'walk' | 'run' | 'sneak' | 'shuffle';
    readonly heading: number;
    readonly phase: number;
    readonly leftStep: number;
    readonly rightStep: number;
    readonly leftLift: number;
    readonly rightLift: number;
    readonly bob: number;
    readonly breath: number;
};

type MotionSample = {
    readonly position: WorldPosition;
    readonly deltaMs: number;
    readonly isSneaking: boolean;
    readonly isZombie: boolean;
};
const fullTurn = Math.PI * 2;
const copyPosition = (position: WorldPosition): WorldPosition => ({ ...position });

/** Render smoothing only; authoritative snapshots and local prediction stay untouched. */
export const interpolateCharacterPosition = ({
    current,
    target,
    deltaMs,
}: {
    readonly current: WorldPosition;
    readonly target: WorldPosition;
    readonly deltaMs: number;
}): WorldPosition => {
    const distance = Math.hypot(target.xMeters - current.xMeters, target.yMeters - current.yMeters);
    const isDiscontinuity = deltaMs > 250 || distance > 3;

    if (isDiscontinuity || distance < 0.0005) return copyPosition(target);

    const amount = 1 - Math.exp(-Math.max(0, deltaMs) / 45);

    return {
        xMeters: current.xMeters + (target.xMeters - current.xMeters) * amount,
        yMeters: current.yMeters + (target.yMeters - current.yMeters) * amount,
    };
};

/** Distance drives footsteps; a stationary actor never walks on the spot. */
export class CharacterMotion {
    private previous: WorldPosition | null = null;
    private speed = 0;
    private phase = 0;
    private heading = Math.PI / 2;
    private elapsedMs = 0;
    private readonly breathOffset: number;

    constructor(id: string) {
        let hash = 0;
        for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
        this.breathOffset = (hash % 1000) / 1000;
    }

    reset(): void {
        this.previous = null;
        this.speed = 0;
        this.phase = 0;
        this.heading = Math.PI / 2;
        this.elapsedMs = 0;
    }

    sample({ position, deltaMs, isSneaking, isZombie }: MotionSample): CharacterPose {
        const previous = this.previous;
        this.previous = copyPosition(position);
        const isValidFrame = Number.isFinite(deltaMs) && deltaMs > 0 && deltaMs <= 250;

        if (previous === null || !isValidFrame) {
            this.speed = 0;
            this.phase = 0;

            return this.pose({ isSneaking, isZombie });
        }

        const x = position.xMeters - previous.xMeters;
        const y = position.yMeters - previous.yMeters;
        const distance = Math.hypot(x, y);
        const seconds = deltaMs / 1000;
        const isTeleport = distance > Math.max(1, seconds * 12);

        if (isTeleport) {
            this.speed = 0;
            this.phase = 0;

            return this.pose({ isSneaking, isZombie });
        }

        this.elapsedMs += deltaMs;
        this.speed += (distance / seconds - this.speed) * (1 - Math.exp(-deltaMs / 80));

        if (distance > 0.0001) this.heading = Math.atan2(y, x);

        let strideMeters = 2;
        if (isZombie) strideMeters = 1.45;
        else if (isSneaking) strideMeters = 1.3;
        else if (this.speed > 5) strideMeters = 2.8;
        this.phase = (this.phase + (distance / strideMeters) * fullTurn) % fullTurn;

        return this.pose({ isSneaking, isZombie });
    }

    private pose({
        isSneaking,
        isZombie,
    }: Pick<MotionSample, 'isSneaking' | 'isZombie'>): CharacterPose {
        let mode: CharacterPose['mode'] = 'idle';
        if (this.speed > 0.12) {
            mode = 'walk';
            if (isZombie) mode = 'shuffle';
            else if (isSneaking) mode = 'sneak';
            else if (this.speed > 5) mode = 'run';
        }

        const amount = Math.min(1, this.speed / 1.2);
        const stride = mode === 'run' ? 4.5 : 3;
        const step = Math.sin(this.phase) * stride * amount;
        const lift = mode === 'run' ? 2.4 : 1.5;
        const rightAmount = isZombie ? 0.55 : 1;

        return {
            mode,
            heading: this.heading,
            phase: this.phase,
            leftStep: step,
            rightStep: -step * rightAmount,
            leftLift: Math.max(0, Math.cos(this.phase)) * lift * amount,
            rightLift: Math.max(0, -Math.cos(this.phase)) * lift * amount * rightAmount,
            bob: Math.abs(Math.sin(this.phase)) * amount * (isZombie ? 0.6 : 1),
            breath: Math.sin(this.elapsedMs / 500 + this.breathOffset * fullTurn) * 0.3,
        };
    }
}
