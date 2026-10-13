// Source of truth for package dependencies; reflected in docs/ARCHITECTURE.md.
export const moduleDependencies = {
    'apps/client': [
        'packages/domain',
        'packages/content',
        'packages/protocol',
        'packages/simulation',
        'packages/worldgen',
    ],
    'apps/server': [
        'packages/domain',
        'packages/content',
        'packages/protocol',
        'packages/simulation',
        'packages/worldgen',
    ],
    'packages/domain': [],
    'packages/content': ['packages/domain'],
    'packages/protocol': ['packages/domain'],
    'packages/simulation': ['packages/domain', 'packages/content'],
    'packages/worldgen': ['packages/domain', 'packages/content'],
} as const;
