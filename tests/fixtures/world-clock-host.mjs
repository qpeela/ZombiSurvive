import { LocalWorldRoom } from '../../apps/server/dist/local-world-room.js';
import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

// Observe completed real commits without opening a player or reading a locked DB.
const savePosition = SoloWorldStore.prototype.savePosition;
SoloWorldStore.prototype.savePosition = function (position, worldTimeMs, needs) {
    savePosition.call(this, position, worldTimeMs, needs);
    if (process.connected) process.send({ type: 'clock-checkpoint', worldTimeMs });
};

if (process.env.WORLD_CLOCK_HOLD_AT_MS !== undefined) {
    let holdAtMs = Number(process.env.WORLD_CLOCK_HOLD_AT_MS);
    const onCreate = LocalWorldRoom.prototype.onCreate;
    LocalWorldRoom.prototype.onCreate = function (options) {
        const setTimestep = this.setTimestep;
        this.setTimestep = (update, interval) =>
            setTimestep.call(
                this,
                (...args) => {
                    if (holdAtMs !== null) this.worldTimeMs = Math.min(this.worldTimeMs, holdAtMs);
                    update(...args);
                },
                interval,
            );
        try {
            return onCreate.call(this, options);
        } finally {
            delete this.setTimestep;
        }
    };
    process.on('message', message => {
        if (message?.type === 'release-world-clock') holdAtMs = null;
    });
}
await import('../../apps/server/dist/main.js');
