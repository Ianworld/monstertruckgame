import './style.css';
import { GameManager } from './game/GameManager.js';

document.addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('app');
    const gameManager = new GameManager(app);
    gameManager.start();
});
