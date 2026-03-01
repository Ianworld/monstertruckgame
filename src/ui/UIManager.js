import { CharacterGraphics } from '../game/CharacterGraphics.js';

export class UIManager {
    constructor(container, callbacks) {
        this.container = container;
        this.callbacks = callbacks;
        this.lastTimeHighscore = performance.now();
        this.minuteHighscore = 0;
        this.isTwoPlayer = false; // Default to 1 Player

        this.buildUI();
    }

    buildUI() {
        // UI Container
        this.uiLayer = document.createElement('div');
        this.uiLayer.className = 'ui-layer';
        this.container.appendChild(this.uiLayer);

        // HUD
        this.hud = document.createElement('div');
        this.hud.className = 'hud';
        this.uiLayer.appendChild(this.hud);

        this.p1SpeedStat = this.createStatBox('P1 Speed', '0');
        this.p1JumpStat = this.createStatBox('P1 Jump', '0');
        this.p1BoostStat = this.createStatBox('P1 Boost', '100%');
        this.p1CoinStat = this.createStatBox('P1 Coins', '0');

        this.p2SpeedStat = this.createStatBox('P2 Speed', '0');
        this.p2JumpStat = this.createStatBox('P2 Jump', '0');
        this.p2BoostStat = this.createStatBox('P2 Boost', '100%');
        this.p2CoinStat = this.createStatBox('P2 Coins', '0');

        const p1HudGroup = document.createElement('div');
        p1HudGroup.style.display = 'flex';
        p1HudGroup.style.gap = '30px';
        p1HudGroup.appendChild(this.p1SpeedStat.el);
        p1HudGroup.appendChild(this.p1JumpStat.el);
        p1HudGroup.appendChild(this.p1BoostStat.el);
        p1HudGroup.appendChild(this.p1CoinStat.el);

        const p2HudGroup = document.createElement('div');
        p2HudGroup.style.display = 'flex';
        p2HudGroup.style.gap = '30px';
        p2HudGroup.style.textAlign = 'right';
        p2HudGroup.appendChild(this.p2CoinStat.el);
        p2HudGroup.appendChild(this.p2BoostStat.el);
        p2HudGroup.appendChild(this.p2JumpStat.el);
        p2HudGroup.appendChild(this.p2SpeedStat.el);

        this.hud.style.width = '100%';
        this.hud.style.boxSizing = 'border-box';

        this.hud.appendChild(p1HudGroup);
        this.hud.appendChild(p2HudGroup);

        // Celebration Banner
        this.celebration = document.createElement('div');
        this.celebration.className = 'celebration';
        this.uiLayer.appendChild(this.celebration);

        // Controls Overlay
        this.controlsOverlay = document.createElement('div');
        this.controlsOverlay.className = 'controls-overlay';
        this.updateControlsOverlay();
        this.controlsOverlay.style.display = 'none';
        this.uiLayer.appendChild(this.controlsOverlay);

        // Main Menu
        this.buildMenu();

        // Debug Menu
        this.buildDebugMenu();
    }

    createStatBox(label, initialValue) {
        const el = document.createElement('div');
        el.className = 'stat';

        const labelEl = document.createElement('span');
        labelEl.className = 'stat-label';
        labelEl.innerText = label;

        const valueEl = document.createElement('span');
        valueEl.className = 'stat-value';
        valueEl.innerText = initialValue;

        const recordEl = document.createElement('div');
        recordEl.className = 'stat-record';
        recordEl.style.fontSize = '0.5em';
        recordEl.style.color = '#aaaaaa';
        recordEl.style.marginTop = '4px';
        recordEl.innerText = 'Record: ' + initialValue;

        el.appendChild(labelEl);
        el.appendChild(valueEl);
        el.appendChild(recordEl);

        return { el, valueEl, recordEl };
    }

    buildMenu() {
        this.menu = document.createElement('div');
        this.menu.className = 'menu';

        const title = document.createElement('h1');
        title.className = 'title';
        title.innerText = 'MONSTER RUNNER';
        this.menu.appendChild(title);

        // Player Mode Toggle
        const toggleContainer = document.createElement('div');
        toggleContainer.style.marginBottom = '30px';
        toggleContainer.style.display = 'flex';
        toggleContainer.style.gap = '20px';
        toggleContainer.style.alignItems = 'center';

        const toggleLabel = document.createElement('h3');
        toggleLabel.innerText = 'Players:';
        toggleLabel.style.color = '#fff';
        toggleLabel.style.margin = '0';

        const toggleBtn = document.createElement('button');
        toggleBtn.innerText = this.isTwoPlayer ? '2 Players' : '1 Player';
        toggleBtn.style.padding = '10px 20px';
        toggleBtn.style.fontSize = '18px';
        toggleBtn.style.fontWeight = 'bold';
        toggleBtn.style.borderRadius = '8px';
        toggleBtn.style.border = '2px solid var(--accent-color)';
        toggleBtn.style.backgroundColor = 'rgba(0,0,0,0.5)';
        toggleBtn.style.color = 'var(--text-color)';
        toggleBtn.style.cursor = 'pointer';

        toggleContainer.appendChild(toggleLabel);
        toggleContainer.appendChild(toggleBtn);
        this.menu.appendChild(toggleContainer);

        const playersContainer = document.createElement('div');
        playersContainer.style.display = 'flex';
        playersContainer.style.gap = '50px';
        playersContainer.style.marginBottom = '20px';

        // State
        this.p1Config = { truckStyle: 'monster', driverStyle: 'gabby' };
        this.p2Config = { truckStyle: 'dinosaur', driverStyle: 'barbie' };
        this.previews = {};

        const p1UI = this.createPlayerSelection('Player 1', this.p1Config, 'p1');
        const p2UI = this.createPlayerSelection('Player 2', this.p2Config, 'p2');

        playersContainer.appendChild(p1UI.container);
        playersContainer.appendChild(p2UI.container);
        this.menu.appendChild(playersContainer);

        // Handle Toggle Logic
        p2UI.container.style.display = this.isTwoPlayer ? 'flex' : 'none';
        toggleBtn.onclick = () => {
            this.isTwoPlayer = !this.isTwoPlayer;
            toggleBtn.innerText = this.isTwoPlayer ? '2 Players' : '1 Player';
            p2UI.container.style.display = this.isTwoPlayer ? 'flex' : 'none';
            this.updateControlsOverlay();
        };

        // Start Button
        const startBtn = document.createElement('button');
        startBtn.className = 'start-btn';
        startBtn.innerText = 'START ENGINES';
        startBtn.onclick = (e) => {
            e.target.blur(); // Prevent spacebar from clicking this later
            if (this.callbacks.onStart) {
                const config = { player1: this.p1Config };
                if (this.isTwoPlayer) {
                    config.player2 = this.p2Config;
                }
                this.callbacks.onStart(config);
            }
        };
        this.menu.appendChild(startBtn);

        this.container.appendChild(this.menu);

        // Initial render
        this.updatePreview('p1');
        this.updatePreview('p2');
    }

    updateControlsOverlay() {
        if (this.controlsOverlay) {
            if (this.isTwoPlayer) {
                this.controlsOverlay.innerHTML = '<span>[P1]</span> WASD & Shift &nbsp;&nbsp;|&nbsp;&nbsp; <span>[P2]</span> Arrows & Space';
            } else {
                this.controlsOverlay.innerHTML = '<span>[Right/D]</span> Accelerate &nbsp;&nbsp;|&nbsp;&nbsp; <span>[Space/Shift]</span> Boost &nbsp;&nbsp;|&nbsp;&nbsp; <span>[Up/W]</span> Jump';
            }
        }
    }

    createPlayerSelection(titleText, config, playerId) {
        const container = document.createElement('div');
        container.className = 'player-config';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.alignItems = 'center';

        const title = document.createElement('h2');
        title.innerText = titleText;
        title.style.marginBottom = '15px';
        title.style.color = 'white';
        container.appendChild(title);

        const previewContainer = document.createElement('div');
        previewContainer.className = 'preview-box';
        // Make it slightly smaller so both fit on screen nicely
        previewContainer.style.width = '400px';
        previewContainer.style.height = '240px';

        const truckPreview = document.createElement('div');
        truckPreview.style.position = 'absolute';
        truckPreview.style.bottom = '0';
        truckPreview.style.left = '0';
        truckPreview.style.width = '100%';
        truckPreview.style.height = '100%';

        const driverPreview = document.createElement('div');
        driverPreview.style.position = 'absolute';
        driverPreview.style.bottom = '60px'; // Adjusted for smaller box
        driverPreview.style.left = '130px';  // Adjusted for smaller box
        driverPreview.style.width = '100px';
        driverPreview.style.height = '100px';
        driverPreview.style.zIndex = '2';

        previewContainer.appendChild(truckPreview);
        previewContainer.appendChild(driverPreview);
        container.appendChild(previewContainer);

        // Save preview references
        this.previews[playerId] = { truckPreview, driverPreview, config };

        const options = document.createElement('div');
        options.className = 'menu-options';
        // Reduce gap to fit screen
        options.style.gap = '20px';

        // Truck Style Selector
        const truckGroup = this.createSelectorGroup('Truck', [
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

        // Driver Style Selector
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
        // Ensure the preview truck is not skewed in ratio
        truckPreview.querySelector('svg').style.transform = 'scale(1.0) translateY(10px)';
        truckPreview.querySelector('svg').style.transformOrigin = 'bottom center';

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

        items.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'card';
            // Also scale down cards slightly to ensure they fit side-by-side
            card.style.width = '80px';
            card.style.height = '80px';
            if (item.id === initialSelected) card.classList.add('selected');

            // Render SVG preview
            const visual = document.createElement('div');
            visual.style.width = '80px';
            visual.style.height = '60px';
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

    showMenu() {
        this.menu.classList.remove('hidden');
        this.hud.style.display = 'none';
        this.controlsOverlay.style.display = 'none';
        this.celebration.classList.remove('active');
    }

    hideMenu() {
        this.menu.classList.add('hidden');
        this.hud.style.display = 'flex';
        this.controlsOverlay.style.display = 'block';

        const resetStat = (stat, label) => {
            stat.valueEl.innerText = label.includes('Boost') ? '100%' : (label.includes('Speed') ? '0 MPH' : (label.includes('Coin') ? '0' : '0 M'));
            stat.recordEl.innerText = label.includes('Coin') ? 'Rounds Won: 0' : `Record: ${stat.valueEl.innerText}`;
        };

        resetStat(this.p1SpeedStat, 'P1 Speed');
        resetStat(this.p1JumpStat, 'P1 Jump');
        resetStat(this.p1BoostStat, 'P1 Boost');
        resetStat(this.p1CoinStat, 'P1 Coins');

        if (this.isTwoPlayer) {
            this.p2SpeedStat.el.style.display = 'flex';
            this.p2JumpStat.el.style.display = 'flex';
            this.p2BoostStat.el.style.display = 'flex';
            this.p2CoinStat.el.style.display = 'flex';
            resetStat(this.p2SpeedStat, 'P2 Speed');
            resetStat(this.p2JumpStat, 'P2 Jump');
            resetStat(this.p2BoostStat, 'P2 Boost');
            resetStat(this.p2CoinStat, 'P2 Coins');
        } else {
            this.p2SpeedStat.el.style.display = 'none';
            this.p2JumpStat.el.style.display = 'none';
            this.p2BoostStat.el.style.display = 'none';
            this.p2CoinStat.el.style.display = 'none';
        }
    }

    updateHUD(scores, boosts) {
        const now = performance.now();

        const updatePlayerHUD = (prefix, statScores, boostPercent) => {
            const speedStat = this[`${prefix}SpeedStat`];
            const jumpStat = this[`${prefix}JumpStat`];
            const boostStat = this[`${prefix}BoostStat`];
            const coinStat = this[`${prefix}CoinStat`];

            if (statScores) {
                speedStat.valueEl.innerText = `${statScores.speed} MPH`;
                jumpStat.valueEl.innerText = `${statScores.jumpDistance} M`;
                coinStat.valueEl.innerText = `${statScores.coinCount || 0}`;
                speedStat.recordEl.innerText = `Record: ${statScores.maxSpeed} MPH`;
                jumpStat.recordEl.innerText = `Record: ${statScores.maxJump} M`;
                coinStat.recordEl.innerText = `Rounds Won: ${statScores.roundsWon || 0}`;
            }

            if (boostPercent !== undefined) {
                boostStat.valueEl.innerText = `${Math.round(boostPercent)}%`;
                if (boostPercent < 20) {
                    boostStat.valueEl.style.color = '#ff4444';
                } else {
                    boostStat.valueEl.style.color = '#ffffff';
                }
            }
        };

        if (scores.p1) updatePlayerHUD('p1', scores.p1, boosts?.p1);
        if (scores.p2) updatePlayerHUD('p2', scores.p2, boosts?.p2);

        // Minute Highscore Tracking
        if (now - this.lastTimeHighscore > 60000) {
            this.minuteHighscore = 0;
            this.lastTimeHighscore = now;
        }

        const maxJump = Math.max(scores.p1?.jumpDistance || 0, scores.p2?.jumpDistance || 0);
        if (maxJump > this.minuteHighscore && maxJump > 50) {
            this.minuteHighscore = maxJump;
            this.triggerCelebration('MINUTE HIGH SCORE!', maxJump);
        }
    }

    triggerCelebration(text, value) {
        // Prevent spamming
        if (this.celebration.classList.contains('active')) return;

        this.celebration.innerText = `${text} (${value})`;
        this.celebration.classList.add('active');

        // Create simple confetti elements
        for (let i = 0; i < 30; i++) {
            this.createParticle();
        }

        setTimeout(() => {
            this.celebration.classList.remove('active');
        }, 2000);
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
        let vy = Math.sin(angle) * velocity - 10; // Upward bias

        let life = 1;

        const animate = () => {
            if (life <= 0) {
                p.remove();
                return;
            }

            vy += 0.5; // Gravity
            const currentLeft = parseFloat(p.style.left) || window.innerWidth / 2;
            const currentTop = parseFloat(p.style.top) || 100;

            // Need to handle initial % based left vs px based for simplified particle sim
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
        this.debugMenu.style.top = '60px'; // Moved down to avoid overlapping the boost gauge
        this.debugMenu.style.right = '10px';
        this.debugMenu.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        this.debugMenu.style.color = '#00ff00';
        this.debugMenu.style.padding = '15px';
        this.debugMenu.style.fontFamily = 'monospace';
        this.debugMenu.style.zIndex = '100';
        this.debugMenu.style.display = 'none';

        const title = document.createElement('h3');
        title.innerText = 'Physics Debug';
        title.style.marginTop = '0';
        this.debugMenu.appendChild(title);

        this.debugSliders = {};

        const addSlider = (label, min, max, step, initialValue, onChange) => {
            const container = document.createElement('div');
            container.style.marginBottom = '10px';

            const labelEl = document.createElement('div');
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

            this.debugSliders[label] = { labelEl, slider };
        };

        if (this.callbacks.onDebugChange) {
            addSlider('Gravity', 0.5, 5.0, 0.1, 0.6, (v) => this.callbacks.onDebugChange('gravity', v));
            addSlider('Wheel Friction', 0.1, 10.0, 0.1, 8.3, (v) => this.callbacks.onDebugChange('friction', v));
            addSlider('Wheel Density', 0.001, 0.2, 0.001, 0.05, (v) => this.callbacks.onDebugChange('density', v));
            addSlider('Accel Force', 0.5, 10.0, 0.5, 9.5, (v) => this.callbacks.onDebugChange('accelForce', v));
            addSlider('Velocity Max', 2.0, 30.0, 1.0, 23.0, (v) => this.callbacks.onDebugChange('maxAngularVel', v));
            addSlider('Jump Force', 10.0, 60.0, 1.0, 25.0, (v) => this.callbacks.onDebugChange('jumpForce', v));
            addSlider('Susp Stiffness', 0.01, 0.5, 0.01, 0.03, (v) => this.callbacks.onDebugChange('suspensionStiffness', v));
            addSlider('Susp Damping', 0.01, 0.5, 0.01, 0.05, (v) => this.callbacks.onDebugChange('suspensionDamping', v));
            addSlider('Boost Force', 0.01, 1, 0.01, 0.4, (v) => this.callbacks.onDebugChange('boostForce', v));
        }

        this.container.appendChild(this.debugMenu);
    }

    toggleDebugMenu() {
        if (this.debugMenu.style.display === 'none') {
            this.debugMenu.style.display = 'block';
        } else {
            this.debugMenu.style.display = 'none';
        }
    }
}
