import type { PistolItem } from '@zombi-survive/domain';
import { describe, expect, it, vi } from 'vitest';

import { trackConfirmedEquipment } from '../../apps/client/src/equipment-hud.ts';

const pistol: PistolItem = { itemId: 'pistol', kind: 'pistol', rounds: 0, magazineCapacity: 8 };
const inventory = [
    { itemId: 'reserve', kind: 'ammo9mm', quantity: 3, cell: { row: 0, column: 0 } },
] as const;

describe('held equipment confirmation', () => {
    it('waits for life status, then follows accepted equipment even when snapshot ticks differ', () => {
        const render = vi.fn();
        const equipment = trackConfirmedEquipment(render);
        equipment.acceptEquipment({ tick: 3, hands: pistol, items: inventory });
        expect(render).not.toHaveBeenCalled();
        equipment.acceptLife({ tick: 5, lifeState: 'alive' });
        expect(render).toHaveBeenLastCalledWith({ hands: pistol, items: inventory });
        const reloaded = { ...pistol, rounds: 3 };
        equipment.acceptEquipment({ tick: 6, hands: reloaded, items: [] });
        expect(render).toHaveBeenLastCalledWith({ hands: reloaded, items: [] });
    });

    it('clears on death and cannot revive equipment from an earlier life or room', () => {
        const render = vi.fn();
        const equipment = trackConfirmedEquipment(render);
        equipment.acceptLife({ tick: 5, lifeState: 'alive' });
        equipment.acceptEquipment({ tick: 5, hands: pistol, items: inventory });
        equipment.acceptLife({ tick: 6, lifeState: 'dead' });
        expect(render).toHaveBeenLastCalledWith({ hands: null, items: [] });
        equipment.acceptLife({ tick: 9, lifeState: 'alive', lifeRevision: 1 });
        equipment.acceptEquipment({ tick: 8, hands: pistol, items: inventory });
        expect(render).toHaveBeenLastCalledWith({ hands: null, items: [] });
        equipment.acceptEquipment({ tick: 10, hands: pistol, items: inventory });
        expect(render).toHaveBeenLastCalledWith({ hands: pistol, items: inventory });
        equipment.reset();
        expect(render).toHaveBeenLastCalledWith(null);
        equipment.acceptLife({ tick: 1, lifeState: 'alive' });
        expect(render).toHaveBeenLastCalledWith(null);
        equipment.acceptEquipment({ tick: 1, hands: null, items: [] });
        expect(render).toHaveBeenLastCalledWith({ hands: null, items: [] });
    });
});
