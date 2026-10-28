import './style.css';

import { meleeWeapons, movementSettings, pickupSettings } from '@zombi-survive/content';
import type { GroundItem, PlayerMovementState, WorldPosition } from '@zombi-survive/domain';
import { AUTO, Game, Scale } from 'phaser';

import { BootScene } from './boot-scene';
import { createFullscreenControls } from './fullscreen';
import { createInventoryGrid } from './inventory-grid';
import { createMovementInputController } from './movement-input';
import { MovementPrediction } from './movement-prediction';
import { createPlayerProfileControls } from './player-profile';
import { createWorldConnection } from './world-connection';
import { createWorldSession } from './world-session';

const profileForm = document.querySelector<HTMLFormElement>('#player-profile');
const displayName = document.querySelector<HTMLInputElement>('#display-name');
const saveName = document.querySelector<HTMLButtonElement>('#save-name');
const profileMessage = document.querySelector<HTMLElement>('#profile-message');
const playerName = document.querySelector<HTMLElement>('#player-name');
const shell = document.querySelector<HTMLElement>('.game-shell');
const fullscreenButton = document.querySelector<HTMLButtonElement>('#fullscreen');
const fullscreenMessage = document.querySelector<HTMLElement>('#fullscreen-message');
const container = document.querySelector<HTMLElement>('#game');
const status = document.querySelector<HTMLElement>('#connection-status');
const weaponOptions = document.querySelector<HTMLElement>('#weapon-options');
const weaponStats = document.querySelector<HTMLElement>('#weapon-stats');
const attack = document.querySelector<HTMLButtonElement>('#melee-attack');
const weaponLabel = document.querySelector<HTMLElement>('#weapon-label');
const reconnect = document.querySelector<HTMLButtonElement>('#reconnect');
const stamina = document.querySelector<HTMLProgressElement>('#stamina');
const staminaLabel = document.querySelector<HTMLElement>('#stamina-label');
const health = document.querySelector<HTMLProgressElement>('#health');
const healthLabel = document.querySelector<HTMLElement>('#health-label');
const movementLabel = document.querySelector<HTMLElement>('#movement-label');
const groundLabel = document.querySelector<HTMLElement>('#ground-item');
const inventory = document.querySelector<HTMLElement>('#inventory');
const pickup = document.querySelector<HTMLButtonElement>('#pickup');
const inventoryGrid = document.querySelector<HTMLElement>('#inventory-grid');
const inventorySelector = document.querySelector<HTMLButtonElement>('#inventory-select');
const inventoryMessage = document.querySelector<HTMLElement>('#inventory-message');

if (
    !profileForm ||
    !displayName ||
    !saveName ||
    !profileMessage ||
    !playerName ||
    !shell ||
    !fullscreenButton ||
    !fullscreenMessage ||
    !weaponOptions ||
    !weaponStats ||
    !attack ||
    !weaponLabel ||
    !container ||
    !status ||
    !reconnect ||
    !stamina ||
    !staminaLabel ||
    !health ||
    !healthLabel ||
    !movementLabel ||
    !groundLabel ||
    !inventory ||
    !pickup ||
    !inventoryGrid ||
    !inventorySelector ||
    !inventoryMessage
) {
    throw new Error('Game UI is missing.');
}

const scene = new BootScene();
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

const inventoryUi = createInventoryGrid({
    grid: inventoryGrid,
    selector: inventorySelector,
    message: inventoryMessage,
    onMove: (itemId, cell) => {
        connection.moveItem(itemId, cell);
    },
});
const equipmentButtons = Object.values(meleeWeapons).map(weapon => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = weapon.equipLabel;
    button.disabled = true;
    button.setAttribute('aria-pressed', 'false');
    const onEquip = (): void => {
        connection.sendMelee({ type: 'equip-weapon', weapon: weapon.id });
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
let groundItem: GroundItem | null = null;
let confirmedPosition: WorldPosition | null = null;
const updatePickup = (): void => {
    const distance =
        groundItem === null || confirmedPosition === null
            ? Infinity
            : Math.hypot(
                  groundItem.position.xMeters - confirmedPosition.xMeters,
                  groundItem.position.yMeters - confirmedPosition.yMeters,
              );
    pickup.disabled = distance > pickupSettings.rangeMeters;
};
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
    stamina.value = player?.stamina ?? 0;
    movementLabel.textContent =
        player === null
            ? 'Режим: —'
            : `${player.isSneaking ? 'Скрытность' : 'Обычный режим'} · Шум: ${String(player.noiseRadiusMeters)} м`;
    staminaLabel.textContent =
        player === null
            ? 'Выносливость: —'
            : `Выносливость: ${String(Math.round(player.stamina * 100))}%${player.isExhausted ? ' · Восстановление до 20%' : ''}`;
};
const connection = createWorldConnection(
    window.location.origin,
    state => {
        status.dataset['status'] = state.status;
        reconnect.disabled = state.status === 'connecting' || state.status === 'connected';
        input.setEnabled(state.status === 'connected');

        if (state.status === 'connected') {
            const { snapshot } = state;
            prediction.accept(snapshot, performance.now());
            confirmedPosition = snapshot.player.position;
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
            status.textContent = `Мир подключён. Позиция: ${xMeters.toFixed(2)}, ${yMeters.toFixed(2)} м. Персонажей: ${String(snapshot.otherPlayers.length + 1)}.`;
            scene.setPlayers(prediction.sample(performance.now()), otherPlayers);
            status.dataset['playerCount'] = String(snapshot.otherPlayers.length + 1);

            return;
        }

        profileUi.update(null);
        prediction.reset();
        health.value = 0;
        healthLabel.textContent = 'Здоровье: —';
        groundItem = null;
        confirmedPosition = null;
        pickup.disabled = true;
        groundLabel.textContent = 'На земле: —';
        inventory.textContent = 'Контейнер: —';
        inventoryUi.update(null);
        scene.setGroundItem(null);
        scene.setZombies([]);
        for (const { button } of equipmentButtons) {
            button.disabled = true;
            button.setAttribute('aria-pressed', 'false');
        }
        attack.disabled = true;
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
    },
    command => {
        prediction.recordSent(command, performance.now());
    },
    snapshot => {
        groundItem = snapshot.groundItem;
        scene.setGroundItem(groundItem);
        groundLabel.textContent =
            groundItem === null ? 'На земле: пусто' : 'На земле: Бинт · 2, 2 м';
        inventory.textContent =
            snapshot.items.length === 0 ? 'Контейнер: пусто' : 'Контейнер: Бинт × 1';
        inventoryUi.update(snapshot.items);
        updatePickup();
    },
    snapshot => {
        scene.setZombies(snapshot.zombies);
    },
    snapshot => {
        attack.disabled = attack.disabled || snapshot.health <= 0;
        health.max = snapshot.maxHealth;
        health.value = snapshot.health;
        healthLabel.textContent = `Здоровье: ${String(snapshot.health)} / ${String(snapshot.maxHealth)}`;
    },
    snapshot => {
        scene.setWeapon(snapshot.weapon);
        const isEquipped = snapshot.weapon !== null;
        for (const { weapon, button } of equipmentButtons) {
            const isSelected = snapshot.weapon === weapon;
            button.disabled = isSelected || health.value <= 0;
            button.setAttribute('aria-pressed', String(isSelected));
        }
        attack.disabled = !isEquipped || health.value <= 0;
        const definition = snapshot.weapon === null ? null : meleeWeapons[snapshot.weapon];
        weaponLabel.textContent =
            definition === null ? 'Оружие: в руках пусто' : `Оружие: ${definition.name}`;
        const formatNumber = (value: number): string => value.toLocaleString('ru-RU');
        weaponStats.textContent =
            definition === null
                ? 'Выберите стартовое оружие.'
                : `Урон: ${String(definition.damage)} · Дальность: ${formatNumber(definition.rangeMeters)} м · Пауза: ${formatNumber(definition.cooldownTicks / movementSettings.ticksPerSecond)} с`;
    },
    snapshot => {
        profileUi.update(snapshot);
    },
    action => {
        scene.playAttack(action);
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
const onPickup = (): void => {
    if (groundItem !== null) {
        connection.pickUp(groundItem.itemId);
    }
};
const onAttack = (): void => {
    if (!attack.disabled) connection.sendMelee({ type: 'melee-attack' });
};
const onAttackKey = (event: KeyboardEvent): void => {
    const target = event.target;
    const isEditing =
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    const isAttackKey =
        event.code === 'KeyF' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (isAttackKey && !isEditing) {
        event.preventDefault();
        onAttack();
    }
};
attack.addEventListener('click', onAttack);
window.addEventListener('keydown', onAttackKey);
pickup.addEventListener('click', onPickup);
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
        input.dispose();
        profileUi.dispose();
        inventoryUi.dispose();
        connection.dispose();
        for (const { button, onEquip } of equipmentButtons) {
            button.removeEventListener('click', onEquip);
            button.remove();
        }
        attack.removeEventListener('click', onAttack);
        window.removeEventListener('keydown', onAttackKey);
        pickup.removeEventListener('click', onPickup);
        reconnect.removeEventListener('click', onConnect);
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('pageshow', onPageShow);
        game.destroy(true);
    });
}
