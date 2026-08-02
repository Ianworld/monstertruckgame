import Matter from 'matter-js';
import { PhysicsEngine } from '../../src/game/PhysicsEngine.js';
import { Truck } from '../../src/game/Truck.js';
import { CourseHazards } from '../../src/game/CourseHazards.js';
import { LevelGenerator } from '../../src/game/LevelGenerator.js';
import { createTuning, STEP_MS } from '../../src/game/TruckTuning.js';

export const GROUND_Y = 250;
export { STEP_MS };

/**
 * Headless rig: real PhysicsEngine, real Truck, no DOM.
 *
 * The engine steps at a fixed rate on purpose, so every number these tests
 * assert on is reproducible - run the suite twice and you get the same values.
 */
export function createRig({ tuning = {}, start = { x: 0, y: GROUND_Y }, terrain = flatGround() } = {}) {
    const physics = new PhysicsEngine();
    const tune = createTuning(tuning);
    physics.world.gravity.y = tune.gravity;

    terrain(physics.world);

    const truck = new Truck(physics, { truckStyle: 'monster', driverStyle: 'nerd' }, start, tune);
    physics.addTruck(truck);

    return { physics, truck, tuning: tune };
}

/** A single flat plate. Top surface sits at GROUND_Y. */
export function flatGround(from = -2000, to = 20000, y = GROUND_Y) {
    return (world) => {
        Matter.World.add(world, Matter.Bodies.rectangle(
            (from + to) / 2, y + 150, to - from, 300,
            { isStatic: true, friction: 0.9, restitution: 0 }
        ));
    };
}

/**
 * Flat run-up, a takeoff ramp, a gap, then a landing strip back at ground level.
 * The gap is deliberately comfortable: these tests are about launching and landing,
 * not about clearing a precise distance, so retuning speed should not break them.
 */
export function rampGround({ rampStart = 600, rise = -300, run = 900, gap = 180 } = {}) {
    return (world) => {
        flatGround(-2000, rampStart)(world);
        addSlope(world, rampStart, GROUND_Y, rampStart + run, GROUND_Y + rise);
        flatGround(rampStart + run + gap, rampStart + run + gap + 12000)(world);
    };
}

/** Rolling sine terrain, the sort of thing that shakes a bad suspension apart. */
export function roughGround({ from = -400, to = 24000, step = 220, amplitude = 90, wavelength = 1400 } = {}) {
    return (world) => {
        const heightAt = (x) => GROUND_Y
            + Math.sin(x / wavelength * Math.PI * 2) * amplitude
            + Math.sin(x / (wavelength * 0.31) * Math.PI * 2) * amplitude * 0.35;

        for (let x = from; x < to; x += step) {
            addSlope(world, x, heightAt(x), x + step, heightAt(x + step));
        }
    };
}

/** Terrain segment built the same way LevelGenerator builds them. */
export function addSlope(world, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);

    Matter.World.add(world, Matter.Bodies.rectangle(
        (x1 + x2) / 2,
        (y1 + y2) / 2 + 150,
        length + 12,
        300,
        { isStatic: true, angle: Math.atan2(dy, dx), friction: 0.9, restitution: 0 }
    ));
}

/**
 * Advance the sim. `input` runs before each step and sets truck intent, exactly
 * like GameManager does per frame.
 * @returns {Array<object>} one sample per step
 */
export function run(rig, steps, input = null, sample = null) {
    const samples = [];

    for (let i = 0; i < steps; i++) {
        if (input) input(rig.truck, i);
        rig.physics.stepFixed();
        rig.truck.update(STEP_MS);
        if (sample) samples.push(sample(rig.truck, i));
    }

    return samples;
}

export function runMs(rig, ms, input = null, sample = null) {
    return run(rig, Math.round(ms / STEP_MS), input, sample);
}

/** Let the truck drop onto its springs and stop moving. */
export function settle(rig, ms = 2500) {
    runMs(rig, ms);
    return rig;
}

export const throttle = (dir) => (truck) => truck.accelerate(dir);

/**
 * Roll the whole truck over: every part rotated about the chassis centre, so the
 * wheels genuinely end up in the air. Rotating the bodies in place instead would
 * invert the suspension axis and test something that cannot happen in play.
 */
export function flipTruck(truck, angle = Math.PI) {
    const pivot = { x: truck.chassis.position.x, y: truck.chassis.position.y };
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);

    for (const part of truck.parts) {
        const dx = part.position.x - pivot.x;
        const dy = part.position.y - pivot.y;
        Matter.Body.setPosition(part, {
            x: pivot.x + dx * cos - dy * sin,
            y: pivot.y + dx * sin + dy * cos
        });
        Matter.Body.setAngle(part, part.angle + angle);
        Matter.Body.setVelocity(part, { x: 0, y: 0 });
        Matter.Body.setAngularVelocity(part, 0);
    }
}

export function chassisY(truck) {
    return truck.chassis.position.y;
}

/** Contact-patch-to-chassis-centre height, i.e. what a player reads as ride height. */
export function rideHeight(truck) {
    return GROUND_Y - truck.chassis.position.y;
}

export function compressions(truck) {
    return truck.suspension.map(unit => unit.measure().compression);
}

/**
 * Drive a real course end to end with the throttle pinned, with the real hazards
 * attached - boost pads, springboards, mud and smashable crates all behave as
 * they do in the game. This is the only way to know a course is completable.
 *
 * @returns {object} what happened: whether it finished, how long it took, how
 *   long it spent going nowhere, and how far over it got.
 */
export function driveCourse(course, { boost = true, maxSeconds = 100 } = {}) {
    const physics = new PhysicsEngine();
    const tuning = createTuning();
    physics.world.gravity.y = tuning.gravity;

    const level = new LevelGenerator(physics.world).build(course);
    let coins = 0;
    const hazards = new CourseHazards(physics, { onCoin: () => coins++ });

    const truck = new Truck(
        physics,
        { truckStyle: 'monster', driverStyle: 'nerd' },
        { x: 400, y: GROUND_Y },
        tuning
    );
    physics.addTruck(truck);
    hazards.addTruck(truck, 'p1');

    const step = () => {
        physics.stepFixed();
        truck.update(STEP_MS);
        hazards.update(STEP_MS);
    };

    for (let i = 0; i < 90; i++) step();     // settle on the springs

    let steps = 0;
    let stalledSeconds = 0;
    let worstTilt = 0;
    let airborneSteps = 0;
    let lastX = truck.chassis.position.x;
    const limit = maxSeconds * 60;

    while (steps < limit && truck.chassis.position.x < level.finishX) {
        truck.accelerate(1);
        if (boost && steps % 30 === 0) truck.boost();
        step();
        steps++;

        worstTilt = Math.max(worstTilt, Math.abs(truck.normalisedAngle()));
        if (truck.isAirborne) airborneSteps++;
        if (steps % 60 === 0) {
            if (truck.chassis.position.x - lastX < 60) stalledSeconds++;
            lastX = truck.chassis.position.x;
        }
    }

    return {
        finished: truck.chassis.position.x >= level.finishX,
        seconds: +(steps / 60).toFixed(1),
        reached: Math.round(truck.chassis.position.x),
        finishX: level.finishX,
        stalledSeconds,
        worstTiltDeg: Math.round(worstTilt * 180 / Math.PI),
        airbornePct: Math.round((airborneSteps / Math.max(1, steps)) * 100),
        coins,
        repairs: truck.safetyRepairs
    };
}

/**
 * Every invariant, every step. Reads what the runtime guard actually found,
 * rather than re-checking afterwards (it repairs, so a second look is always
 * clean and would make this useless).
 */
export function collectViolations(rig, steps, input = null) {
    const found = [];
    run(rig, steps, input, (truck, step) => {
        for (const violation of truck.safetyViolations) found.push({ ...violation, step });
    });
    return found;
}
