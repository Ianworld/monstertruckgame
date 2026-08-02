import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';

import {
    collectViolations,
    createRig,
    roughGround,
    run,
    runMs,
    settle
} from './helpers/harness.js';
import { PhysicsEngine } from '../src/game/PhysicsEngine.js';
import { Truck } from '../src/game/Truck.js';
import { inspectTruck, repairTruck, SAFETY_LIMITS } from '../src/game/PhysicsSafety.js';
import { STEP_MS, createTuning } from '../src/game/TruckTuning.js';

/**
 * The "don't let it get off the rails" suite: long runs, abuse, and the guard
 * rails themselves. Anything here failing means the simulation can reach a state
 * a player would call broken.
 */

test('30 seconds flat out over rough terrain breaks no invariants', () => {
    const rig = createRig({ terrain: roughGround() });
    settle(rig, 1000);

    const violations = collectViolations(rig, 30 * 60, (truck, step) => {
        truck.accelerate(1);
        if (step % 40 === 0) truck.boost();
        if (step % 150 === 0) truck.jump();
    });

    assert.deepEqual(
        violations.slice(0, 5),
        [],
        `simulation went out of bounds: ${JSON.stringify(violations.slice(0, 5))}`
    );
    assert.equal(rig.truck.safetyRepairs, 0, 'the safety net had to intervene');

    // And it actually got somewhere, rather than surviving by standing still.
    assert.ok(rig.truck.chassis.position.x > 6000, `only travelled ${rig.truck.chassis.position.x.toFixed(0)}px`);
});

test('everything stays finite through 60 seconds of abuse', () => {
    const rig = createRig({ terrain: roughGround({ amplitude: 140 }) });

    runMs(rig, 60000, (truck, step) => {
        truck.accelerate(step % 400 < 320 ? 1 : -1);
        if (step % 30 === 0) truck.boost();
        if (step % 97 === 0) truck.jump();
    });

    for (const [name, body] of Object.entries(rig.truck.namedParts)) {
        assert.ok(Number.isFinite(body.position.x), `${name}.position.x went NaN`);
        assert.ok(Number.isFinite(body.position.y), `${name}.position.y went NaN`);
        assert.ok(Number.isFinite(body.angle), `${name}.angle went NaN`);
        assert.ok(Number.isFinite(body.velocity.x), `${name}.velocity went NaN`);
    }
});

test('a stationary truck does not creep', () => {
    const rig = createRig();
    settle(rig, 3000);

    const startX = rig.truck.chassis.position.x;
    runMs(rig, 5000);

    const drift = Math.abs(rig.truck.chassis.position.x - startX);
    assert.ok(drift < 3, `truck wandered ${drift.toFixed(2)}px while parked`);
});

test('same inputs produce the same result (fixed timestep is deterministic)', () => {
    const script = (truck, step) => {
        truck.accelerate(1);
        if (step % 70 === 0) truck.jump();
        if (step % 25 === 0) truck.boost();
    };

    const outcome = () => {
        const rig = createRig({ terrain: roughGround() });
        runMs(rig, 8000, script);
        return {
            x: rig.truck.chassis.position.x,
            y: rig.truck.chassis.position.y,
            angle: rig.truck.chassis.angle
        };
    };

    const a = outcome();
    const b = outcome();

    assert.equal(a.x, b.x);
    assert.equal(a.y, b.y);
    assert.equal(a.angle, b.angle);
});

test('frame rate does not change the physics', () => {
    // 60fps: one fixed step per frame. 30fps: two per frame. Same simulation.
    const script = (truck, step) => {
        truck.accelerate(1);
        if (step === 120) truck.jump();
    };

    const smooth = createRig();
    run(smooth, 600, script);

    const choppy = createRig();
    for (let frame = 0; frame < 300; frame++) {
        // Feed the accumulator a 30fps frame; it should run exactly two steps.
        script(choppy.truck, frame * 2);
        const steps = choppy.physics.update(STEP_MS * 2);
        assert.equal(steps, 2, 'accumulator did not run two steps for a 33ms frame');
        choppy.truck.update(STEP_MS * 2);
    }

    // Inputs land on different steps, so allow a small tolerance rather than
    // demanding bit equality: what matters is that it is the same truck.
    const dx = Math.abs(smooth.truck.chassis.position.x - choppy.truck.chassis.position.x);
    assert.ok(dx < 120, `30fps drifted ${dx.toFixed(0)}px from 60fps over 10s`);
});

test('a long hitch is dropped rather than simulated in one lump', () => {
    const rig = createRig();
    settle(rig, 1000);

    const steps = rig.physics.update(4000);   // tab was in the background for 4s
    assert.ok(steps <= rig.physics.maxStepsPerFrame, `ran ${steps} steps for one frame`);
    assert.equal(rig.physics.accumulator, 0, 'backlog was kept and will replay later');
});

test('two trucks in one world do not collide with each other', () => {
    const rig = createRig();
    const other = new Truck(
        rig.physics,
        { truckStyle: 'dinosaur', driverStyle: 'barbie' },
        { x: 0, y: 250 },
        createTuning()
    );
    rig.physics.addTruck(other);

    settle(rig, 2000);

    // Spawned on top of each other: if they collided, one would have been
    // launched sideways or crushed into the floor.
    assert.ok(Math.abs(other.chassis.position.x - rig.truck.chassis.position.x) < 5);
    assert.deepEqual(inspectTruck(other), []);
    assert.deepEqual(inspectTruck(rig.truck), []);
});

test('trucks still collide with terrain and still pick up sensors', () => {
    const rig = createRig();
    const coin = Matter.Bodies.circle(300, 180, 16, { isStatic: true, isSensor: true, label: 'coin' });
    Matter.World.add(rig.physics.world, coin);

    let hits = 0;
    Matter.Events.on(rig.physics.engine, 'collisionStart', (event) => {
        for (const pair of event.pairs) {
            if (pair.bodyA === coin || pair.bodyB === coin) hits++;
        }
    });

    settle(rig, 1000);
    assert.ok(rig.truck.grounded, 'truck fell through the terrain');

    runMs(rig, 4000, (truck) => truck.accelerate(1));
    assert.ok(hits > 0, 'drove through a coin without triggering it');
});

test('sensors never count as ground', () => {
    const rig = createRig({ terrain: () => {} });   // no terrain at all
    const pad = Matter.Bodies.rectangle(0, 320, 400, 20, {
        isStatic: true, isSensor: true, label: 'boost_pad'
    });
    Matter.World.add(rig.physics.world, pad);

    runMs(rig, 500);
    assert.equal(rig.truck.grounded, false, 'a sensor was treated as solid ground');
});

// --------------------------------------------------------------- guard rails

test('the safety net catches a NaN and puts the truck back', () => {
    const rig = createRig();
    settle(rig, 1500);
    const safeX = rig.truck.chassis.position.x;

    rig.truck.chassis.position.x = NaN;
    const violations = inspectTruck(rig.truck);
    assert.ok(violations.some(v => v.code === 'non-finite'), 'NaN went unnoticed');

    rig.truck.update(STEP_MS);   // runs enforceTruckSafety

    assert.ok(Number.isFinite(rig.truck.chassis.position.x), 'truck left in a NaN state');
    assert.ok(Math.abs(rig.truck.chassis.position.x - safeX) < 50, 'repaired to the wrong place');
    assert.equal(rig.truck.safetyRepairs, 1);
    assert.deepEqual(inspectTruck(rig.truck), []);
});

test('the safety net clamps a body flung at impossible speed', () => {
    const rig = createRig();
    settle(rig, 1500);

    Matter.Body.setVelocity(rig.truck.chassis, { x: 5000, y: -5000 });
    assert.ok(inspectTruck(rig.truck).some(v => v.code === 'speed'));

    rig.truck.update(STEP_MS);
    const speed = Math.hypot(rig.truck.chassis.velocity.x, rig.truck.chassis.velocity.y);
    assert.ok(speed <= SAFETY_LIMITS.maxSpeed + 1e-6, `still doing ${speed.toFixed(1)} px/step`);
});

test('the safety net reattaches a wheel that has been torn off', () => {
    const rig = createRig();
    settle(rig, 1500);

    Matter.Body.setPosition(rig.truck.wheelA, { x: 4000, y: -800 });
    const violations = inspectTruck(rig.truck);
    assert.ok(violations.some(v => v.code === 'hub-detached' || v.code === 'out-of-bounds'));

    rig.truck.update(STEP_MS);
    rig.truck.suspension[0].measure();

    const stretch = Math.hypot(
        rig.truck.wheelA.position.x - rig.truck.suspension[0].anchorWorld.x,
        rig.truck.wheelA.position.y - rig.truck.suspension[0].anchorWorld.y
    );
    assert.ok(stretch < 100, `wheel still ${stretch.toFixed(0)}px away from its mount`);
    assert.ok(rig.truck.safetyRepairs > 0, 'repair was not counted');
});

test('falling out of the world is recoverable', () => {
    const rig = createRig();
    settle(rig, 1500);

    Matter.Body.setPosition(rig.truck.chassis, { x: 500, y: 90000 });
    rig.truck.update(STEP_MS);

    assert.ok(rig.truck.chassis.position.y < 5000, 'truck was left in the void');
    assert.deepEqual(inspectTruck(rig.truck), []);
});

test('repairTruck restores a coherent truck, not just a valid one', () => {
    const rig = createRig();
    settle(rig, 1500);

    repairTruck(rig.truck, { x: 1234, y: 100 });

    assert.equal(rig.truck.chassis.position.x, 1234);
    assert.deepEqual(inspectTruck(rig.truck), []);

    rig.truck.suspension.forEach((unit) => {
        unit.measure();
        assert.ok(
            Math.abs(unit.compression - rig.tuning.staticSag) < 1,
            'repaired suspension is not at its static height'
        );
    });

    // And it carries on simulating normally from there.
    runMs(rig, 2000, (truck) => truck.accelerate(1));
    assert.deepEqual(inspectTruck(rig.truck), []);
});

test('a headless PhysicsEngine needs no DOM', () => {
    const physics = new PhysicsEngine();
    assert.equal(physics.ctx, null);
    physics.renderSplitScreen(0, { finishX: 30000 });   // must not throw
    physics.resize();
    assert.equal(physics.stepCount, 0);
    physics.stepFixed();
    assert.equal(physics.stepCount, 1);
});
