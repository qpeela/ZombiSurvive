import { moduleDependencies } from './tools/architecture-policy.ts';

const layerRules = Object.entries(moduleDependencies).map(([source, dependencies]) => ({
    name: `dependencies-of-${source.replace('/', '-')}`,
    severity: 'error',
    from: { path: `^${source}/` },
    to: {
        path: '^(apps|packages)/',
        pathNot: `^(${[source, ...dependencies].join('|')})/`,
    },
}));

const knownLayers = `^(${Object.keys(moduleDependencies).join('|')})/`;

export default {
    forbidden: [
        ...layerRules,
        {
            name: 'no-undeclared-layer-dependencies',
            severity: 'error',
            from: { path: '^(apps|packages)/', pathNot: knownLayers },
            to: {},
        },
        {
            name: 'no-undeclared-orphan-layers',
            severity: 'error',
            from: { path: '^(apps|packages)/', pathNot: knownLayers, orphan: true },
            to: {},
        },
        {
            name: 'no-game-to-tooling',
            severity: 'error',
            from: { path: '^(apps|packages)/' },
            to: { path: '^(tools|tests)/' },
        },
        {
            name: 'no-node-runtime-in-client',
            severity: 'error',
            from: { path: '^apps/client/' },
            to: { dependencyTypes: ['core'] },
        },
        {
            name: 'no-circular-dependencies',
            severity: 'error',
            from: {},
            to: { circular: true },
        },
        {
            name: 'no-unresolved-imports',
            severity: 'error',
            from: {},
            to: { couldNotResolve: true },
        },
        {
            name: 'package-public-api-only',
            severity: 'error',
            from: { path: '^(apps/[^/]+|packages/[^/]+)/' },
            to: {
                path: '^packages/[^/]+/src/(?!index\\.(ts|js|mjs)$)',
                pathNot: '^$1/',
            },
        },
        {
            name: 'core-without-runtime-dependencies',
            severity: 'error',
            from: {
                path: '^packages/[^/]+/src/',
                pathNot: '\\.(test|spec)\\.ts$',
            },
            to: {
                dependencyTypes: ['core', 'npm', 'npm-dev', 'npm-optional', 'npm-peer'],
                pathNot: '^packages/',
            },
        },
    ],
    options: {
        doNotFollow: { path: 'node_modules' },
        exclude: { path: '(^|/)(node_modules|dist|coverage|\\.cache)/' },
        tsPreCompilationDeps: true,
        tsConfig: { fileName: 'tsconfig.json' },
        enhancedResolveOptions: {
            exportsFields: ['exports'],
            conditionNames: ['import', 'node', 'default'],
        },
    },
};
