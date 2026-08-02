import test from 'node:test';
import assert from 'node:assert/strict';

import {
    GROUND_Y,
    compressions,
    createRig,
    flatGround,
    rideHeight,
    run,
    runMs,
    settle
} from './helpers/harness.js';

/**
 * The suspension is the thing that was broken, so these tests pin down its
 * behaviour rather than its implementation: does it hold the truck up, does it
 * move, does it stay inside its travel, and does it stop moving when it should.
 */

test('rests at its designed sag, not on the bump stops and not fully extended', () => {
    const rig = createRig();
    settle(rig);

    const t = rig.tuning;
    const [rear, front] = compressions(rig.truck);

    for (const compression of [rear, front]) {
        assert.ok(compression > 2, `suspension is hanging free (${compression.toFixed(1)}px)`);
        assert.ok(
            compression < t.maxCompression * 0.75,
            `resting on the bump stop (${compression.toFixed(1)}px of ${t.maxCompression})`
        );
    }

    // Both corners carry the same load on flat ground.
    assert.ok(Math.abs(rear - front) < 3, `uneven at rest: ${rear.toFixed(1)} vs ${front.toFixed(1)}`);

    // Ride height matches the geometry it was designed from: anchor, sagged
    // spring and tyre radius. Pinning the derivation rather than a magic number
    // means a geometry change has to be deliberate, not accidental.
    const expected = t.anchorY + (t.restLength - t.staticSag) + t.wheelRadius;
    const height = rideHeight(rig.truck);
    assert.ok(
        Math.abs(height - expected) < 8,
        `ride height ${height.toFixed(1)}px, expected ~${expected}px from the tuning geometry`
    );

    // And the bodywork clears the tyres, or the shocks have nowhere to be drawn.
    const bodyBottom = rig.truck.chassis.position.y + t.chassisHeight / 2;
    const tyreTop = rig.truck.wheelA.position.y - t.wheelRadius;
    assert.ok(tyreTop > bodyBottom - 4, 'tyres are swallowing the suspension travel');
});

test('holds the truck up: chassis and hubs never sink into the ground', () => {
    const rig = createRig();

    const worst = runMs(rig, 4000, null, (truck) => ({
        chassisBottom: truck.chassis.bounds.max.y,
        hubs: truck.suspension.map(u => u.wheel.position.y + u.tuning.wheelRadius)
    })).reduce((acc, sample) => ({
        chassisBottom: Math.max(acc.chassisBottom, sample.chassisBottom),
        deepest: Math.max(acc.deepest, ...sample.hubs)
    }), { chassisBottom: -Infinity, deepest: -Infinity });

    assert.ok(worst.chassisBottom < GROUND_Y - 15, `chassis dragged on the floor at y=${worst.chassisBottom.toFixed(1)}`);
    // Matter allows a little penetration by design (slop); 6px is plenty.
    assert.ok(worst.deepest < GROUND_Y + 6, `tyre sank ${(worst.deepest - GROUND_Y).toFixed(1)}px into the ground`);
});

test('actually moves: a drop compresses the springs, then they push back', () => {
    const rig = createRig({ tuning: { spawnDrop: 220 } });

    const history = runMs(rig, 2500, null, (truck) => ({
        compression: Math.max(...compressions(truck)),
        chassisY: truck.chassis.position.y
    }));

    const peak = Math.max(...history.map(s => s.compression));
    const t = rig.tuning;

    assert.ok(peak > 12, `springs barely moved on impact (${peak.toFixed(1)}px)`);

    // Bump stop holds: a hard landing may pass maxCompression, but not by much,
    // and never far enough to put the chassis on the tyre.
    assert.ok(
        peak < t.maxCompression + 12,
        `blew through the bump stop: ${peak.toFixed(1)}px vs ${t.maxCompression}px of travel`
    );

    // And it rebounds: chassis ends up higher than at peak compression.
    const lowest = Math.max(...history.map(s => s.chassisY));
    const final = history[history.length - 1].chassisY;
    assert.ok(lowest - final > 4, 'suspension stayed collapsed instead of rebounding');
});

test('settles instead of pogoing forever', () => {
    const rig = createRig({ tuning: { spawnDrop: 180 } });
    settle(rig, 3000);

    const late = runMs(rig, 800, null, (truck) => Math.abs(truck.chassis.velocity.y));
    const worst = Math.max(...late);

    assert.ok(worst < 0.6, `still bouncing after 3s: ${worst.toFixed(2)} px/step of vertical motion`);
});

test('travel is bounded in both directions across a rough run', () => {
    const rig = createRig({ terrain: (world) => flatGround(-500, 400)(world) });
    settle(rig, 1500);

    // Drive off the end of the plate: full droop, then a hard landing.
    const samples = runMs(rig, 2500, (truck) => truck.accelerate(1), (truck) => compressions(truck));
    const t = rig.tuning;

    const all = samples.flat();
    const maxCompression = Math.max(...all);
    const maxExtension = -Math.min(...all);

    assert.ok(
        maxCompression < t.maxCompression + 15,
        `compression ran away: ${maxCompression.toFixed(1)}px`
    );
    assert.ok(
        maxExtension < t.maxExtension + 15,
        `droop ran away: ${maxExtension.toFixed(1)}px`
    );
});

test('hubs stay attached to the truck', () => {
    const rig = createRig({ tuning: { spawnDrop: 200 } });

    const worst = runMs(rig, 4000, (truck, step) => {
        truck.accelerate(1);
        if (step % 90 === 0) truck.jump();
    }, (truck) => Math.max(...truck.suspension.map((unit) => {
        unit.measure();
        return Math.hypot(
            unit.wheel.position.x - unit.anchorWorld.x,
            unit.wheel.position.y - unit.anchorWorld.y
        );
    }))).reduce((a, b) => Math.max(a, b), 0);

    const t = rig.tuning;
    assert.ok(
        worst < t.restLength + t.maxExtension + 20,
        `hub stretched to ${worst.toFixed(1)}px (limit ${t.restLength + t.maxExtension})`
    );
    assert.equal(rig.truck.safetyRepairs, 0, 'safety net had to reattach a wheel');
});

test('spring rate is progressive and always pushes back towards rest', () => {
    const rig = createRig();
    const unit = rig.truck.suspension[0];

    const soft = unit.springForce(5);
    const mid = unit.springForce(15);
    const hard = unit.springForce(29);

    assert.ok(soft > 0 && mid > soft && hard > mid, 'spring force is not monotonic');

    // Progressive: the second half of the travel is stiffer than the first.
    const firstHalfRate = (mid - soft) / 10;
    const secondHalfRate = (hard - mid) / 14;
    assert.ok(secondHalfRate > firstHalfRate * 1.2, 'spring is linear, not progressive');

    // Extension pulls the wheel back up (negative force).
    assert.ok(unit.springForce(-10) < 0, 'extended spring is not pulling back');

    // Past the stops the rate jumps hard.
    const atStop = unit.springForce(rig.tuning.maxCompression);
    const pastStop = unit.springForce(rig.tuning.maxCompression + 10);
    assert.ok(pastStop > atStop * 1.3, 'bump stop is not engaging');
});

test('render state matches the physics it is drawn from', () => {
    const rig = createRig();
    settle(rig, 1200);
    run(rig, 30, (truck) => truck.accelerate(1));

    const state = rig.truck.getRenderState();

    state.wheels.forEach((wheel, index) => {
        const unit = rig.truck.suspension[index];

        // The hub the renderer draws IS the wheel body.
        assert.equal(wheel.hub.x, unit.wheel.position.x);
        assert.equal(wheel.hub.y, unit.wheel.position.y);
        assert.equal(wheel.radius, rig.tuning.wheelRadius);

        // Shock endpoints are real points on the truck, a plausible distance apart.
        const shockLength = Math.hypot(wheel.hub.x - wheel.mount.x, wheel.hub.y - wheel.mount.y);
        assert.ok(shockLength > 20 && shockLength < 130, `shock drawn ${shockLength.toFixed(1)}px long`);

        const armLength = Math.hypot(wheel.hub.x - wheel.armPivot.x, wheel.hub.y - wheel.armPivot.y);
        assert.ok(armLength > 15 && armLength < 70, `arm drawn ${armLength.toFixed(1)}px long`);

        // Compression ratio is normalised for the renderer.
        assert.ok(wheel.ratio >= -1 && wheel.ratio <= 1, `ratio out of range: ${wheel.ratio}`);
        assert.ok(Number.isFinite(wheel.squash) && wheel.squash >= 0 && wheel.squash < 0.5);
        assert.ok(Number.isFinite(wheel.angle));
    });

    // Both corners reported, in rear-then-front order.
    assert.equal(state.wheels.length, 2);
    assert.ok(state.wheels[0].hub.x < state.wheels[1].hub.x);
});

test('tyre squash appears on impact and decays afterwards', () => {
    const rig = createRig({ tuning: { spawnDrop: 200 } });

    const squash = runMs(rig, 1200, null, (truck) => Math.max(...truck.suspension.map(u => u.squash)));
    const peak = Math.max(...squash);

    assert.ok(peak > 0.02, `no squash on a 200px drop (peak ${peak.toFixed(3)})`);
    assert.ok(peak <= rig.tuning.tireSquash + 1e-6, `squash exceeded its cap: ${peak.toFixed(3)}`);

    settle(rig, 1500);
    const resting = Math.max(...rig.truck.suspension.map(u => u.squash));
    assert.ok(resting < peak * 0.75, 'squash never relaxed');
});
