import { LocalWorldRoom } from '../../apps/server/dist/local-world-room.js';

let nowMs = Number(process.env.TEST_WALL_CLOCK_MS);
const onCreate = LocalWorldRoom.prototype.onCreate;
LocalWorldRoom.prototype.onCreate = function (options) {
    return onCreate.call(this, { ...options, now: () => nowMs });
};
process.on('message', message => {
    if (message?.type === 'advance-wall-clock') nowMs = message.nowMs;
});

await import('../../apps/server/dist/main.js');
