import './style.css';

import { AUTO, Game, Scale } from 'phaser';

import { BootScene } from './boot-scene';
import { createMovementInputController } from './movement-input';
import { createWorldConnection } from './world-connection';

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
    error: 'Не удалось подключиться к миру. Проверьте, что сервер хоста запущен.',
};
const input = createMovementInputController(direction => {
    connection.sendMovement(direction);
});
const connection = createWorldConnection(window.location.origin, state => {
    status.dataset['status'] = state.status;
    reconnect.disabled = state.status === 'connecting' || state.status === 'connected';
    input.setEnabled(state.status === 'connected');

    if (state.status === 'connected') {
        const { snapshot } = state;
        const { xMeters, yMeters } = snapshot.player.position;
        status.dataset['worldId'] = snapshot.worldId;
        status.dataset['playerId'] = snapshot.player.playerId;
        status.dataset['xMeters'] = String(xMeters);
        status.dataset['yMeters'] = String(yMeters);
        status.dataset['tick'] = String(snapshot.tick);
        status.dataset['ack'] = String(snapshot.lastProcessedInputSequence);
        status.textContent = `Локальный мир подключён. Позиция: ${xMeters.toFixed(2)}, ${yMeters.toFixed(2)} м.`;
        scene.setPlayer(snapshot.player);

        return;
    }

    delete status.dataset['worldId'];
    delete status.dataset['playerId'];
    delete status.dataset['xMeters'];
    delete status.dataset['yMeters'];
    delete status.dataset['tick'];
    delete status.dataset['ack'];
    scene.setPlayer(null);
    status.textContent = messages[state.status];
});
const onConnect = (): void => {
    connection.connect().catch(() => {
        status.textContent = messages.error;
        reconnect.disabled = false;
    });
};
const onPageHide = (): void => {
    connection.disconnect();
};
const onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) {
        onConnect();
    }
};
reconnect.addEventListener('click', onConnect);
window.addEventListener('pagehide', onPageHide);
window.addEventListener('pageshow', onPageShow);
onConnect();

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        input.dispose();
        connection.dispose();
        reconnect.removeEventListener('click', onConnect);
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('pageshow', onPageShow);
        game.destroy(true);
    });
}
