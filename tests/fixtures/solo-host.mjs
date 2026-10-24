import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The production entrypoint runs with an isolated save, never the host's real world.
const directory = mkdtempSync(join(tmpdir(), 'zombi-solo-test-'));
process.env.WORLD_SAVE_PATH = join(directory, 'solo.sqlite');
process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
await import('../../apps/server/dist/main.js');
