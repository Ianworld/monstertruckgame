import './style.css';
import { GameManager } from './game/GameManager.js';

document.addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('app');
    const gameManager = new GameManager(app);

    // Dev-only handle so physics can be poked from the console:
    // game.truck1.suspension[0].compression, game.tuning.springStiffness = 0.01, ...
    if (import.meta.env.DEV) window.game = gameManager;

    gameManager.start();
});
