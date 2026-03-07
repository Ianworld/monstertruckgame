import Matter from 'matter-js';
import { PhysicsEngine } from './PhysicsEngine.js';
import { Truck } from './Truck.js';
import { LevelGenerator } from './LevelGenerator.js';
import { UIManager } from '../ui/UIManager.js';
import { AudioManager } from './AudioManager.js';

export class GameManager {
    constructor(container) {
        this.container = container;
        this.isRunning = false;

        // Setup UI
        this.ui = new UIManager(this.container, {
            onStart: (config) => this.startGame(config),
            onDebugChange: (key, value) => this.handleDebugChange(key, value)
        });

        this.physicsConfig = {
            gravity: 0.8,
            friction: 8.3,
            density: 0.05,
            accelForce: 9.5,
            maxAngularVel: 23.0,
            jumpForce: 25.0,
            suspensionStiffness: 0.15,
            suspensionDamping: 0.05,
            boostForce: 0.2
        };

        // Setup Audio
        this.audioManager = new AudioManager();

        // Physics Engine
        this.physics = new PhysicsEngine();

        // Game State
        // Game State
        this.score = {
            p1: { speed: 0, maxSpeed: 0, jumpDistance: 0, maxJump: 0, coinCount: 0, roundsWon: 0 },
            p2: { speed: 0, maxSpeed: 0, jumpDistance: 0, maxJump: 0, coinCount: 0, roundsWon: 0 }
        };

        this.minuteScore = {
            maxSpeed: 0,
            maxJump: 0
        };
        this.minuteTimer = 0;

        this.lastTime = performance.now();
        this.animationFrameId = null;

        // Listen to resize
        window.addEventListener('resize', () => this.handleResize());
    }

    start() {
        this.ui.showMenu();
        // Start rendering loop specifically for menu background if desired
    }

    startGame(config) {
        this.isRunning = true;
        this.ui.hideMenu();

        // Start Audio Context on user interaction
        this.audioManager.start();

        if (!this.physicsInitialized) {
            // Initialize game world
            this.physics.init(this.container);
            this.physicsInitialized = true;
            this.setupControls();

            // Setup Collision Handler for Boost Pads
            Matter.Events.on(this.physics.engine, 'collisionStart', this.handleCollisions.bind(this));
        } else {
            // Clear existing world
            Matter.World.clear(this.physics.world);
            Matter.Engine.clear(this.physics.engine);
        }

        this.levelGenerator = new LevelGenerator(this.physics.world);
        this.levelGenerator.generateInitial();

        this.truck1 = new Truck(this.physics.world, config.player1, { x: 400, y: -200 }, this.physicsConfig);
        if (config.player2) {
            this.truck2 = new Truck(this.physics.world, config.player2, { x: 200, y: -200 }, this.physicsConfig);
        } else {
            this.truck2 = null;
        }

        // Update physics with initial config
        this.physics.world.gravity.y = this.physicsConfig.gravity;

        // Reset camera
        this.physics.camera = { x: 0, y: 0, zoom: 1 };

        // Reset scores
        this.score = {
            p1: { speed: 0, maxSpeed: 0, jumpDistance: 0, maxJump: 0, coinCount: 0, roundsWon: 0 },
            p2: { speed: 0, maxSpeed: 0, jumpDistance: 0, maxJump: 0, coinCount: 0, roundsWon: 0 }
        };

        this.minuteScore = {
            maxSpeed: 0,
            maxJump: 0
        };
        this.minuteTimer = 0;

        // Reset audio manager speed
        if (this.audioManager) {
            this.audioManager.updateSpeed(0);
        }

        // Start loop
        this.lastTime = performance.now();
        if (!this.animationFrameId) {
            this.loop(this.lastTime);
        }
    }

    setupControls() {
        this.keys = {};
        window.addEventListener('keydown', (e) => this.keys[e.code] = true);
        window.addEventListener('keyup', (e) => this.keys[e.code] = false);

        // Touch Control State
        this.autoDrive = false;
        this.touchBoost = false;

        // Bind Touch Events
        if (this.ui.touchDriveBtn) {
            this.ui.touchDriveBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                this.autoDrive = !this.autoDrive;
                if (this.autoDrive) {
                    this.ui.touchDriveBtn.classList.add('active-toggle');
                } else {
                    this.ui.touchDriveBtn.classList.remove('active-toggle');
                }
            });
        }

        if (this.ui.touchJumpBtn) {
            this.ui.touchJumpBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                if (this.truck1) this.truck1.jump();
            });
        }

        if (this.ui.touchBoostBtn) {
            const startBoost = (e) => { e.preventDefault(); this.touchBoost = true; };
            const stopBoost = (e) => { e.preventDefault(); this.touchBoost = false; };

            this.ui.touchBoostBtn.addEventListener('touchstart', startBoost);
            this.ui.touchBoostBtn.addEventListener('touchend', stopBoost);
            this.ui.touchBoostBtn.addEventListener('touchcancel', stopBoost);
        }
    }

    handleCollisions(event) {
        if (!this.isRunning) return;

        const pairs = event.pairs;

        for (let i = 0; i < pairs.length; i++) {
            const bodyA = pairs[i].bodyA;
            const bodyB = pairs[i].bodyB;

            const checkBoostHit = (truck) => {
                if (!truck) return false;
                const hitBoost = (bodyA.label === 'boost_pad' && (bodyB === truck.chassis || bodyB === truck.wheelA || bodyB === truck.wheelB)) ||
                    (bodyB.label === 'boost_pad' && (bodyA === truck.chassis || bodyA === truck.wheelA || bodyA === truck.wheelB));
                return hitBoost;
            };

            const checkCoinHit = (truck) => {
                if (!truck) return null;
                if (bodyA.label === 'coin' && (bodyB === truck.chassis || bodyB === truck.wheelA || bodyB === truck.wheelB)) return bodyA;
                if (bodyB.label === 'coin' && (bodyA === truck.chassis || bodyA === truck.wheelA || bodyA === truck.wheelB)) return bodyB;
                return null;
            };

            if (checkBoostHit(this.truck1)) {
                this.triggerBoostJump(this.truck1, 'P1');
            }
            if (this.truck2 && checkBoostHit(this.truck2)) {
                this.triggerBoostJump(this.truck2, 'P2');
            }

            const coinHitP1 = checkCoinHit(this.truck1);
            if (coinHitP1) {
                this.score.p1.coinCount++;
                this.audioManager.playCoinSound();
                Matter.World.remove(this.physics.world, coinHitP1);
            }

            const coinHitP2 = checkCoinHit(this.truck2);
            if (coinHitP2) {
                this.score.p2.coinCount++;
                this.audioManager.playCoinSound();
                Matter.World.remove(this.physics.world, coinHitP2);
            }
        }
    }

    triggerBoostJump(truck, playerLabel) {
        const now = performance.now();
        // 1 second cooldown to prevent multi-triggering from multiple wheels
        if (truck.lastBoostPadHit && (now - truck.lastBoostPadHit < 1000)) return;
        truck.lastBoostPadHit = now;

        // Apply massive upward jump 
        Matter.Body.setVelocity(truck.chassis, {
            x: truck.chassis.velocity.x + 10,
            y: -50 // Big jump
        });

        // Add extreme backward rotation
        Matter.Body.setAngularVelocity(truck.chassis, -0.2);

        this.ui.triggerCelebration(`${playerLabel} BOOST PAD LAUNCH!`, '');
        this.audioManager.triggerCelebration();
    }

    update(dt) {
        if (!this.isRunning) return;

        // Process input
        // Process input P1 (WASD + Shift)
        if (this.keys['KeyD'] || this.autoDrive) {
            this.truck1.accelerate(1);
        } else if (this.keys['KeyA']) {
            this.truck1.accelerate(-1);
        }

        if (this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this.touchBoost) {
            this.truck1.boost();
        }

        if (this.keys['KeyW']) {
            this.truck1.jump();
            this.keys['KeyW'] = false;
        }

        // Process input P2 (Arrows + Space)
        if (this.truck2) {
            if (this.keys['ArrowRight']) {
                this.truck2.accelerate(1);
            } else if (this.keys['ArrowLeft']) {
                this.truck2.accelerate(-1);
            }

            if (this.keys['Space']) {
                this.truck2.boost();
            }

            if (this.keys['ArrowUp']) {
                this.truck2.jump();
                this.keys['ArrowUp'] = false;
            }
        }

        if (this.keys['KeyP']) {
            // Show menu to select new truck and driver
            this.isRunning = false;
            this.ui.showMenu();
            this.keys['KeyP'] = false;
        }

        if (this.keys['KeyI']) {
            this.ui.toggleDebugMenu();
            this.keys['KeyI'] = false;
        }

        // Update physics
        this.physics.update(dt);
        this.truck1.update(dt);
        if (this.truck2) this.truck2.update(dt);

        // Update level chunk generation based on leading truck position
        let maxTruckX = this.truck1.getPosition().x;
        if (this.truck2) {
            maxTruckX = Math.max(maxTruckX, this.truck2.getPosition().x);
        }
        this.levelGenerator.update(maxTruckX);

        // Camera follow both trucks
        const targetPositions = [this.truck1.getPosition()];
        const speeds = [this.truck1.getSpeed()];
        if (this.truck2) {
            targetPositions.push(this.truck2.getPosition());
            speeds.push(this.truck2.getSpeed());
        }
        const maxSpeedLocal = Math.max(...speeds);
        this.physics.updateCamera(targetPositions, maxSpeedLocal);

        // Minute Timer
        this.minuteTimer += dt;
        if (this.minuteTimer >= 60000) {
            let coinsMsg = `P1 Collected: ${this.score.p1.coinCount}`;
            if (this.truck2) {
                if (this.score.p1.coinCount > this.score.p2.coinCount) {
                    this.score.p1.roundsWon++;
                    coinsMsg = `P1 WINS COINS: ${this.score.p1.coinCount} TO ${this.score.p2.coinCount}`;
                } else if (this.score.p2.coinCount > this.score.p1.coinCount) {
                    this.score.p2.roundsWon++;
                    coinsMsg = `P2 WINS COINS: ${this.score.p2.coinCount} TO ${this.score.p1.coinCount}`;
                } else {
                    coinsMsg = `COIN TIE: ${this.score.p1.coinCount}`;
                }
            } else {
                this.score.p1.roundsWon++;
            }

            this.ui.triggerCelebration('MINUTE RECAP!', `${coinsMsg} | Max Speed: ${Math.floor(this.minuteScore.maxSpeed)}`);
            this.audioManager.triggerCelebration();

            this.minuteScore.maxSpeed = 0;
            this.minuteScore.maxJump = 0;
            this.score.p1.coinCount = 0;
            if (this.truck2) this.score.p2.coinCount = 0;
            this.minuteTimer = 0;
        }

        // Score tracking
        this.updateScores();
    }

    handleDebugChange(key, value) {
        this.physicsConfig[key] = value;
        if (key === 'gravity') {
            this.physics.world.gravity.y = value;
        } else {
            if (this.truck1) this.truck1.updatePhysicsConfig(this.physicsConfig);
            if (this.truck2) this.truck2.updatePhysicsConfig(this.physicsConfig);
        }
    }

    updateScores() {
        const speed1 = this.truck1.getSpeed();
        this.score.p1.speed = speed1;
        let maxSpeed = speed1;

        if (this.truck2) {
            const speed2 = this.truck2.getSpeed();
            this.score.p2.speed = speed2;
            maxSpeed = Math.max(speed1, speed2);
        }

        this.audioManager.updateSpeed(maxSpeed);

        const checkSpeedRecord = (speed, pKey, label) => {
            if (speed > this.score[pKey].maxSpeed) {
                this.score[pKey].maxSpeed = speed;
                this.ui.triggerCelebration(`${label} ALL-TIME SPEED RECORD!`, speed);
                this.audioManager.triggerCelebration();
            }
            if (speed > this.minuteScore.maxSpeed) {
                this.minuteScore.maxSpeed = speed;
            }
        };

        checkSpeedRecord(speed1, 'p1', 'P1');
        if (this.truck2) checkSpeedRecord(this.score.p2.speed, 'p2', 'P2');

        const jump1 = this.truck1.getJumpMetrics();
        this.score.p1.jumpDistance = jump1.current;

        if (this.truck2) {
            const jump2 = this.truck2.getJumpMetrics();
            this.score.p2.jumpDistance = jump2.current;
        }

        const checkJumpRecord = (jumpDist, pKey, label) => {
            if (jumpDist > this.score[pKey].maxJump) {
                this.score[pKey].maxJump = jumpDist;
                this.ui.triggerCelebration(`${label} MASSIVE JUMP!`, jumpDist);
                this.audioManager.triggerCelebration();
            }
            if (jumpDist > this.minuteScore.maxJump) {
                this.minuteScore.maxJump = jumpDist;
            }
        };

        checkJumpRecord(jump1.current, 'p1', 'P1');
        if (this.truck2) checkJumpRecord(this.score.p2.jumpDistance, 'p2', 'P2');

        const boosts = { p1: this.truck1.getBoostPercent() };
        if (this.truck2) boosts.p2 = this.truck2.getBoostPercent();

        this.ui.updateHUD(this.score, boosts);
    }

    loop(time) {
        const dt = time - this.lastTime;
        this.lastTime = time;

        // Cap dt to prevent huge jumps on tab switch
        const safeDt = Math.min(dt, 50);

        this.update(safeDt);

        const pulse = this.audioManager ? this.audioManager.getPulse() : 0;
        this.physics.render(pulse);

        this.animationFrameId = requestAnimationFrame((t) => this.loop(t));
    }

    handleResize() {
        if (this.isRunning && this.physics) {
            this.physics.resize();
        }
    }
}
