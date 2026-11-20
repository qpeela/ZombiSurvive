import { LocalWorldMelee } from '../../apps/server/dist/local-world-melee.js';
import { LocalWorldPickup } from '../../apps/server/dist/local-world-pickup.js';
import { LocalWorldRoom } from '../../apps/server/dist/local-world-room.js';

let isArmed = false;
let queuedTicks = null;

// The browser and host keep communicating while the simulation is between ticks.
const onCreate = LocalWorldRoom.prototype.onCreate;
LocalWorldRoom.prototype.onCreate = function (options) {
    const setTimestep = this.setTimestep;
    this.setTimestep = (update, interval) =>
        setTimestep.call(
            this,
            (...args) => {
                if (queuedTicks === 0 || this.pendingStep !== null) return;
                if (queuedTicks !== null) queuedTicks--;
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
const receiveMelee = LocalWorldMelee.prototype.receive;
LocalWorldMelee.prototype.receive = function (...args) {
    receiveMelee.apply(this, args);
    if (isArmed) {
        isArmed = false;
        queuedTicks = 0;
    }
    if (queuedTicks !== null) queuedTicks++;
};

const receiveEquipment = LocalWorldPickup.prototype.receiveEquipment;
LocalWorldPickup.prototype.receiveEquipment = function (...args) {
    receiveEquipment.apply(this, args);
    // Commit the change, then publish the newly equipped weapon on the following tick.
    if (queuedTicks !== null) queuedTicks += 2;
};

process.on('message', message => {
    if (message?.type === 'arm-manual-melee-ticks') {
        isArmed = true;
        process.send({ type: 'manual-melee-ticks-armed' });
    } else if (message?.type === 'resume-ticks') {
        queuedTicks = null;
    }
});

await import('./solo-host.mjs');
