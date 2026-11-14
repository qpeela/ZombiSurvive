export const pistolSettings = Object.freeze({
    id: 'pistol' as const,
    name: 'пистолет 9 мм',
    equipLabel: 'Экипировать пистолет',
    ammoKind: 'ammo9mm' as const,
    magazineCapacity: 8,
    damage: 30,
    rangeMeters: 20,
    cooldownTicks: 10,
    reloadTicks: 40,
    targetRadiusMeters: 0.35,
    noiseRadiusMeters: 24,
    noiseInterestTicks: 200,
});
