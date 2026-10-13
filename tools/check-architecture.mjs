import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const directories = ['apps', 'packages', 'tools', 'tests'].filter(directory =>
    existsSync(directory),
);
const result = spawnSync(
    process.execPath,
    [
        resolve('node_modules/dependency-cruiser/bin/dependency-cruiser.mjs'),
        '--config',
        '.dependency-cruiser.mjs',
        ...directories,
    ],
    { stdio: 'inherit' },
);

if (result.error) {
    throw result.error;
}

process.exitCode = result.status ?? 1;
