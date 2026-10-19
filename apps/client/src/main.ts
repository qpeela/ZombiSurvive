import './style.css';

import type { PlayerMovementState } from '@zombi-survive/domain';
import { AUTO, Game, Scale } from 'phaser';

import { BootScene } from './boot-scene';
import { createMovementInputController } from './movement-input';
import { MovementPrediction } from './movement-prediction';
import { createWorldConnection } from './world-connection';
import { createWorldSession } from './world-session';

const container = document.querySelector<HTMLElement>('#game');
const status = document.querySelector<HTMLElement>('#connection-status');
const reconnect = document.querySelector<HTMLButtonElement>('#reconnect');
const stamina = document.querySelector<HTMLProgressElement>('#stamina');
const staminaLabel = document.querySelector<HTMLElement>('#stamina-label');

if (!container || !status || !reconnect || !stamina || !staminaLabel) {
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

const prediction = new MovementPrediction();
const messages = {
    connecting: 'Подключение к локальному миру…',
    disconnected: 'Связь с хостом потеряна.',
    error: 'Не удалось подключиться к миру. Проверьте сервер хоста; для кооператива откройте действующее приглашение.',
};
const input = createMovementInputController(
    (direction, isSprinting) => {
        connection.sendMovement(direction, isSprinting);
    },
    {
        onIntentChange: intent => {
            prediction.setIntent(intent, performance.now());
        },
        sendTarget: (target, isSprinting) => {
            connection.sendTarget(target, isSprinting);
        },
        onTargetChange: target => {
            scene.setDestination(target);
        },
    },
);
scene.onMove = position => {
    input.moveTo(position);
};
let otherPlayers: readonly PlayerMovementState[] = [];
scene.onFrame = () => {
    const player = prediction.sample(performance.now());
    scene.setPlayer(player);
    stamina.value = player?.stamina ?? 0;
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
            status.dataset['ack'] = String(snapshot.lastProcessedInputSequence);
            status.textContent = `Мир подключён. Позиция: ${xMeters.toFixed(2)}, ${yMeters.toFixed(2)} м. Персонажей: ${String(snapshot.otherPlayers.length + 1)}.`;
            scene.setPlayers(prediction.sample(performance.now()), otherPlayers);
            status.dataset['playerCount'] = String(snapshot.otherPlayers.length + 1);

            return;
        }

        prediction.reset();
        otherPlayers = [];
        delete status.dataset['worldId'];
        delete status.dataset['playerId'];
        delete status.dataset['xMeters'];
        delete status.dataset['yMeters'];
        delete status.dataset['tick'];
        delete status.dataset['stamina'];
        delete status.dataset['exhausted'];
        delete status.dataset['ack'];
        delete status.dataset['playerCount'];
        scene.setPlayers(null, []);
        status.textContent = messages[state.status];
    },
    command => {
        prediction.recordSent(command, performance.now());
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
reconnect.addEventListener('click', onConnect);
window.addEventListener('pagehide', onPageHide);
window.addEventListener('pageshow', onPageShow);
onConnect();

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        isPageActive = false;
        connectAttempt++;
        session.cancel();
        input.dispose();
        connection.dispose();
        reconnect.removeEventListener('click', onConnect);
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('pageshow', onPageShow);
        game.destroy(true);
    });
}
