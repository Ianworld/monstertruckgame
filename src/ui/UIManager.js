import { CharacterGraphics } from '../game/CharacterGraphics.js';
import { DEFAULT_TUNING } from '../game/TruckTuning.js';

export class UIManager {
    constructor(container, callbacks) {
        this.container = container;
        this.callbacks = callbacks;
        this.isTwoPlayer = true; // Default to 2-Player Split Screen Race

        this.buildUI();
    }

    buildUI() {
        this.uiLayer = document.createElement('div');
        this.uiLayer.className = 'ui-layer';
        this.container.appendChild(this.uiLayer);

        // --- TOP-CENTER TRACK PROGRESS BAR & CENTRAL TIMER ---
        this.trackHeader = document.createElement('div');
        this.trackHeader.className = 'track-header';
        this.trackHeader.innerHTML = `
            <div class="timer-display" id="race-timer">00:00.00</div>
            <div class="progress-bar-container">
                <span class="flag-icon start-flag">🏁 START</span>
                <div class="progress-track">
                    <div class="player-icon p1-icon" id="p1-track-icon">P1</div>
                    <div class="player-icon p2-icon" id="p2-track-icon">P2</div>
                </div>
                <span class="flag-icon finish-flag">🏆 FINISH</span>
            </div>
        `;
        this.uiLayer.appendChild(this.trackHeader);

        // --- SPLIT SCREEN HUDS ---
        this.p1Hud = this.createPlayerHUD('p1', 'PLAYER 1', '#58a6ff');
        this.p2Hud = this.createPlayerHUD('p2', 'PLAYER 2', '#ff7b72');

        this.p1Hud.el.classList.add('top-hud');
        this.p2Hud.el.classList.add('bottom-hud');

        this.uiLayer.appendChild(this.p1Hud.el);
        this.uiLayer.appendChild(this.p2Hud.el);

        // --- COUNTDOWN OVERLAY ---
        this.countdownEl = document.createElement('div');
        this.countdownEl.className = 'countdown-overlay';
        this.uiLayer.appendChild(this.countdownEl);

        // --- CELEBRATION / NOTIFICATION BANNER ---
        this.celebration = document.createElement('div');
        this.celebration.className = 'celebration';
        this.uiLayer.appendChild(this.celebration);

        // --- VICTORY MODAL ---
        this.buildVictoryModal();

        // --- CONTROLS OVERLAY ---
        this.controlsOverlay = document.createElement('div');
        this.controlsOverlay.className = 'controls-overlay';
        this.controlsOverlay.innerHTML = `
            <span>[P1]</span> W (Jump / hold to Flip) | A/D (Drive) | L-Shift (Boost) &nbsp;&nbsp;&nbsp;&nbsp;
            <span>[P2]</span> Up (Jump / hold to Flip) | Left/Right (Drive) | R-Shift (Boost)
        `;
        this.uiLayer.appendChild(this.controlsOverlay);

        // --- FULLSCREEN BUTTON ---
        this.fullscreenBtn = document.createElement('div');
        this.fullscreenBtn.className = 'fullscreen-btn';
        this.fullscreenBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
            </svg>
        `;
        this.fullscreenBtn.onclick = () => this.toggleFullscreen();
        this.uiLayer.appendChild(this.fullscreenBtn);

        // --- MAIN MENU & DEBUG ---
        this.buildMenu();
        this.buildDebugMenu();
    }

    createPlayerHUD(playerId, labelText, colorHex) {
        const el = document.createElement('div');
        el.className = `player-hud ${playerId}-hud-panel`;

        el.innerHTML = `
            <div class="hud-badge" style="border-color: ${colorHex}; color: ${colorHex}">
                <span class="hud-player-name">${labelText}</span>
                <span class="hud-rank" id="${playerId}-rank">1ST</span>
            </div>
            <div class="hud-metrics">
                <div class="hud-metric">
                    <span class="metric-label">SPEED</span>
                    <span class="metric-value" id="${playerId}-speed">0 MPH</span>
                </div>
                <div class="hud-metric">
                    <span class="metric-label">BOOST</span>
                    <div class="boost-bar-outer">
                        <div class="boost-bar-inner" id="${playerId}-boost-bar" style="width: 100%; background: ${colorHex}"></div>
                    </div>
                </div>
                <div class="hud-metric">
                    <span class="metric-label">COINS</span>
                    <span class="metric-value" id="${playerId}-coins">0</span>
                </div>
                <div class="hud-metric">
                    <span class="metric-label">DISTANCE</span>
                    <span class="metric-value" id="${playerId}-dist">0 m</span>
                </div>
            </div>
        `;

        return { el };
    }

    buildMenu() {
        this.menu = document.createElement('div');
        this.menu.className = 'menu';

        const title = document.createElement('h1');
        title.className = 'title';
        title.innerText = 'MONSTER TRUCK SPLIT-SCREEN RACE';
        this.menu.appendChild(title);

        const subTitle = document.createElement('p');
        subTitle.className = 'subtitle';
        subTitle.innerText = 'Race to the Finish Line in ~60 Seconds!';
        this.menu.appendChild(subTitle);

        const playersContainer = document.createElement('div');
        playersContainer.className = 'players-container';
        playersContainer.style.display = 'flex';
        playersContainer.style.gap = '40px';
        playersContainer.style.marginBottom = '20px';

        this.p1Config = { truckStyle: 'monster', driverStyle: 'gabby' };
        this.p2Config = { truckStyle: 'dinosaur', driverStyle: 'barbie' };
        this.previews = {};

        const p1UI = this.createPlayerSelection('Player 1 (Top Screen)', this.p1Config, 'p1');
        const p2UI = this.createPlayerSelection('Player 2 (Bottom Screen)', this.p2Config, 'p2');

        playersContainer.appendChild(p1UI.container);
        playersContainer.appendChild(p2UI.container);
        this.menu.appendChild(playersContainer);

        const startBtn = document.createElement('button');
        startBtn.className = 'start-btn';
        startBtn.innerText = 'START SPLIT-SCREEN RACE 🏁';
        startBtn.onclick = (e) => {
            e.target.blur();
            if (this.callbacks.onStart) {
                this.callbacks.onStart({
                    player1: this.p1Config,
                    player2: this.p2Config
                });
            }
        };
        this.menu.appendChild(startBtn);

        this.container.appendChild(this.menu);

        this.updatePreview('p1');
        this.updatePreview('p2');
    }

    createPlayerSelection(titleText, config, playerId) {
        const container = document.createElement('div');
        container.className = 'player-config';

        const title = document.createElement('h2');
        title.innerText = titleText;
        title.style.marginBottom = '10px';
        title.style.color = playerId === 'p1' ? '#58a6ff' : '#ff7b72';
        container.appendChild(title);

        const previewContainer = document.createElement('div');
        previewContainer.className = 'preview-box';
        previewContainer.style.borderColor = playerId === 'p1' ? '#58a6ff' : '#ff7b72';

        const truckPreview = document.createElement('div');
        truckPreview.style.position = 'absolute';
        truckPreview.style.bottom = '0';
        truckPreview.style.left = '0';
        truckPreview.style.width = '100%';
        truckPreview.style.height = '100%';

        const driverPreview = document.createElement('div');
        driverPreview.style.position = 'absolute';
        driverPreview.style.bottom = '45px';
        driverPreview.style.left = '110px';
        driverPreview.style.width = '90px';
        driverPreview.style.height = '90px';
        driverPreview.style.zIndex = '2';

        previewContainer.appendChild(truckPreview);
        previewContainer.appendChild(driverPreview);
        container.appendChild(previewContainer);

        this.previews[playerId] = { truckPreview, driverPreview, config };

        const options = document.createElement('div');
        options.className = 'menu-options';

        const truckGroup = this.createSelectorGroup('Truck Style', [
            { id: 'monster' },
            { id: 'dinosaur' },
            { id: 'space' },
            { id: 'bumblebee' },
            { id: 'barbie' },
            { id: 'plane' }
        ], (id) => {
            config.truckStyle = id;
            this.updatePreview(playerId);
        }, 'truck', config.truckStyle);

        const driverGroup = this.createSelectorGroup('Driver', [
            { id: 'gabby' },
            { id: 'daniel_tiger' },
            { id: 'ms_rachel' },
            { id: 'nerd' },
            { id: 'barbie' }
        ], (id) => {
            config.driverStyle = id;
            this.updatePreview(playerId);
        }, 'driver', config.driverStyle);

        options.appendChild(truckGroup);
        options.appendChild(driverGroup);
        container.appendChild(options);

        return { container };
    }

    updatePreview(playerId) {
        const previewObj = this.previews[playerId];
        if (!previewObj) return;

        const { truckPreview, driverPreview, config } = previewObj;
        const color = CharacterGraphics.getTruckColors(config.truckStyle)[0];

        truckPreview.innerHTML = CharacterGraphics.generateTruckSVG(config.truckStyle, color);
        const svg = truckPreview.querySelector('svg');
        if (svg) {
            svg.style.transform = 'scale(0.85) translateY(15px)';
            svg.style.transformOrigin = 'bottom center';
        }

        driverPreview.innerHTML = CharacterGraphics.generateDriverSVG(config.driverStyle);
    }

    createSelectorGroup(titleText, items, onSelect, type, initialSelected) {
        const group = document.createElement('div');
        group.className = 'option-group';

        const title = document.createElement('h3');
        title.innerText = titleText;
        group.appendChild(title);

        const selector = document.createElement('div');
        selector.className = 'card-selector';

        items.forEach((item) => {
            const card = document.createElement('div');
            card.className = 'card';
            if (item.id === initialSelected) card.classList.add('selected');

            const visual = document.createElement('div');
            visual.style.width = '70px';
            visual.style.height = '50px';
            visual.style.display = 'flex';
            visual.style.alignItems = 'center';
            visual.style.justifyContent = 'center';

            if (type === 'truck') {
                const color = CharacterGraphics.getTruckColors(item.id)[0];
                visual.innerHTML = CharacterGraphics.generateTruckSVG(item.id, color);
            } else {
                visual.innerHTML = CharacterGraphics.generateDriverSVG(item.id);
            }

            card.appendChild(visual);

            card.onclick = () => {
                const siblings = selector.querySelectorAll('.card');
                siblings.forEach(s => s.classList.remove('selected'));
                card.classList.add('selected');
                onSelect(item.id);
            };

            selector.appendChild(card);
        });

        group.appendChild(selector);
        return group;
    }

    buildVictoryModal() {
        this.victoryModal = document.createElement('div');
        this.victoryModal.className = 'victory-modal hidden';
        this.victoryModal.innerHTML = `
            <div class="victory-card">
                <div class="victory-trophy">🏆</div>
                <h1 class="victory-title" id="winner-title">PLAYER 1 WINS!</h1>
                <div class="victory-time" id="winner-time">TIME: 00:54.32</div>
                
                <div class="victory-stats">
                    <div class="v-stat-row">
                        <span class="v-label">P1 Distance:</span>
                        <span class="v-val" id="v-p1-dist">30,000 m</span>
                    </div>
                    <div class="v-stat-row">
                        <span class="v-label">P2 Distance:</span>
                        <span class="v-val" id="v-p2-dist">28,450 m</span>
                    </div>
                    <div class="v-stat-row">
                        <span class="v-label">P1 Coins Collected:</span>
                        <span class="v-val" id="v-p1-coins">12</span>
                    </div>
                    <div class="v-stat-row">
                        <span class="v-label">P2 Coins Collected:</span>
                        <span class="v-val" id="v-p2-coins">9</span>
                    </div>
                </div>

                <div class="victory-buttons">
                    <button class="v-btn play-again-btn" id="v-restart-btn">RACE AGAIN 🏎️</button>
                    <button class="v-btn menu-btn" id="v-menu-btn">CHANGE VEHICLES ⚙️</button>
                </div>
            </div>
        `;

        this.uiLayer.appendChild(this.victoryModal);

        document.getElementById('v-restart-btn').onclick = () => {
            this.victoryModal.classList.add('hidden');
            if (this.callbacks.onRestart) this.callbacks.onRestart();
        };

        document.getElementById('v-menu-btn').onclick = () => {
            this.victoryModal.classList.add('hidden');
            this.showMenu();
        };
    }

    startCountdown() {
        this.countdownEl.classList.add('active');
        this.countdownEl.innerText = '3';

        setTimeout(() => { this.countdownEl.innerText = '2'; }, 1000);
        setTimeout(() => { this.countdownEl.innerText = '1'; }, 2000);
        setTimeout(() => {
            this.countdownEl.innerText = 'GO!';
            this.countdownEl.style.color = '#2ea043';
        }, 3000);

        setTimeout(() => {
            this.countdownEl.classList.remove('active');
            this.countdownEl.style.color = '';
        }, 4000);
    }

    showVictoryModal(data) {
        document.getElementById('winner-title').innerText = `${data.winner} WINS!`;
        document.getElementById('winner-title').style.color = data.winner === 'PLAYER 1' ? '#58a6ff' : '#ff7b72';
        document.getElementById('winner-time').innerText = `WINNING TIME: ${data.time}`;
        document.getElementById('v-p1-dist').innerText = `${data.p1Dist.toLocaleString()} m`;
        document.getElementById('v-p2-dist').innerText = `${data.p2Dist.toLocaleString()} m`;
        document.getElementById('v-p1-coins').innerText = `${data.p1Coins}`;
        document.getElementById('v-p2-coins').innerText = `${data.p2Coins}`;

        this.victoryModal.classList.remove('hidden');
    }

    showMenu() {
        this.menu.classList.remove('hidden');
        this.trackHeader.style.display = 'none';
        this.p1Hud.el.style.display = 'none';
        this.p2Hud.el.style.display = 'none';
        this.controlsOverlay.style.display = 'none';
        this.celebration.classList.remove('active');
    }

    hideMenu() {
        this.menu.classList.add('hidden');
        this.trackHeader.style.display = 'flex';
        this.p1Hud.el.style.display = 'flex';
        this.p2Hud.el.style.display = 'flex';
        this.controlsOverlay.style.display = 'block';
    }

    updateRaceHUD(scores, boosts, raceData) {
        // Update Timer
        const ms = raceData.timer || 0;
        const totalSec = ms / 1000;
        const mins = Math.floor(totalSec / 60);
        const secs = (totalSec % 60).toFixed(2);
        const formattedSecs = secs < 10 ? '0' + secs : secs;
        document.getElementById('race-timer').innerText = `${mins < 10 ? '0' + mins : mins}:${formattedSecs}`;

        // Update Track Progress Bar Mini-Map
        const finishX = raceData.finishX || 30000;
        const p1Pct = Math.min(100, Math.max(0, (scores.p1.distance / finishX) * 100));
        const p2Pct = Math.min(100, Math.max(0, (scores.p2.distance / finishX) * 100));

        document.getElementById('p1-track-icon').style.left = `${p1Pct}%`;
        document.getElementById('p2-track-icon').style.left = `${p2Pct}%`;

        // Update Ranks (1ST / 2ND)
        const p1Ahead = scores.p1.distance >= scores.p2.distance;
        document.getElementById('p1-rank').innerText = p1Ahead ? '1ST' : '2ND';
        document.getElementById('p1-rank').style.color = p1Ahead ? '#ffd700' : '#8b949e';
        document.getElementById('p2-rank').innerText = p1Ahead ? '2ND' : '1ST';
        document.getElementById('p2-rank').style.color = p1Ahead ? '#8b949e' : '#ffd700';

        // Update P1 HUD
        document.getElementById('p1-speed').innerText = `${scores.p1.speed} MPH`;
        document.getElementById('p1-coins').innerText = `${scores.p1.coinCount}`;
        document.getElementById('p1-dist').innerText = `${scores.p1.distance.toLocaleString()} m`;
        document.getElementById('p1-boost-bar').style.width = `${Math.round(boosts.p1)}%`;

        // Update P2 HUD
        document.getElementById('p2-speed').innerText = `${scores.p2.speed} MPH`;
        document.getElementById('p2-coins').innerText = `${scores.p2.coinCount}`;
        document.getElementById('p2-dist').innerText = `${scores.p2.distance.toLocaleString()} m`;
        document.getElementById('p2-boost-bar').style.width = `${Math.round(boosts.p2)}%`;
    }

    triggerCelebration(text, value) {
        if (this.celebration.classList.contains('active')) return;
        this.celebration.innerText = `${text} (${value})`;
        this.celebration.classList.add('active');

        for (let i = 0; i < 25; i++) {
            this.createParticle();
        }

        setTimeout(() => {
            this.celebration.classList.remove('active');
        }, 1800);
    }

    createParticle() {
        const p = document.createElement('div');
        p.style.position = 'absolute';
        p.style.width = '10px';
        p.style.height = '10px';
        p.style.backgroundColor = ['#ff0000', '#00ff00', '#0000ff', '#ffeb3b'][Math.floor(Math.random() * 4)];
        p.style.left = '50%';
        p.style.top = '100px';
        p.style.pointerEvents = 'none';
        p.style.zIndex = '15';

        this.uiLayer.appendChild(p);

        const angle = Math.random() * Math.PI * 2;
        const velocity = 5 + Math.random() * 15;
        let vx = Math.cos(angle) * velocity;
        let vy = Math.sin(angle) * velocity - 10;
        let life = 1;

        const animate = () => {
            if (life <= 0) {
                p.remove();
                return;
            }
            vy += 0.5;
            if (p.style.left === '50%') p.style.left = `${window.innerWidth / 2}px`;
            p.style.left = `${parseFloat(p.style.left) + vx}px`;
            p.style.top = `${parseFloat(p.style.top) + vy}px`;
            life -= 0.02;
            p.style.opacity = life;
            requestAnimationFrame(animate);
        };

        requestAnimationFrame(animate);
    }

    buildDebugMenu() {
        this.debugMenu = document.createElement('div');
        this.debugMenu.className = 'debug-menu';
        this.debugMenu.style.position = 'absolute';
        this.debugMenu.style.top = '60px';
        this.debugMenu.style.right = '10px';
        this.debugMenu.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
        this.debugMenu.style.color = '#00ff00';
        this.debugMenu.style.padding = '15px';
        this.debugMenu.style.fontFamily = 'monospace';
        this.debugMenu.style.zIndex = '100';
        this.debugMenu.style.display = 'none';

        const title = document.createElement('h3');
        title.innerText = 'Physics Debug';
        title.style.marginTop = '0';
        this.debugMenu.appendChild(title);

        const addSlider = (label, min, max, step, initialValue, onChange) => {
            const container = document.createElement('div');
            container.style.marginBottom = '8px';
            const labelEl = document.createElement('div');
            labelEl.style.fontSize = '11px';
            labelEl.innerText = `${label}: ${initialValue}`;

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = min;
            slider.max = max;
            slider.step = step;
            slider.value = initialValue;

            slider.oninput = (e) => {
                const val = parseFloat(e.target.value);
                labelEl.innerText = `${label}: ${val}`;
                onChange(val);
            };

            container.appendChild(labelEl);
            container.appendChild(slider);
            this.debugMenu.appendChild(container);
        };

        if (this.callbacks.onDebugChange) {
            const t = DEFAULT_TUNING;
            const bind = (key) => (v) => this.callbacks.onDebugChange(key, v);

            addSlider('Gravity', 1.0, 5.0, 0.1, t.gravity, bind('gravity'));
            addSlider('Spring Rate', 0.002, 0.02, 0.0005, t.springStiffness, bind('springStiffness'));
            addSlider('Spring Progression', 0, 5, 0.1, t.springProgressive, bind('springProgressive'));
            addSlider('Bump Damping', 0.002, 0.06, 0.001, t.dampingCompression, bind('dampingCompression'));
            addSlider('Rebound Damping', 0.002, 0.08, 0.001, t.dampingRebound, bind('dampingRebound'));
            addSlider('Drive Torque', 0.2, 6.0, 0.1, t.driveTorque, bind('driveTorque'));
            addSlider('Top Speed (wheel spin)', 0.2, 1.0, 0.02, t.maxWheelSpin, bind('maxWheelSpin'));
            addSlider('Jump Velocity', 8, 34, 0.5, t.jumpVelocity, bind('jumpVelocity'));
            addSlider('Boost (g)', 0.2, 4.0, 0.1, t.boostGravities, bind('boostGravities'));
            addSlider('Boost Top Speed', 15, 50, 1, t.boostTopSpeed, bind('boostTopSpeed'));
            addSlider('Air Control', 0, 5, 0.1, t.airControlTorque, bind('airControlTorque'));
        }

        this.container.appendChild(this.debugMenu);
    }

    toggleDebugMenu() {
        this.debugMenu.style.display = this.debugMenu.style.display === 'none' ? 'block' : 'none';
    }

    toggleFullscreen() {
        const elem = document.documentElement;
        if (!document.fullscreenElement) {
            if (elem.requestFullscreen) elem.requestFullscreen();
        } else {
            if (document.exitFullscreen) document.exitFullscreen();
        }
    }
}
