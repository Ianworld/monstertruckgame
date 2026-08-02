import Matter from 'matter-js';
import { PhysicsEngine } from './PhysicsEngine.js';
import { Truck } from './Truck.js';
import { LevelGenerator } from './LevelGenerator.js';
import { UIManager } from '../ui/UIManager.js';
import { AudioManager } from './AudioManager.js';
import { createTuning, LIVE_TUNING_KEYS } from './TruckTuning.js';
import { CourseHazards } from './CourseHazards.js';
import { getCourse } from './Courses.js';

export class GameManager {
    constructor(container) {
        this.container = container;
        this.isRunning = false;
        this.raceState = 'MENU'; // 'MENU' | 'COUNTDOWN' | 'RACING' | 'FINISHED'
        this.finishX = 30000;

        // Grid slots. The trucks no longer collide with each other (one shared
        // world, two viewports - letting them shove each other made the race a
        // coin flip), so they only need enough space to be told apart.
        this.startPositions = { p1: { x: 400, y: 250 }, p2: { x: 120, y: 250 } };

        // Setup UI
        this.ui = new UIManager(this.container, {
            onStart: (config) => this.startGame(config),
            onRestart: () => this.restartGame(),
            onDebugChange: (key, value) => this.handleDebugChange(key, value)
        });

        // One shared tuning table. Trucks and suspension units hold a reference to
        // it, so live debug tweaks (I key) take effect on the next step.
        this.tuning = createTuning();

        // Setup Audio & Physics
        this.audioManager = new AudioManager();
        this.physics = new PhysicsEngine();

        // Game Scores & Race State
        this.resetRaceState();

        this.lastTime = performance.now();
        this.animationFrameId = null;

        window.addEventListener('resize', () => this.handleResize());
    }

    resetRaceState() {
        this.raceTimer = 0;
        this.countdownTimer = 3500; // 3.5s countdown (3... 2... 1... GO!)
        this.winner = null;
        this.p1FinishTime = null;
        this.p2FinishTime = null;

        this.score = {
            p1: { speed: 0, maxSpeed: 0, jumpDistance: 0, maxJump: 0, coinCount: 0, roundsWon: 0, distance: 0 },
            p2: { speed: 0, maxSpeed: 0, jumpDistance: 0, maxJump: 0, coinCount: 0, roundsWon: 0, distance: 0 }
        };

        this.toggles = {
            forwardP1: false, backwardP1: false,
            forwardP2: false, backwardP2: false
        };
    }

    start() {
        this.ui.showMenu();
    }

    startGame(config) {
        this.currentConfig = config;
        this.isRunning = true;
        this.ui.hideMenu();
        this.resetRaceState();

        this.audioManager.start();

        if (!this.physicsInitialized) {
            this.physics.init(this.container);
            this.physicsInitialized = true;
            this.setupControls();

            this.hazards = new CourseHazards(this.physics, {
                onCoin: (truck, id) => {
                    this.score[id].coinCount++;
                    this.audioManager.playCoinSound();
                },
                onBoost: (truck, id) => {
                    this.ui.triggerCelebration(`${id.toUpperCase()} SPEED BOOST!`, 'BOOST');
                    this.audioManager.triggerCelebration();
                },
                onSpring: () => this.audioManager.playSpringSound(),
                onSmash: () => this.audioManager.playSmashSound()
            });
        } else {
            this.physics.clearTrucks();
            Matter.World.clear(this.physics.world);
            Matter.Engine.clear(this.physics.engine);
        }

        this.physics.world.gravity.y = this.tuning.gravity;

        this.course = getCourse(config.courseId);
        this.levelGenerator = new LevelGenerator(this.physics.world).build(this.course);
        this.finishX = this.levelGenerator.finishX;

        // Spawn P1 and P2 Monster Trucks at the Start Line
        const p2Config = config.player2 || { truckStyle: 'dinosaur', driverStyle: 'barbie' };
        this.truck1 = new Truck(this.physics, config.player1, this.startPositions.p1, this.tuning);
        this.truck2 = new Truck(this.physics, p2Config, this.startPositions.p2, this.tuning);

        this.physics.addTruck(this.truck1);
        this.physics.addTruck(this.truck2);

        this.hazards.reset();
        this.hazards.addTruck(this.truck1, 'p1');
        this.hazards.addTruck(this.truck2, 'p2');

        // Each truck races the same DISTANCE from its own grid slot, so the
        // stagger on the start line costs nobody anything.
        this.raceDistance = this.finishX - this.startPositions.p1.x;

        // Gantries are drawn at the real ground height, not a guessed one.
        this.trackMarks = {
            startX: 0,
            startY: this.levelGenerator.groundYAt(0),
            finishX: this.finishX,
            finishY: this.levelGenerator.groundYAt(this.finishX)
        };

        // Enter COUNTDOWN State
        this.raceState = 'COUNTDOWN';
        this.ui.startCountdown();

        if (this.audioManager) {
            this.audioManager.updateSpeed(0);
        }

        this.lastTime = performance.now();
        if (!this.animationFrameId) {
            this.loop(this.lastTime);
        }
    }

    restartGame() {
        if (this.currentConfig) {
            this.startGame(this.currentConfig);
        }
    }

    setupControls() {
        this.keys = {};

        window.addEventListener('keydown', (e) => {
            if (!this.keys[e.code]) {
                // P1 Drive Controls (WASD)
                if (e.code === 'KeyD') {
                    this.toggles.forwardP1 = !this.toggles.forwardP1;
                    if (this.toggles.forwardP1) this.toggles.backwardP1 = false;
                }
                if (e.code === 'KeyA') {
                    this.toggles.backwardP1 = !this.toggles.backwardP1;
                    if (this.toggles.backwardP1) this.toggles.forwardP1 = false;
                }

                // P2 Drive Controls (Arrows)
                if (e.code === 'ArrowRight') {
                    this.toggles.forwardP2 = !this.toggles.forwardP2;
                    if (this.toggles.forwardP2) this.toggles.backwardP2 = false;
                }
                if (e.code === 'ArrowLeft') {
                    this.toggles.backwardP2 = !this.toggles.backwardP2;
                    if (this.toggles.backwardP2) this.toggles.forwardP2 = false;
                }
            }
            this.keys[e.code] = true;
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });
    }

    /** Distance covered from this truck's own grid slot. */
    trackProgress(truck) {
        return truck.getPosition().x - truck.spawnChassisPosition.x;
    }

    update(dt) {
        if (!this.isRunning) return;

        // Manage COUNTDOWN state
        if (this.raceState === 'COUNTDOWN') {
            this.countdownTimer -= dt;

            // Let the trucks drop onto their springs and settle, but no creeping
            // forward off the line.
            this.truck1.hold();
            if (this.truck2) this.truck2.hold();

            if (this.countdownTimer <= 0) {
                this.raceState = 'RACING';
                this.raceTimer = 0;
            }
        } else if (this.raceState === 'RACING') {
            this.raceTimer += dt;
        }

        // Process P1 Inputs (WASD + ShiftLeft)
        if (this.raceState === 'RACING') {
            if (this.toggles.forwardP1) {
                this.truck1.accelerate(1);
            } else if (this.toggles.backwardP1) {
                this.truck1.accelerate(-1);
            }

            if (this.keys['ShiftLeft']) {
                this.truck1.boost();
            }

            // Not consumed on the first frame: held, W hops off the ground and
            // spins the truck while it is airborne. The jump cooldown in Truck is
            // what stops the hopping from turning into flying.
            if (this.keys['KeyW']) {
                this.truck1.jump();
            }

            // Process P2 Inputs (Arrows + ShiftRight)
            if (this.truck2) {
                if (this.toggles.forwardP2) {
                    this.truck2.accelerate(1);
                } else if (this.toggles.backwardP2) {
                    this.truck2.accelerate(-1);
                }

                if (this.keys['ShiftRight']) {
                    this.truck2.boost();
                }

                if (this.keys['ArrowUp']) {
                    this.truck2.jump();
                }
            }
        }

        // Key shortcuts
        if (this.keys['KeyP']) {
            this.isRunning = false;
            this.raceState = 'MENU';
            this.ui.showMenu();
            this.keys['KeyP'] = false;
        }

        if (this.keys['KeyI']) {
            this.ui.toggleDebugMenu();
            this.keys['KeyI'] = false;
        }

        // Update physics
        this.physics.update(dt);
        this.hazards.update(dt);
        this.truck1.update(dt);
        if (this.truck2) this.truck2.update(dt);

        // Update Cameras for P1 and P2 viewports
        const pos1 = this.truck1.getPosition();
        const pos2 = this.truck2 ? this.truck2.getPosition() : pos1;
        const speed1 = this.truck1.getSpeed();
        const speed2 = this.truck2 ? this.truck2.getSpeed() : speed1;

        this.physics.updateCameras(pos1, speed1, pos2, speed2);

        // Track distances and check Finish Line crossing
        const progress1 = this.trackProgress(this.truck1);
        const progress2 = this.truck2 ? this.trackProgress(this.truck2) : progress1;
        this.score.p1.distance = Math.max(0, Math.floor(progress1));
        this.score.p2.distance = Math.max(0, Math.floor(progress2));

        if (this.raceState === 'RACING') {
            const p1Crossed = progress1 >= this.raceDistance;
            const p2Crossed = progress2 >= this.raceDistance;

            if (p1Crossed || p2Crossed) {
                this.raceState = 'FINISHED';

                if (p1Crossed && p2Crossed) {
                    this.winner = progress1 > progress2 ? 'PLAYER 1' : 'PLAYER 2';
                } else if (p1Crossed) {
                    this.winner = 'PLAYER 1';
                } else {
                    this.winner = 'PLAYER 2';
                }

                const formatTime = (ms) => {
                    const totalSec = ms / 1000;
                    const mins = Math.floor(totalSec / 60);
                    const secs = (totalSec % 60).toFixed(2);
                    return `${mins > 0 ? mins + 'm ' : ''}${secs}s`;
                };

                const winningTimeStr = formatTime(this.raceTimer);
                this.audioManager.triggerCelebration();

                this.ui.showVictoryModal({
                    winner: this.winner,
                    time: winningTimeStr,
                    p1Dist: Math.floor(progress1),
                    p2Dist: Math.floor(progress2),
                    p1Coins: this.score.p1.coinCount,
                    p2Coins: this.score.p2.coinCount
                });
            }
        }

        this.updateScores();
    }

    handleDebugChange(key, value) {
        if (!LIVE_TUNING_KEYS.includes(key)) return;

        // Trucks share this object by reference, so assigning is enough.
        this.tuning[key] = value;
        if (key === 'gravity') this.physics.world.gravity.y = value;
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

        const jump1 = this.truck1.getJumpMetrics();
        this.score.p1.jumpDistance = jump1.current;

        if (this.truck2) {
            const jump2 = this.truck2.getJumpMetrics();
            this.score.p2.jumpDistance = jump2.current;
        }

        const boosts = {
            p1: this.truck1.getBoostPercent(),
            p2: this.truck2 ? this.truck2.getBoostPercent() : 100
        };

        const raceData = {
            state: this.raceState,
            timer: this.raceTimer,
            countdown: this.countdownTimer,
            finishX: this.finishX
        };

        this.ui.updateRaceHUD(this.score, boosts, raceData);
    }

    loop(time) {
        const dt = time - this.lastTime;
        this.lastTime = time;

        const safeDt = Math.min(dt, 50);
        this.update(safeDt);

        const pulse = this.audioManager ? this.audioManager.getPulse() : 0;
        this.physics.renderSplitScreen(pulse, this.trackMarks);

        this.animationFrameId = requestAnimationFrame((t) => this.loop(t));
    }

    handleResize() {
        if (this.isRunning && this.physics) {
            this.physics.resize();
        }
    }
}
