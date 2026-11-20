import './style.css';

import {
    itemDefinitions,
    itemDisplayName,
    meleeWeapons,
    movementSettings,
    pistolSettings,
} from '@zombi-survive/content';
import {
    type GroundItem,
    type InventoryItem,
    isMeleeWeaponId,
    isWeaponId,
    type Item,
    type PlayerLifeState,
    type PlayerMovementState,
    type WorldPosition,
} from '@zombi-survive/domain';
import type { FirearmSnapshot, MovementSnapshot } from '@zombi-survive/protocol';
import {
    equipmentWeightGrams,
    findInventorySpace,
    getDaylightPhase,
    getWorldWeather,
} from '@zombi-survive/simulation';
import { AUTO, Game, Scale } from 'phaser';

import { BootScene } from './boot-scene';
import { createCharacterHud } from './character-hud';
import { createControlPanels } from './control-panels';
import { createEquipmentHud } from './equipment-hud';
import { createFullscreenControls } from './fullscreen';
import { createHealthPanel, type HealthStatus } from './health-panel';
import { createInterfaceScale } from './interface-scale';
import type { InventoryContextAction } from './inventory-context-menu';
import { createInventoryGrid } from './inventory-grid';
import { createLootDrag } from './loot-drag';
import type { LootSource } from './loot-highlight';
import { createMovementInputController } from './movement-input';
import { MovementPrediction } from './movement-prediction';
import {
    type CorpseLoot,
    createNearbyLoot,
    getPickupReason,
    isWithinPickupRange,
} from './nearby-loot';
import { createOutingJournal } from './outing-journal';
import { createPlayerProfileControls } from './player-profile';
import { createVisitedMap } from './visited-map';
import { formatWorldTime } from './world-clock';
import { createWorldConnection } from './world-connection';
import { createWorldContext } from './world-context';
import { createWorldHud } from './world-hud';
import { createWorldSession } from './world-session';

const profileForm = document.querySelector<HTMLFormElement>('#player-profile');
const displayName = document.querySelector<HTMLInputElement>('#display-name');
const saveName = document.querySelector<HTMLButtonElement>('#save-name');
const profileMessage = document.querySelector<HTMLElement>('#profile-message');
const flashlightButton = document.querySelector<HTMLButtonElement>('#flashlight');
const weatherLabel = document.querySelector<HTMLElement>('#weather-label');
const daylightLabel = document.querySelector<HTMLElement>('#daylight-label');
const worldTime = document.querySelector<HTMLElement>('#world-time');
const worldSummary = document.querySelector<HTMLElement>('#world-hud summary');
const worldClockStatus = document.querySelector<HTMLElement>('#world-clock-status');
const playerName = document.querySelector<HTMLElement>('#player-name');
const shell = document.querySelector<HTMLElement>('.game-shell');
const interfaceScaleSelect = document.querySelector<HTMLSelectElement>('#interface-scale');
const controlScroll = document.querySelector<HTMLElement>('.control-scroll');
const inventoryPanel = document.querySelector<HTMLElement>('#inventory-panel');
const equipmentPanel = document.querySelector<HTMLElement>('#equipment-panel');
const inventoryToggle = document.querySelector<HTMLButtonElement>('#toggle-inventory');
const equipmentToggle = document.querySelector<HTMLButtonElement>('#toggle-equipment');
const healthPanel = document.querySelector<HTMLElement>('#health-panel');
const healthToggle = document.querySelector<HTMLButtonElement>('#toggle-health');
const panelHealth = document.querySelector<HTMLElement>('#panel-health');
const panelBleeding = document.querySelector<HTMLElement>('#panel-bleeding');
const panelBandage = document.querySelector<HTMLButtonElement>('#panel-bandage');
const panelBandageReason = document.querySelector<HTMLElement>('#panel-bandage-reason');
const journalPanel = document.querySelector<HTMLElement>('#journal-panel');
const journalToggle = document.querySelector<HTMLButtonElement>('#toggle-journal');
const journalEvents = document.querySelector<HTMLElement>('#journal-events');
const journalEmpty = document.querySelector<HTMLElement>('#journal-empty');
const mapPanel = document.querySelector<HTMLElement>('#map-panel');
const mapToggle = document.querySelector<HTMLButtonElement>('#toggle-map');
const mapViewport = document.querySelector<HTMLElement>('#map-viewport');
const mapPosition = document.querySelector<HTMLElement>('#map-position');
const mapLandmarks = document.querySelector<HTMLElement>('#map-landmarks');
const mapZoomIn = document.querySelector<HTMLButtonElement>('#map-zoom-in');
const mapZoomOut = document.querySelector<HTMLButtonElement>('#map-zoom-out');
const mapCenter = document.querySelector<HTMLButtonElement>('#map-center');
const mapMarkers = document.querySelector<HTMLFormElement>('#map-markers');
const settingsPanel = document.querySelector<HTMLElement>('#settings-panel');
const settingsToggle = document.querySelector<HTMLButtonElement>('#toggle-settings');
const actionsPanel = document.querySelector<HTMLElement>('#actions-panel');
const actionsToggle = document.querySelector<HTMLButtonElement>('#toggle-actions');
const helpPanel = document.querySelector<HTMLElement>('#help-panel');
const helpToggle = document.querySelector<HTMLButtonElement>('#toggle-help');
const fullscreenButton = document.querySelector<HTMLButtonElement>('#fullscreen');
const fullscreenMessage = document.querySelector<HTMLElement>('#fullscreen-message');
const container = document.querySelector<HTMLElement>('#game');
const status = document.querySelector<HTMLElement>('#connection-status');
const connectionDetails = document.querySelector<HTMLElement>('#connection-details');
const weaponOptions = document.querySelector<HTMLElement>('#weapon-options');
const unequip = document.querySelector<HTMLButtonElement>('#unequip-weapon');
const itemSelectors = document.querySelector<HTMLElement>('#inventory-items');
const weaponStats = document.querySelector<HTMLElement>('#weapon-stats');
const attack = document.querySelector<HTMLButtonElement>('#melee-attack');
const shotButton = document.querySelector<HTMLButtonElement>('#pistol-shot');
const reloadButton = document.querySelector<HTMLButtonElement>('#pistol-reload');
const heldReload = document.querySelector<HTMLElement>('#held-reload');
const reloadLabel = document.querySelector<HTMLElement>('#reload-label');
const reloadProgress = document.querySelector<HTMLProgressElement>('#reload-progress');
const ammoLabel = document.querySelector<HTMLElement>('#ammo-label');
const heldItem = document.querySelector<HTMLElement>('#held-item');
const heldAmmo = document.querySelector<HTMLElement>('#held-ammo');
const weaponLabel = document.querySelector<HTMLElement>('#weapon-label');
const reconnect = document.querySelector<HTMLButtonElement>('#reconnect');
const stamina = document.querySelector<HTMLProgressElement>('#stamina');
const staminaLabel = document.querySelector<HTMLElement>('#stamina-label');
const health = document.querySelector<HTMLProgressElement>('#health');
const healthLabel = document.querySelector<HTMLElement>('#health-label');
const bleedingLabel = document.querySelector<HTMLElement>('#bleeding-label');
const combatStatus = document.querySelector<HTMLElement>('#combat-status');
const combatIdle = document.querySelector<HTMLElement>('#combat-idle');
const loadLabel = document.querySelector<HTMLElement>('#load-label');
const movementLabel = document.querySelector<HTMLElement>('#movement-label');
const groundLabel = document.querySelector<HTMLElement>('#ground-item');
const nearbyPanel = document.querySelector<HTMLElement>('#nearby-panel');
const nearbyStatus = document.querySelector<HTMLElement>('#nearby-state');
const groundRow = document.querySelector<HTMLElement>('#ground-row');
const groundReason = document.querySelector<HTMLElement>('#ground-reason');
const inventory = document.querySelector<HTMLElement>('#inventory');
const restockLabel = document.querySelector<HTMLElement>('#restock-label');
const equipmentWeight = document.querySelector<HTMLElement>('#equipment-weight');
const pickup = document.querySelector<HTMLButtonElement>('#pickup');
const lootDropZone = document.querySelector<HTMLElement>('#loot-drop-zone');
const lootDropStatus = document.querySelector<HTMLElement>('#loot-drop-status');
const inventoryGrid = document.querySelector<HTMLElement>('#inventory-grid');
const inventorySelector = document.querySelector<HTMLButtonElement>('#inventory-select');
const inventoryMessage = document.querySelector<HTMLElement>('#inventory-message');
const itemDetails = document.querySelector<HTMLElement>('#item-details');
const inventoryContext = document.querySelector<HTMLElement>('#inventory-context');
const bandageButton = document.querySelector<HTMLButtonElement>('#use-bandage');
const corpseItems = document.querySelector<HTMLElement>('#corpse-items');
const worldContextPanel = document.querySelector<HTMLElement>('#world-context');
const worldContextTarget = document.querySelector<HTMLElement>('#world-context-target');
const worldContextAction = document.querySelector<HTMLButtonElement>('#world-context-action');
const worldContextReason = document.querySelector<HTMLElement>('#world-context-reason');
const respawnButton = document.querySelector<HTMLButtonElement>('#respawn');
const deathScreen = document.querySelector<HTMLElement>('#death-screen');

if (
    !profileForm ||
    !displayName ||
    !saveName ||
    !profileMessage ||
    !playerName ||
    !worldTime ||
    !worldSummary ||
    !worldClockStatus ||
    !daylightLabel ||
    !weatherLabel ||
    !flashlightButton ||
    !shell ||
    !interfaceScaleSelect ||
    !controlScroll ||
    !inventoryPanel ||
    !equipmentPanel ||
    !inventoryToggle ||
    !equipmentToggle ||
    !healthPanel ||
    !healthToggle ||
    !panelHealth ||
    !panelBleeding ||
    !panelBandage ||
    !panelBandageReason ||
    !journalPanel ||
    !journalToggle ||
    !journalEvents ||
    !journalEmpty ||
    !mapPanel ||
    !mapToggle ||
    !mapViewport ||
    !mapPosition ||
    !mapLandmarks ||
    !mapZoomIn ||
    !mapZoomOut ||
    !mapCenter ||
    !mapMarkers ||
    !settingsPanel ||
    !settingsToggle ||
    !actionsPanel ||
    !actionsToggle ||
    !helpPanel ||
    !helpToggle ||
    !fullscreenButton ||
    !fullscreenMessage ||
    !weaponOptions ||
    !unequip ||
    !itemSelectors ||
    !weaponStats ||
    !attack ||
    !shotButton ||
    !reloadButton ||
    !heldReload ||
    !reloadLabel ||
    !reloadProgress ||
    !weaponLabel ||
    !ammoLabel ||
    !heldItem ||
    !heldAmmo ||
    !container ||
    !status ||
    !connectionDetails ||
    !reconnect ||
    !stamina ||
    !staminaLabel ||
    !health ||
    !healthLabel ||
    !bleedingLabel ||
    !combatStatus ||
    !combatIdle ||
    !movementLabel ||
    !loadLabel ||
    !groundLabel ||
    !nearbyPanel ||
    !nearbyStatus ||
    !groundRow ||
    !groundReason ||
    !inventory ||
    !equipmentWeight ||
    !restockLabel ||
    !pickup ||
    !lootDropZone ||
    !lootDropStatus ||
    !inventoryGrid ||
    !inventorySelector ||
    !inventoryMessage ||
    !itemDetails ||
    !inventoryContext ||
    !bandageButton ||
    !deathScreen ||
    !corpseItems ||
    !worldContextPanel ||
    !worldContextTarget ||
    !worldContextAction ||
    !worldContextReason ||
    !respawnButton
) {
    throw new Error('Game UI is missing.');
}

const interfaceScale = createInterfaceScale({ shell, select: interfaceScaleSelect });
const scene = new BootScene();
const characterHud = createCharacterHud({
    bleedingLabel,
    combatStatus,
    combatIdle,
    stamina,
    staminaLabel,
    loadLabel,
});
const equipmentHud = createEquipmentHud({ heldItem, ammunition: heldAmmo });
const game = new Game({
    type: AUTO,
    parent: container,
    backgroundColor: '#17221c',
    pixelArt: true,
    banner: false,
    audio: { noAudio: true },
    scale: {
        mode: Scale.FIT,
        autoCenter: Scale.CENTER_BOTH,
        width: 960,
        height: 540,
    },
    scene: [scene],
});

const healthUi = createHealthPanel({
    health: panelHealth,
    bleeding: panelBleeding,
    action: panelBandage,
    reason: panelBandageReason,
});
const journal = createOutingJournal({ list: journalEvents, empty: journalEmpty });
let lastHealth: HealthStatus | null = null;
let inventoryItems: readonly InventoryItem[] = [];
let hands: Item | null = null;
let isBleeding = false;
let lifeState: PlayerLifeState | null = null;
const equipInventoryItem = (itemId: string): void => {
    if (lifeState === 'alive') connection.sendMelee({ type: 'equip-weapon', itemId });
};
const useInventoryBandage = (itemId: string): void => {
    if (lifeState === 'alive' && isBleeding) connection.useBandage(itemId);
};
const getContextActions = (item: InventoryItem): readonly InventoryContextAction[] => {
    const { itemId, kind } = item;
    if (isWeaponId(kind)) {
        const remaining = inventoryItems.filter(candidate => candidate.itemId !== itemId);
        const hasSpace =
            hands === null || findInventorySpace({ items: remaining, item: hands }) !== null;

        return [
            {
                id: 'equip',
                label: 'Взять в руки',
                unavailable: hasSpace ? null : 'Освободите место для оружия из рук.',
                run: () => {
                    equipInventoryItem(itemId);
                },
            },
        ];
    }

    if (kind === 'bandage') {
        return [
            {
                id: 'bandage',
                label: 'Перевязаться',
                unavailable: isBleeding ? null : 'Кровотечения нет.',
                run: () => {
                    useInventoryBandage(itemId);
                },
            },
        ];
    }

    return [];
};
const inventoryUi = createInventoryGrid({
    grid: inventoryGrid,
    itemSelectors,
    selector: inventorySelector,
    message: inventoryMessage,
    details: itemDetails,
    panel: inventoryPanel,
    contextMenu: inventoryContext,
    contextActions: getContextActions,
    onMove: (itemId, cell) => {
        if (lifeState === 'alive') connection.moveItem(itemId, cell);
    },
});
let reload: FirearmSnapshot['reload'] = null;
const updateFirearm = (): void => {
    const isAlive = lifeState === 'alive';
    const pistol = hands?.kind === 'pistol' ? hands : null;
    const isPistol = pistol !== null;
    const activeReload =
        isAlive && reload !== null && reload.itemId === pistol?.itemId && reload.remainingTicks > 0
            ? reload
            : null;
    const isReloading = activeReload !== null;
    const rounds = pistol?.rounds ?? 0;
    const isFull = pistol !== null && rounds >= pistol.magazineCapacity;
    const hasAmmo = inventoryItems.some(
        item => item.kind === pistolSettings.ammoKind && item.quantity > 0,
    );

    shotButton.disabled = !isAlive || !isPistol || rounds <= 0 || isReloading;
    reloadButton.disabled = !isAlive || !isPistol || isFull || !hasAmmo || isReloading;
    heldReload.hidden = activeReload === null;
    if (activeReload === null) return;

    const { remainingTicks, totalTicks } = activeReload;
    reloadProgress.max = totalTicks;
    reloadProgress.value = totalTicks - remainingTicks;
    const remainingSeconds = (remainingTicks / movementSettings.ticksPerSecond).toLocaleString(
        'ru-RU',
        { minimumFractionDigits: 1, maximumFractionDigits: 1 },
    );
    const label = `Перезарядка: ${remainingSeconds} с`;
    if (reloadLabel.textContent !== label) reloadLabel.textContent = label;
};
const updateBandage = (): void => {
    const hasBandage = hasPickupSnapshot
        ? inventoryItems.some(item => item.kind === 'bandage')
        : null;
    bandageButton.disabled = !healthUi.update({ state: lastHealth, hasBandage });
    bandageButton.title =
        'Останавливает кровотечение. Без раны бинт не расходуется. HP не восстанавливает.';
};
const weaponDefinitions = { ...meleeWeapons, pistol: pistolSettings };
const equipmentButtons = Object.values(weaponDefinitions).map(weapon => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = weapon.equipLabel;
    button.disabled = true;
    button.setAttribute('aria-pressed', 'false');
    const onEquip = (): void => {
        if (lifeState !== 'alive') return;

        const selected = inventoryUi.selectedItem();
        const item =
            selected?.kind === weapon.id
                ? selected
                : inventoryItems.find(candidate => candidate.kind === weapon.id);

        if (item !== undefined) equipInventoryItem(item.itemId);
    };
    button.addEventListener('click', onEquip);
    weaponOptions.append(button);

    return { weapon: weapon.id, button, onEquip };
});
const profileUi = createPlayerProfileControls({
    form: profileForm,
    input: displayName,
    button: saveName,
    message: profileMessage,
    label: playerName,
    rename: name => connection.renamePlayer(name),
});
const prediction = new MovementPrediction();
let lifeRevision: number | null = null;
let lastMovement: MovementSnapshot | null = null;
let hasPickupSnapshot = false;
let receivedGroundItem: GroundItem | null = null;
let confirmedPosition: WorldPosition | null = null;
let isFlashlightOn = false;
const updateFlashlight = (): void => {
    const isAvailable = confirmedPosition !== null && lifeState === 'alive';
    if (!isAvailable) isFlashlightOn = false;

    scene.setFlashlight(isFlashlightOn);
    flashlightButton.disabled = !isAvailable;
    flashlightButton.setAttribute('aria-pressed', String(isFlashlightOn));
    flashlightButton.textContent = `Фонарик: ${isFlashlightOn ? 'вкл.' : 'выкл.'} (L)`;
};
const onFlashlight = (): void => {
    if (flashlightButton.disabled) return;

    isFlashlightOn = !isFlashlightOn;
    updateFlashlight();
};
let corpses: readonly CorpseLoot[] = [];
const canReachLoot = (from: WorldPosition, to: WorldPosition): boolean =>
    scene.canReachLoot(from, to);
const pickUp = (itemId: string): void => {
    if (lifeState === 'alive') connection.pickUp(itemId);
};
const nearbyUi = createNearbyLoot({
    panel: nearbyPanel,
    status: nearbyStatus,
    groundLabel,
    groundRow,
    groundButton: pickup,
    groundReason,
    corpseList: corpseItems,
    canReach: canReachLoot,
    onPickup: itemId => {
        lootDrag.request(itemId);
    },
    onHighlight: source => {
        scene.setLootHighlight(source);
    },
});
const lootDrag = createLootDrag({
    nearby: nearbyPanel,
    inventory: inventoryPanel,
    zone: lootDropZone,
    status: lootDropStatus,
    getReason: nearbyUi.pickupReason,
    onPickup: pickUp,
});
const updateNearbyVisibility = (hadFocus = nearbyPanel.contains(document.activeElement)): void => {
    const isRequested = inventoryPanel.hidden === false || actionsPanel.hidden === false;
    const hasSources = nearbyPanel.hasAttribute('data-has-sources');
    const isHidden = !isRequested && !hasSources;
    nearbyPanel.hidden = isHidden;
    if (isHidden && hadFocus) container.focus({ preventScroll: true });
};
const updateNearby = (state: Parameters<typeof nearbyUi.update>[0]): void => {
    const hadFocus = nearbyPanel.contains(document.activeElement);
    nearbyUi.update(state);
    updateNearbyVisibility(hadFocus);
    lootDrag.sync();
};
const updatePickup = (): void => {
    if (!hasPickupSnapshot || confirmedPosition === null) {
        updateNearby(null);

        return;
    }

    const ground =
        receivedGroundItem !== null && scene.canSee(receivedGroundItem.position)
            ? receivedGroundItem
            : null;
    updateNearby({
        ground,
        corpses: corpses.filter(corpse => scene.canSee(corpse.position)),
        position: confirmedPosition,
        inventory: inventoryItems,
        life: lifeState,
    });
};
const worldContext = createWorldContext({
    panel: worldContextPanel,
    title: worldContextTarget,
    action: worldContextAction,
    reason: worldContextReason,
    playfield: container,
    getTargets: () => {
        const position = confirmedPosition;
        if (position === null || lifeState !== 'alive' || !hasPickupSnapshot) return [];

        const targets: (LootSource & {
            readonly position: WorldPosition;
            readonly label: string;
            readonly item: GroundItem | null;
        })[] = corpses.map(corpse => ({
            kind: 'corpse',
            id: corpse.corpseId,
            position: corpse.position,
            label: 'Тело',
            item: null,
        }));
        const ground = receivedGroundItem;
        if (ground !== null) {
            targets.push({
                kind: 'ground',
                id: ground.itemId,
                position: ground.position,
                label: itemDisplayName(ground),
                item: ground,
            });
        }

        return targets.flatMap(({ position: target, item, ...source }) => {
            if (!isWithinPickupRange(position, target) || !canReachLoot(position, target))
                return [];

            const point = scene.getLootScreenPoint(target, source.kind);
            if (point === null) return [];

            const reason =
                item === null
                    ? null
                    : getPickupReason(
                          { position, life: lifeState, inventory: inventoryItems },
                          target,
                          item,
                          canReachLoot,
                      );

            return [
                {
                    ...point,
                    ...source,
                    distance: Math.hypot(
                        target.xMeters - position.xMeters,
                        target.yMeters - position.yMeters,
                    ),
                    reason,
                },
            ];
        });
    },
    onAction: ({ kind, id }) => {
        if (kind === 'ground') lootDrag.request(id);
        else nearbyUi.focusCorpse(id);
    },
});
const messages = {
    connecting: 'Подключение к локальному миру…',
    disconnected: 'Связь с хостом потеряна.',
    error: 'Не удалось подключиться к миру. Проверьте сервер хоста; для кооператива откройте действующее приглашение.',
};
const input = createMovementInputController(
    (direction, modifiers) => {
        connection.sendMovement(direction, modifiers);
    },
    {
        onIntentChange: intent => {
            prediction.setIntent(intent, performance.now());
        },
        sendTarget: (target, modifiers) => {
            connection.sendTarget(target, modifiers);
        },
        onTargetChange: target => {
            scene.setDestination(target);
        },
    },
);
const worldHud = createWorldHud({
    summary: worldSummary,
    time: worldTime,
    daylight: daylightLabel,
    weather: weatherLabel,
    waiting: worldClockStatus,
    onFocus: input.reset,
});
const updateWorldTime = (worldTimeMs?: number): void => {
    const state =
        worldTimeMs === undefined
            ? null
            : {
                  worldTimeMs,
                  phase: getDaylightPhase(worldTimeMs),
                  weather: getWorldWeather(worldTimeMs),
              };
    scene.setDaylightPhase(state?.phase ?? null);
    scene.setWeather(state?.weather ?? null, worldTimeMs ?? 0);
    worldHud.setState(state);
};
const fullscreen = createFullscreenControls({
    container: shell,
    button: fullscreenButton,
    message: fullscreenMessage,
    onChange: () => {
        input.reset();
        game.scale.getParentBounds();
        game.scale.refresh();
    },
});
const visitedMap = createVisitedMap({
    viewport: mapViewport,
    coordinates: mapPosition,
    landmarks: mapLandmarks,
    zoomIn: mapZoomIn,
    zoomOut: mapZoomOut,
    centerPlayer: mapCenter,
    markerForm: mapMarkers,
    host: window.location.origin,
});
const nearbyAnchor = document.createComment('nearby panel position');
nearbyPanel.before(nearbyAnchor);
const controlPanels = createControlPanels({
    shell,
    playfield: container,
    panels: [
        {
            element: inventoryPanel,
            button: inventoryToggle,
            shortcut: 'KeyI',
            onVisibilityChange: isOpen => {
                if (isOpen) inventoryPanel.append(nearbyPanel);
                else nearbyAnchor.after(nearbyPanel);
                updateNearbyVisibility();
                lootDrag.sync();
            },
            onEscape: inventoryUi.dismissContextMenu,
        },
        { element: equipmentPanel, button: equipmentToggle, shortcut: 'KeyQ' },
        { element: healthPanel, button: healthToggle, shortcut: 'KeyH' },
        { element: journalPanel, button: journalToggle, shortcut: 'KeyJ' },
        {
            element: mapPanel,
            button: mapToggle,
            shortcut: 'KeyM',
            onVisibilityChange: visitedMap.setOpen,
        },
        {
            element: actionsPanel,
            button: actionsToggle,
            onVisibilityChange: () => {
                updateNearbyVisibility();
            },
        },
        { element: settingsPanel, button: settingsToggle },
        { element: helpPanel, button: helpToggle },
    ],
    protectedRegions: [nearbyPanel, worldContextPanel],
    dismissOverlay: worldContext.close,
    resetInput: input.reset,
});
scene.onVisibilityChange = controlPanels.preserveFocus(updatePickup);
scene.onVisibilityFrame = worldContext.update;
const gameResize = new ResizeObserver(() => {
    game.scale.getParentBounds();
    game.scale.refresh();
});
gameResize.observe(container);
scene.onMove = position => {
    input.moveTo(position);
};
let otherPlayers: readonly PlayerMovementState[] = [];
scene.onFrame = () => {
    const player = prediction.sample(performance.now());
    scene.setPlayer(player);
    const movement =
        player === null
            ? 'Режим: —'
            : `${player.isSneaking ? 'Скрытность' : 'Обычный режим'} · Шум: ${String(player.noiseRadiusMeters)} м`;
    if (movementLabel.textContent !== movement) movementLabel.textContent = movement;
};
const connection = createWorldConnection(
    window.location.origin,
    controlPanels.preserveFocus(state => {
        status.dataset['status'] = state.status;
        reconnect.disabled = state.status === 'connecting' || state.status === 'connected';
        input.setEnabled(state.status === 'connected' && lifeState === 'alive');

        if (state.status === 'connected') {
            const { snapshot } = state;
            lastMovement = snapshot;
            characterHud.setMovement(snapshot.player);
            updateWorldTime(snapshot.worldTimeMs);
            prediction.accept(snapshot, performance.now());
            confirmedPosition = snapshot.player.position;
            visitedMap.accept(snapshot.worldId, confirmedPosition);
            updateFlashlight();
            updatePickup();
            otherPlayers = snapshot.otherPlayers;
            input.updatePosition(snapshot.player.position);
            const { xMeters, yMeters } = snapshot.player.position;
            status.dataset['worldId'] = snapshot.worldId;
            status.dataset['playerId'] = snapshot.player.playerId;
            status.dataset['xMeters'] = String(xMeters);
            status.dataset['yMeters'] = String(yMeters);
            status.dataset['tick'] = String(snapshot.tick);
            status.dataset['stamina'] = String(snapshot.player.stamina);
            status.dataset['exhausted'] = String(snapshot.player.isExhausted);
            status.dataset['sneaking'] = String(snapshot.player.isSneaking);
            status.dataset['noiseRadius'] = String(snapshot.player.noiseRadiusMeters);
            status.dataset['ack'] = String(snapshot.lastProcessedInputSequence);
            if (status.textContent !== 'Мир подключён.') status.textContent = 'Мир подключён.';
            const details = `Позиция: ${xMeters.toFixed(2)}, ${yMeters.toFixed(2)} м. Персонажей: ${String(snapshot.otherPlayers.length + 1)}.`;
            if (connectionDetails.textContent !== details) connectionDetails.textContent = details;
            scene.setPlayers(prediction.sample(performance.now()), otherPlayers);
            status.dataset['playerCount'] = String(snapshot.otherPlayers.length + 1);

            return;
        }

        updateWorldTime();
        profileUi.update(null);
        journal.disconnect();
        visitedMap.disconnect();
        lastHealth = null;
        lifeState = null;
        worldContext.close();
        scene.setAlive(false);
        lifeRevision = null;
        lastMovement = null;
        respawnButton.disabled = true;
        deathScreen.hidden = true;
        prediction.reset();
        health.value = 0;
        healthLabel.textContent = 'Здоровье: —';
        characterHud.reset();
        equipmentHud.reset();
        ammoLabel.textContent = 'Патроны: —';
        hasPickupSnapshot = false;
        lootDrag.reset();
        receivedGroundItem = null;
        corpses = [];
        updateNearby(null);
        scene.setCorpses([]);
        confirmedPosition = null;
        updateFlashlight();
        inventory.textContent = 'Контейнер: —';
        equipmentWeight.textContent = 'Вес снаряжения: —';
        restockLabel.textContent = 'Пополнение рядом: —';
        delete restockLabel.dataset['pointId'];
        delete restockLabel.dataset['readyAtWorldMs'];
        inventoryItems = [];
        isBleeding = false;
        updateBandage();
        hands = null;
        unequip.disabled = true;
        inventoryUi.update(null);
        scene.setGroundItem(null);
        scene.setZombies([]);
        for (const { button } of equipmentButtons) {
            button.disabled = true;
            button.setAttribute('aria-pressed', 'false');
        }
        attack.disabled = true;
        reload = null;
        updateFirearm();
        scene.setWeapon(null);
        weaponLabel.textContent = 'Оружие: —';
        weaponStats.textContent = 'Характеристики: —';
        otherPlayers = [];
        delete status.dataset['worldId'];
        delete status.dataset['playerId'];
        delete status.dataset['xMeters'];
        delete status.dataset['yMeters'];
        delete status.dataset['tick'];
        delete status.dataset['stamina'];
        delete status.dataset['exhausted'];
        delete status.dataset['sneaking'];
        delete status.dataset['noiseRadius'];
        delete status.dataset['ack'];
        delete status.dataset['playerCount'];
        scene.setPlayers(null, []);
        status.textContent = messages[state.status];
        connectionDetails.textContent = 'Позиция: —';
    }),
    command => {
        prediction.recordSent(command, performance.now());
    },
    controlPanels.preserveFocus(snapshot => {
        hasPickupSnapshot = true;
        corpses = snapshot.corpses ?? [];
        scene.setCorpses(corpses);
        receivedGroundItem = snapshot.groundItem;
        scene.setGroundItem(receivedGroundItem);
        inventory.textContent = `Контейнер: предметов ${String(snapshot.items.length)}`;
        inventoryItems = snapshot.items;
        const restock = snapshot.restocks?.[0];
        if (restock === undefined) {
            restockLabel.textContent = 'Пополнение рядом: —';
            delete restockLabel.dataset['pointId'];
            delete restockLabel.dataset['readyAtWorldMs'];
        } else {
            restockLabel.textContent = `Срок пополнения · ${itemDefinitions[restock.kind].name}: ${formatWorldTime(restock.readyAtWorldMs)}`;
            restockLabel.dataset['pointId'] = restock.pointId;
            restockLabel.dataset['readyAtWorldMs'] = String(restock.readyAtWorldMs);
        }
        updateBandage();
        hands = snapshot.hands;
        equipmentHud.acceptEquipment(snapshot);
        const weightGrams = equipmentWeightGrams({ items: snapshot.items, hands });
        equipmentWeight.textContent = `Вес снаряжения: ${String(weightGrams)} г (сетка, руки и боезапас)`;
        updateFirearm();
        ammoLabel.textContent =
            hands?.kind === 'pistol'
                ? `Патроны: ${String(hands.rounds)}/${String(hands.magazineCapacity)}`
                : 'Патроны: —';
        const hasSpace =
            hands === null || findInventorySpace({ items: inventoryItems, item: hands }) !== null;
        unequip.disabled = hands === null || !hasSpace || health.value <= 0;
        unequip.title = hasSpace
            ? 'Перенести предмет из рук в свободную ячейку'
            : 'Недостаточно места в сетке';
        inventoryUi.update(snapshot.items, lifeState === 'alive');
        updatePickup();
        lootDrag.accept(snapshot);
        journal.acceptInventory(snapshot);
    }),
    snapshot => {
        scene.setZombies(snapshot.zombies);
    },
    controlPanels.preserveFocus(snapshot => {
        const nextLife = snapshot.lifeRevision ?? 0;
        if (lifeRevision !== null && nextLife !== lifeRevision) {
            input.reset();
            prediction.reset();
            if (lastMovement !== null) prediction.accept(lastMovement, performance.now());
            scene.setDestination(null);
        }
        lifeRevision = nextLife;
        health.dataset['lifeRevision'] = String(nextLife);
        lifeState = snapshot.lifeState;
        lastHealth = snapshot;
        journal.acceptHealth(snapshot);
        equipmentHud.acceptLife(snapshot);
        const isAlive = lifeState === 'alive';
        scene.setAlive(isAlive);
        updateFlashlight();
        deathScreen.hidden = isAlive;
        respawnButton.disabled = isAlive;
        input.setEnabled(isAlive);

        if (!isAlive) reload = null;

        if (!isAlive) {
            worldContext.close();
            prediction.suspend();
            scene.setDestination(null);
            scene.setWeapon(null);
            unequip.disabled = true;

            for (const { button } of equipmentButtons) button.disabled = true;
        }

        isBleeding = snapshot.bleedingTicks > 0;
        inventoryUi.update(inventoryItems, isAlive);
        updatePickup();
        attack.disabled = attack.disabled || snapshot.health <= 0;
        updateFirearm();
        characterHud.setHealth({ isBleeding, combatTicks: isAlive ? snapshot.combatTicks : 0 });
        health.max = snapshot.maxHealth;
        health.value = snapshot.health;
        updateBandage();
        healthLabel.textContent = `Здоровье: ${String(snapshot.health)} / ${String(snapshot.maxHealth)}`;
    }),
    controlPanels.preserveFocus(snapshot => {
        scene.setWeapon(lifeState === 'alive' ? snapshot.weapon : null);
        const isEquipped = isMeleeWeaponId(snapshot.weapon);
        for (const { weapon, button } of equipmentButtons) {
            const isSelected = snapshot.weapon === weapon;
            const isAvailable = inventoryItems.some(item => item.kind === weapon);
            button.disabled = !isAvailable || health.value <= 0;
            button.setAttribute('aria-pressed', String(isSelected));
        }
        attack.disabled = !isEquipped || health.value <= 0;
        const definition = snapshot.weapon === null ? null : weaponDefinitions[snapshot.weapon];
        weaponLabel.textContent =
            definition === null ? 'Оружие: в руках пусто' : `Оружие: ${definition.name}`;
        const formatNumber = (value: number): string => value.toLocaleString('ru-RU');
        weaponStats.textContent =
            definition === null
                ? 'Экипируйте оружие из сетки.'
                : `Урон: ${String(definition.damage)} · Дальность: ${formatNumber(definition.rangeMeters)} м · Пауза: ${formatNumber(definition.cooldownTicks / movementSettings.ticksPerSecond)} с`;
    }),
    snapshot => {
        profileUi.update(snapshot);
    },
    action => {
        if (lifeState === 'alive') scene.playAttack(action);
    },
    action => {
        if (lifeState === 'alive') scene.playShot(action);
    },
    snapshot => {
        reload = snapshot.reload;
        updateFirearm();
    },
);
const session = createWorldSession();
let connectAttempt = 0;
let isPageActive = true;
const onConnect = (): void => {
    const attempt = ++connectAttempt;
    reconnect.disabled = true;
    status.dataset['status'] = 'connecting';
    status.textContent = messages.connecting;
    session
        .ensure()
        .then(async () => {
            if (isPageActive && attempt === connectAttempt) {
                await connection.connect();
            }
        })
        .catch(() => {
            if (!isPageActive || attempt !== connectAttempt) {
                return;
            }

            status.dataset['status'] = 'error';
            status.textContent = messages.error;
            reconnect.disabled = false;
        });
};
const onPageHide = (): void => {
    isPageActive = false;
    connectAttempt++;
    session.cancel();
    connection.disconnect();
};
const onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) {
        isPageActive = true;
        onConnect();
    }
};
const onUnequip = (): void => {
    if (lifeState === 'alive' && hands !== null)
        connection.sendMelee({ type: 'unequip-weapon', itemId: hands.itemId });
};
const onUseBandage = (): void => {
    const bandage = inventoryItems.find(item => item.kind === 'bandage');

    if (!bandageButton.disabled && bandage !== undefined) useInventoryBandage(bandage.itemId);
};
bandageButton.addEventListener('click', onUseBandage);
panelBandage.addEventListener('click', onUseBandage);
unequip.addEventListener('click', onUnequip);
const onAttack = (): void => {
    if (!attack.disabled) connection.sendMelee({ type: 'melee-attack' });
};
const onShot = (): void => {
    if (!shotButton.disabled) connection.shoot(scene.aimDirection());
};

scene.onShoot = aim => {
    if (!shotButton.disabled) connection.shoot(aim);
};

shotButton.addEventListener('click', onShot);
const onReload = (): void => {
    if (!reloadButton.disabled) connection.reloadWeapon();
};

reloadButton.addEventListener('click', onReload);
const onPlayfieldPointerDown = (event: PointerEvent): void => {
    if (event.target instanceof HTMLCanvasElement) container.focus({ preventScroll: true });
};
const onGameActionKey = (event: KeyboardEvent): void => {
    const target = event.target;

    if (target === controlScroll) {
        return;
    }

    const isEditing =
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    const isModified = event.ctrlKey || event.metaKey || event.altKey;

    if (
        event.code === 'KeyE' &&
        (target === container || target === document.body) &&
        !isModified &&
        !event.shiftKey
    ) {
        event.preventDefault();
        if (!event.repeat) worldContext.open();

        return;
    }

    if (event.code === 'KeyL' && !isEditing && !isModified) {
        event.preventDefault();
        if (!event.repeat) onFlashlight();

        return;
    }

    if (event.code === 'Space' && !isEditing && !isModified) {
        event.preventDefault();
        if (!event.repeat) onShot();

        return;
    }

    if (event.code === 'KeyR' && !isEditing && !isModified) {
        event.preventDefault();
        if (!event.repeat) onReload();

        return;
    }

    const isAttackKey =
        event.code === 'KeyF' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (isAttackKey && !isEditing) {
        event.preventDefault();
        onAttack();
    }
};
attack.addEventListener('click', onAttack);
container.addEventListener('pointerdown', onPlayfieldPointerDown);
window.addEventListener('keydown', onGameActionKey);
flashlightButton.addEventListener('click', onFlashlight);
const onRespawn = (): void => {
    if (lifeState === 'dead') connection.respawn();
};
respawnButton.addEventListener('click', onRespawn);
reconnect.addEventListener('click', onConnect);
window.addEventListener('pagehide', onPageHide);
window.addEventListener('pageshow', onPageShow);
onConnect();

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        isPageActive = false;
        connectAttempt++;
        session.cancel();
        gameResize.disconnect();
        fullscreen.dispose();
        interfaceScale.dispose();
        controlPanels.dispose();
        visitedMap.dispose();
        worldHud.dispose();
        input.dispose();
        profileUi.dispose();
        inventoryUi.dispose();
        worldContext.dispose();
        lootDrag.dispose();
        nearbyUi.dispose();
        nearbyAnchor.remove();
        connection.dispose();
        for (const { button, onEquip } of equipmentButtons) {
            button.removeEventListener('click', onEquip);
            button.remove();
        }
        unequip.removeEventListener('click', onUnequip);
        bandageButton.removeEventListener('click', onUseBandage);
        panelBandage.removeEventListener('click', onUseBandage);
        attack.removeEventListener('click', onAttack);
        shotButton.removeEventListener('click', onShot);
        reloadButton.removeEventListener('click', onReload);
        container.removeEventListener('pointerdown', onPlayfieldPointerDown);
        window.removeEventListener('keydown', onGameActionKey);
        flashlightButton.removeEventListener('click', onFlashlight);
        respawnButton.removeEventListener('click', onRespawn);
        reconnect.removeEventListener('click', onConnect);
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('pageshow', onPageShow);
        game.destroy(true);
    });
}
