import './style.css';

import { AUTO, Game, Scale } from 'phaser';

import { BootScene } from './boot-scene';

const container = document.querySelector<HTMLElement>('#game');

if (!container) {
    throw new Error('Game container is missing.');
}

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
    scene: [BootScene],
});

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        game.destroy(true);
    });
}
