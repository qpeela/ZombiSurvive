import { SoloWorldStore } from '../../apps/server/dist/solo-world-store.js';

// Observe completed real commits without opening a player or reading a locked DB.
const savePosition = SoloWorldStore.prototype.savePosition;
SoloWorldStore.prototype.savePosition = function (position, worldTimeMs) {
    savePosition.call(this, position, worldTimeMs);
    if (process.connected) process.send({ type: 'clock-checkpoint', worldTimeMs });
};
await import('../../apps/server/dist/main.js');
