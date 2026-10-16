import './style.css';

import { AUTO, Game, Scale } from 'phaser';

import { BootScene } from './boot-scene';
import { createMovementInputController } from './movement-input';
import { createWorldConnection } from './world-connection';
import { createWorldSession } from './world-session';

const container = document.querySelector<HTMLElement>('#game');
const status = document.querySelector<HTMLElement>('#connection-status');
const reconnect = document.querySelector<HTMLButtonElement>('#reconnect');

if (!container || !status || !reconnect) {
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

const messages = {
    connecting: 'Подключение к локальному миру…',
    disconnected: 'Связь с хостом потеряна.',
    error: 'Не удалось подключиться к миру. Проверьте сервер хоста; для кооператива откройте действующее приглашение.',
};
const input = createMovementInputController(
    direction => {
        connection.sendMovement(direction);
    },
    {
        sendTarget: target => {
            connection.sendTarget(target);
        },
        onTargetChange: target => {
            scene.setDestination(target);
        },
    },
);
scene.onMove = position => {
    input.moveTo(position);
};
const connection = createWorldConnection(window.location.origin, state => {
    status.dataset['status'] = state.status;
    reconnect.disabled = state.status === 'connecting' || state.status === 'connected';
    input.setEnabled(state.status === 'connected');

    if (state.status === 'connected') {
        const { snapshot } = state;
        input.updatePosition(snapshot.player.position);
        const { xMeters, yMeters } = snapshot.player.position;
        status.dataset['worldId'] = snapshot.worldId;
        status.dataset['playerId'] = snapshot.player.playerId;
        status.dataset['xMeters'] = String(xMeters);
        status.dataset['yMeters'] = String(yMeters);
        status.dataset['tick'] = String(snapshot.tick);
        status.dataset['ack'] = String(snapshot.lastProcessedInputSequence);
        status.textContent = `Мир подключён. Позиция: ${xMeters.toFixed(2)}, ${yMeters.toFixed(2)} м. Персонажей: ${String(snapshot.otherPlayers.length + 1)}.`;
        scene.setPlayers(snapshot.player, snapshot.otherPlayers);
        status.dataset['playerCount'] = String(snapshot.otherPlayers.length + 1);

        return;
    }

    delete status.dataset['worldId'];
    delete status.dataset['playerId'];
    delete status.dataset['xMeters'];
    delete status.dataset['yMeters'];
    delete status.dataset['tick'];
    delete status.dataset['ack'];
    delete status.dataset['playerCount'];
    scene.setPlayers(null, []);
    status.textContent = messages[state.status];
});
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
