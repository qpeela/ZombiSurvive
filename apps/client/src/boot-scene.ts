import { Scene } from 'phaser';

export class BootScene extends Scene {
    constructor() {
        super('boot');
    }

    create(): void {
        this.game.canvas.dataset['sceneReady'] = 'true';
        this.game.canvas.setAttribute('aria-label', 'Игровое поле ZombiSurvive');
    }
}
