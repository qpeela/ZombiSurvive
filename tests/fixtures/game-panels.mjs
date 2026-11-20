import { expect } from '@playwright/test';

const openPanel = async (page, panel) => {
    const toggle = page.locator(`#toggle-${panel}`);
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(`#${panel}-panel`)).toBeVisible();
};

export const openInventory = page => openPanel(page, 'inventory');
export const openEquipment = page => openPanel(page, 'equipment');
export const openSettings = page => openPanel(page, 'settings');
export const openActions = page => openPanel(page, 'actions');

export const clickGameAction = async (page, action) => {
    await openActions(page);
    await action.click();
    await page.locator('#game').focus();
};

export const clickEquipmentAction = async (page, name) => {
    await openEquipment(page);
    await page.locator('#equipment-panel').getByRole('button', { name, exact: true }).click();
    await page.locator('#toggle-equipment').click();
    await expect(page.locator('#equipment-panel')).toBeHidden();
    await page.locator('#game').focus();
};
