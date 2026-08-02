import Matter from 'matter-js';
import { CharacterGraphics } from './CharacterGraphics.js';
import { SuspensionUnit } from './Suspension.js';
import {
    DEFAULT_TUNING,
    PX_PER_STEP_TO_MPH,
    STEP_SQ,
    clamp,
    forceForGravities
} from './TruckTuning.js';
import { enforceTruckSafety, SAFETY_LIMITS } from './PhysicsSafety.js';

const { Bodies, Body, Composite, Constraint, Vector, World } = Matter;

// Trucks collide with the world but never with each other: in split screen the
// two trucks share one world, and letting them shove each other around turns the
// race into a coin flip.
export const TERRAIN_CATEGORY = 0x0001;
export const TRUCK_CATEGORY = 0x0002;

/**
 * A monster truck: rigid chassis, two heavy wheels on hand-rolled spring/damper
 * suspension (see Suspension.js), and a driver bobbing on top.
 *
 * Input is intent, not action. accelerate()/jump()/boost() only set flags; the
 * forces land in preStep(), which the physics engine calls once per FIXED step.
 * That keeps the feel identical whether the browser is running at 30, 60 or
 * 144fps, and makes the whole thing reproducible in tests.
 */
export class Truck {
    /**
     * @param {object} physics PhysicsEngine (or a bare Matter engine, for tests)
     * @param {object} config { truckStyle, driverStyle }
     * @param {{x: number, y: number}} groundPoint where the tyres should touch down
     * @param {object} tuning shared tuning table; mutate in place to retune live
     */
    constructor(physics, config = {}, groundPoint = { x: 0, y: 250 }, tuning = null) {
        this.physics = physics && physics.engine ? physics : null;
        this.engine = this.physics ? this.physics.engine : physics;
        this.world = this.engine.world;
        this.tuning = tuning || { ...DEFAULT_TUNING };
        this.config = config;

        const t = this.tuning;
        const group = Body.nextGroup(true);
        const collisionFilter = {
            group,
            category: TRUCK_CATEGORY,
            mask: TERRAIN_CATEGORY
        };

        // --- SPAWN LAYOUT --------------------------------------------------
        // groundPoint is the contact patch, so work upwards: hub sits a radius
        // above it, chassis sits a sagged spring above the hub.
        const restSpring = t.restLength - t.staticSag;
        const hubY = groundPoint.y - t.wheelRadius - t.spawnDrop;
        const chassisY = hubY - restSpring - t.anchorY;

        this.spawnChassisPosition = { x: groundPoint.x, y: chassisY };
        this.lastSafePosition = { ...this.spawnChassisPosition };

        // --- CHASSIS -------------------------------------------------------
        this.chassis = Bodies.rectangle(groundPoint.x, chassisY, t.chassisWidth, t.chassisHeight, {
            collisionFilter,
            friction: 0.4,
            frictionAir: t.chassisAirFriction,
            restitution: 0.05,
            label: 'chassis',
            render: { visible: false }
        });
        Body.setMass(this.chassis, t.chassisMass);

        // --- WHEELS --------------------------------------------------------
        const makeWheel = (side) => {
            const wheel = Bodies.circle(
                groundPoint.x + side * t.wheelBase,
                hubY,
                t.wheelRadius,
                {
                    collisionFilter,
                    friction: t.wheelFriction,
                    frictionStatic: 4,
                    frictionAir: t.wheelAirFriction,
                    restitution: t.wheelRestitution,
                    slop: 0.02,
                    label: 'wheel',
                    render: { visible: false }
                }
            );
            Body.setMass(wheel, t.wheelMass);
            return wheel;
        };

        this.wheelA = makeWheel(-1);   // rear
        this.wheelB = makeWheel(1);    // front

        // --- SUSPENSION ----------------------------------------------------
        this.suspension = [
            new SuspensionUnit({ chassis: this.chassis, wheel: this.wheelA, side: -1, tuning: t }),
            new SuspensionUnit({ chassis: this.chassis, wheel: this.wheelB, side: 1, tuning: t })
        ];

        // Trailing arms. The spring handles travel along the chassis's down axis;
        // these hold the hub at a fixed radius from a pivot alongside it, so the
        // wheel swings on an arc instead of drifting fore/aft. Matter's position
        // solver runs these, which is far more stable than a stiff force would be.
        this.arms = this.suspension.map(unit => Constraint.create({
            bodyA: this.chassis,
            pointA: { ...unit.armPivotLocal },
            bodyB: unit.wheel,
            length: t.armLength,
            stiffness: t.armStiffness,
            damping: t.armDamping,
            label: 'suspension_arm',
            render: { visible: false }
        }));

        // --- DRIVER --------------------------------------------------------
        this.driver = Bodies.circle(groundPoint.x, chassisY - t.chassisHeight, 14, {
            collisionFilter,
            frictionAir: 0.02,
            label: 'driver',
            render: { visible: false }
        });
        Body.setMass(this.driver, t.driverMass);

        this.seat = Constraint.create({
            bodyA: this.chassis,
            pointA: { x: 6, y: -t.chassisHeight / 2 },
            bodyB: this.driver,
            length: 14,
            stiffness: 0.55,
            damping: 0.12,
            label: 'seat',
            render: { visible: false }
        });

        this.namedParts = {
            chassis: this.chassis,
            wheelA: this.wheelA,
            wheelB: this.wheelB,
            driver: this.driver
        };
        this.parts = Object.values(this.namedParts);
        for (const part of this.parts) {
            part.isTruckPart = true;
            // Body-local copy of the shape, so the safety net can rebuild a body
            // whose vertices have been poisoned by a NaN (see placeBody).
            part.localVertices = part.vertices.map(v => ({
                x: v.x - part.position.x,
                y: v.y - part.position.y
            }));
        }

        this.composite = Composite.create({ label: 'truck' });
        Composite.add(this.composite, [
            ...this.parts,
            ...this.arms,
            this.seat
        ]);
        World.add(this.world, this.composite);

        this.buildSprites(config);
        this.resetState();
    }

    buildSprites(config) {
        const palette = CharacterGraphics.getTruckColors(config.truckStyle);
        this.accentColor = palette[0] || '#ff4d4d';
        this.rimColor = palette[2] || '#c9d1d9';

        if (typeof Image === 'undefined') return;   // headless (tests)

        // The SVG ships with painted-on tyres; strip them, we draw real ones.
        let svg = CharacterGraphics.generateTruckSVG(config.truckStyle, this.accentColor);
        svg = svg.replace(/<circle cx="125" cy="250"[\s\S]*?fill="#333" \/>/g, '');
        svg = svg.replace(/<circle cx="325" cy="250"[\s\S]*?fill="#333" \/>/g, '');

        this.bodyImage = new Image();
        this.bodyImage.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        this.bodyImage.width = 280;
        this.bodyImage.height = 168;

        this.driverImage = new Image();
        this.driverImage.src = 'data:image/svg+xml;charset=utf-8,'
            + encodeURIComponent(CharacterGraphics.generateDriverSVG(config.driverStyle));
        this.driverImage.width = 62;
        this.driverImage.height = 62;
    }

    resetState() {
        this.throttle = 0;
        this.jumpRequested = false;
        this.flipRequested = false;
        this.boostRequested = false;
        this.mudTouch = false;
        this.holdRequested = false;

        this.grounded = false;
        this.groundedA = false;
        this.groundedB = false;
        this.chassisContact = false;
        this.anyContact = false;
        this.isAirborne = false;
        this.jumpCooldown = 0;
        this.airborneTime = 0;
        this.stuckTime = 0;
        this.simTime = 0;

        this.speed = 0;             // px/step
        this.boostLevel = 100;
        this.boostReady = true;
        this.isBoosting = false;
        this.boostActive = false;

        this.jumpState = {
            startX: 0, startY: 0,
            current: 0, currentHeight: 0, duration: 0,   // the jump in progress
            last: 0, lastHeight: 0,           // the one just completed
            max: 0, maxHeight: 0              // best of the race
        };

        this.safetyRepairs = 0;
        this.safetyViolations = [];
        this.lastRepairAt = -1;
        this.landingImpact = 0;
        this.airborneVy = 0;
    }

    // ------------------------------------------------------------------ input

    /** @param {number} dir 1 forward, -1 reverse. Held; cleared each frame. */
    accelerate(dir) {
        this.throttle = clamp(dir, -1, 1);
    }

    /**
     * The action button. On the ground it jumps; in the air it flips.
     *
     * Flips are deliberately NOT on the throttle: drive is a toggle in this game,
     * so the throttle is on almost all the time, and tying rotation to it meant
     * every jump ended on the roof.
     */
    jump() {
        this.jumpRequested = true;
        this.flipRequested = true;
    }

    boost() {
        this.boostRequested = true;
    }

    /** Called during the countdown: settle onto the springs but do not creep. */
    hold() {
        this.holdRequested = true;
    }

    updatePhysicsConfig(config = {}) {
        Object.assign(this.tuning, config);
    }

    // ------------------------------------------------------- physics per step

    /**
     * Everything that pushes on a body. Runs once per FIXED step, before
     * Matter integrates, because Matter clears force buffers after each update.
     */
    preStep(dt) {
        const t = this.tuning;

        if (this.holdRequested) {
            for (const part of this.parts) {
                Body.setVelocity(part, { x: 0, y: part.velocity.y });
            }
        }

        // 1. SUSPENSION. Always first: it decides how much weight is on each tyre.
        for (const unit of this.suspension) unit.applyForces(dt);

        // 2. JUMP. Impulse the whole vehicle so it leaves the ground as one unit,
        //    then kick the springs so the wheels visibly reach for the ground.
        this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
        if (this.jumpRequested) {
            this.jumpRequested = false;
            // The cooldown is what stops a held jump key from stacking impulses:
            // contact tags linger a step or two after take-off, so "grounded"
            // alone would let you climb the sky.
            if (this.grounded && this.jumpCooldown === 0 && !this.holdRequested) {
                this.jumpCooldown = t.jumpCooldownMs;
                for (const part of this.parts) {
                    Body.setVelocity(part, {
                        x: part.velocity.x * (1 - t.jumpForwardBleed),
                        y: part.velocity.y - t.jumpVelocity
                    });
                }
                this.chassis.torque += t.jumpNoseTorque;
                for (const unit of this.suspension) unit.pop();
            }
        }

        // 3. DRIVE. Torque at the wheels, so grip and weight transfer decide how
        //    much of it reaches the ground.
        this.applyDrive();

        // 4. BOOST. Split across every part by mass, otherwise pushing only the
        //    chassis stretches the suspension into a wheelie.
        this.boostActive = false;
        if (this.boostRequested && this.boostReady && !this.holdRequested) {
            this.boostActive = true;
            const angle = this.chassis.angle;
            const direction = { x: Math.cos(angle), y: Math.sin(angle) };
            // Thrust tapers to nothing at boostTopSpeed, so holding it has a
            // ceiling instead of just integrating until something clamps it.
            const headroom = clamp(1 - this.speed / t.boostTopSpeed, 0, 1);
            for (const part of this.parts) {
                const magnitude = forceForGravities(part.mass, t.gravity, t.boostGravities) * headroom;
                Body.applyForce(part, part.position, Vector.mult(direction, magnitude));
            }
        }

        // 5. ASSISTS.
        this.applyDownForce();
        this.applyRecovery(dt);
    }

    applyDrive() {
        const t = this.tuning;
        const wheels = [this.wheelA, this.wheelB];
        const airborne = !this.grounded;
        const torque = (airborne ? t.airDriveTorque : t.driveTorque) * this.throttle;

        for (const wheel of wheels) {
            const spin = wheel.angularVelocity;

            if (this.throttle !== 0) {
                const overspeed = Math.sign(this.throttle) * spin > t.maxWheelSpin;
                if (!overspeed) wheel.torque += torque;

                // Reversing the throttle against real motion brakes rather than
                // just fighting the tyre, which is what makes stopping feel sharp.
                // torque/inertia*STEP_SQ is the resulting spin change, so dividing
                // by STEP_SQ makes these coefficients "fraction of spin per step".
                if (Math.sign(this.throttle) * spin < 0) {
                    wheel.torque -= spin * t.brakeStrength * wheel.inertia / STEP_SQ;
                }
            } else if (this.grounded) {
                wheel.torque -= spin * t.rollingResistance * wheel.inertia / STEP_SQ;
            }
        }

        // Pitch: a nudge for wheelies on the ground. Negative torque is nose-up,
        // which is what a player expects from the throttle.
        if (this.grounded) {
            if (this.throttle !== 0) this.chassis.torque -= t.wheelieTorque * this.throttle;
        } else {
            this.applyAirControl();
        }
    }

    /**
     * Airborne pitch. Holding the action button spins towards a fixed RATE - a
     * rate, not raw torque, so a long jump cannot become an involuntary triple
     * backflip. Otherwise the truck levels itself, so landings are on the wheels.
     */
    applyAirControl() {
        const t = this.tuning;
        const spin = this.chassis.angularVelocity;

        if (this.flipRequested) {
            const direction = this.throttle < 0 ? -1 : 1;    // reverse = front flip
            const target = -direction * t.airSpinRate;       // nose up by default
            const command = clamp((target - spin) * t.airSpinGain, -1, 1);
            this.chassis.torque += command * t.airControlTorque;
        } else {
            const command = clamp(
                -spin * t.airLevelSpinGain - this.normalisedAngle() * t.airLevelAngleGain,
                -1,
                1
            );
            this.chassis.torque += command * t.airLevelTorque;
        }
    }

    applyDownForce() {
        if (!this.grounded) return;
        const t = this.tuning;
        const angle = this.chassis.angle;
        const magnitude = forceForGravities(this.chassis.mass, t.gravity, t.downForceGravities);
        Body.applyForce(this.chassis, this.chassis.position, {
            x: -Math.sin(angle) * magnitude,
            y: Math.cos(angle) * magnitude
        });
    }

    /**
     * Time-escalating self-righting. The old version force-set the angular
     * velocity and applied 5g of LIFT, which is what made the whole game float;
     * this only ever applies torque plus a sub-1g hop, so gravity always wins.
     */
    applyRecovery(dt) {
        const t = this.tuning;
        const angle = this.normalisedAngle();
        const tipped = Math.abs(angle) > 1.0;                 // ~60 degrees over
        const crawling = this.speed < t.stuckSpeed;

        // Deliberately NOT conditioned on wheel contact: a truck resting on its
        // roof has no wheels on the ground, which is exactly when it needs help.
        // Decay rather than reset - a truck balanced on its nose twitches above
        // the speed threshold constantly, and resetting meant the assist never
        // escalated far enough to actually save it.
        if (tipped && crawling) {
            this.stuckTime += dt;
        } else {
            this.stuckTime = Math.max(0, this.stuckTime - dt * 2);
        }

        if (this.stuckTime < t.rightingDelayMs) return;

        const escalation = clamp(
            1 + (this.stuckTime - t.rightingDelayMs) / t.rightingEscalateMs,
            1,
            3
        );
        const direction = angle > 0 ? -1 : 1;
        const targetSpin = direction * t.rightingSpin * escalation;
        const spinError = targetSpin - this.chassis.angularVelocity;
        this.chassis.torque += clamp(spinError * 40, -1, 1) * t.rightingTorque * escalation;

        // Only once the assist has been trying for a while: a small hop to break
        // contact so the roll can actually happen. Strictly less than 1g.
        if (escalation > 1.3 && this.anyContact) {
            const lift = forceForGravities(this.chassis.mass, t.gravity, t.rightingHopGravities);
            Body.applyForce(this.chassis, this.chassis.position, { x: 0, y: -lift });
        }
    }

    // -------------------------------------------------------- state per frame

    /** Bookkeeping after the step(s): contacts, timers, boost tank, safety. */
    update(dt = 16.666) {
        const t = this.tuning;
        this.simTime += dt;

        this.groundedA = this.hasContact(this.wheelA);
        this.groundedB = this.hasContact(this.wheelB);
        const wasAirborne = this.isAirborne;

        // "grounded" is about traction, so it is wheels only. "airborne" is about
        // being in the air at all - a truck sliding along on its roof is neither
        // driveable nor flying, and treating that as a jump made airtime run
        // forever and the recovery assist never fire.
        this.grounded = this.groundedA || this.groundedB;
        this.chassisContact = this.hasContact(this.chassis);
        this.anyContact = this.grounded || this.chassisContact;

        if (this.anyContact) {
            this.airborneTime = 0;
        } else {
            this.airborneTime += dt;
            this.airborneVy = this.chassis.velocity.y;
        }
        // Hysteresis: a wheel skipping over a bump is not a jump.
        this.isAirborne = this.airborneTime > 90;

        this.speed = Math.hypot(this.chassis.velocity.x, this.chassis.velocity.y);

        this.trackJump(wasAirborne, dt);
        this.settleLanding(wasAirborne);
        this.applyMudDrag();

        for (let i = 0; i < this.suspension.length; i++) {
            const grounded = i === 0 ? this.groundedA : this.groundedB;
            this.suspension[i].updateSquash(grounded);
        }

        // Boost tank. Run it dry and it locks out until it has recharged past
        // boostMinToEngage, so an empty tank is a real pause rather than a stutter.
        const drain = this.boostActive ? t.boostDrainPerSec : -t.boostRefillPerSec;
        this.boostLevel = clamp(this.boostLevel - (drain * dt / 1000), 0, 100);
        if (this.boostLevel <= 0) this.boostReady = false;
        else if (this.boostLevel >= t.boostMinToEngage) this.boostReady = true;
        this.isBoosting = this.boostActive;

        enforceTruckSafety(this, SAFETY_LIMITS);

        // Intents last exactly one frame (however many physics steps that took),
        // so a flip needs the button held rather than tapped once.
        this.throttle = 0;
        this.flipRequested = false;
        this.boostRequested = false;
        this.holdRequested = false;
        this.mudTouch = false;
    }

    /** Touching something solid, per the engine's contact tags. */
    hasContact(body) {
        if (!this.physics) return false;
        // One step of slack: contact pairs flicker as a tyre rolls over seams.
        return body.contactStamp !== undefined
            && body.contactStamp >= this.physics.contactStamp - 1;
    }

    trackJump(wasAirborne, dt) {
        const state = this.jumpState;
        const { x, y } = this.chassis.position;

        if (this.isAirborne && !wasAirborne) {
            state.startX = x;
            state.startY = y;
            state.currentHeight = 0;
            state.duration = 0;
        }

        if (this.isAirborne) {
            state.duration += dt;
            state.current = Math.abs(x - state.startX);
            state.currentHeight = Math.max(state.currentHeight, state.startY - y);
        } else if (wasAirborne) {
            // Latch the completed jump - but only if it was a jump. The springs
            // are bouncy enough to pop the truck off the ground on touchdown, and
            // that hop would otherwise wipe the number before anyone read it.
            if (state.duration >= this.tuning.minJumpMs) {
                state.last = state.current;
                state.lastHeight = state.currentHeight;
                state.max = Math.max(state.max, state.current);
                state.maxHeight = Math.max(state.maxHeight, state.currentHeight);
            }
            state.current = 0;
            state.duration = 0;
        }
    }

    settleLanding(wasAirborne) {
        if (!wasAirborne || !this.grounded) return;
        const t = this.tuning;

        // Impact speed measured on the way in, before the springs and the collision
        // solver ate it - by the time a contact exists the number is already gone.
        this.landingImpact = Math.abs(this.airborneVy);

        // Punch the tyres flat on a heavy landing. The gradual squash from
        // suspension speed is too polite to read on a big drop.
        const punch = t.tireSquash * clamp(this.landingImpact / 24, 0, 1);
        for (const unit of this.suspension) {
            unit.squash = Math.max(unit.squash, punch);
        }

        // Bleed a little spin so a flat landing plants instead of pitching on.
        if (Math.abs(this.normalisedAngle()) < 0.6) {
            Body.setAngularVelocity(
                this.chassis,
                this.chassis.angularVelocity * (1 - t.landingSpinDamping)
            );
        }
    }

    applyMudDrag() {
        if (!this.mudTouch) return;
        const grip = this.tuning.mudGrip;
        Body.setVelocity(this.chassis, {
            x: this.chassis.velocity.x * grip,
            y: this.chassis.velocity.y
        });
        for (const wheel of [this.wheelA, this.wheelB]) {
            Body.setAngularVelocity(wheel, wheel.angularVelocity * grip);
        }
    }

    normalisedAngle() {
        return Math.atan2(Math.sin(this.chassis.angle), Math.cos(this.chassis.angle));
    }

    // ------------------------------------------------------------- accessors

    getPosition() {
        return this.chassis.position;
    }

    /** Display speed in MPH. */
    getSpeed() {
        return Math.round(this.speed * PX_PER_STEP_TO_MPH);
    }

    getBoostPercent() {
        return this.boostLevel;
    }

    getJumpMetrics() {
        const state = this.jumpState;
        return {
            current: Math.round(this.isAirborne ? state.current : state.last),
            height: Math.round(this.isAirborne ? state.currentHeight : state.lastHeight),
            max: Math.round(state.max),
            maxHeight: Math.round(state.maxHeight),
            airborne: this.isAirborne
        };
    }

    /** Snapshot for the renderer. Derived only from live bodies. */
    getRenderState() {
        return {
            accentColor: this.accentColor,
            rimColor: this.rimColor,
            bodyImage: this.bodyImage,
            driverImage: this.driverImage,
            chassis: {
                x: this.chassis.position.x,
                y: this.chassis.position.y,
                angle: this.chassis.angle,
                width: this.tuning.chassisWidth,
                height: this.tuning.chassisHeight
            },
            driver: {
                x: this.driver.position.x,
                y: this.driver.position.y,
                angle: this.chassis.angle * 0.6
            },
            wheels: [
                this.suspension[0].measure().getRenderState(this.groundedA),
                this.suspension[1].measure().getRenderState(this.groundedB)
            ],
            boosting: this.boostActive,
            airborne: this.isAirborne,
            bounds: this.chassis.bounds
        };
    }

    destroy() {
        World.remove(this.world, this.composite);
    }
}
