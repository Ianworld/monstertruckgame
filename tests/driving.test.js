import test from 'node:test';
import assert from 'node:assert/strict';

import {
    GROUND_Y,
    collectViolations,
    createRig,
    flatGround,
    flipTruck,
    rampGround,
    run,
    runMs,
    settle
} from './helpers/harness.js';
import { PX_PER_STEP_TO_MPH } from '../src/game/TruckTuning.js';

/**
 * "Not floaty" is a feel, but it is measurable: how high a jump goes, how long
 * the truck spends in the air, and how quickly it gets moving. These bands are
 * the contract - if a tuning change pushes a jump to a 1,400px moon shot (which
 * is what the old numbers did) the suite says so.
 */

const JUMP_APEX = { min: 150, max: 420 };       // px above take-off
const JUMP_AIRTIME = { min: 500, max: 1300 };   // ms

test('a jump arcs high enough to be fun and lands soon enough to feel weighty', () => {
    const rig = createRig();
    settle(rig, 1500);

    const restY = rig.truck.chassis.position.y;
    let jumped = false;

    const samples = runMs(rig, 2500, (truck) => {
        if (!jumped) {
            truck.jump();
            jumped = true;
        }
    }, (truck) => ({
        height: restY - truck.chassis.position.y,
        airborne: truck.isAirborne
    }));

    const apex = Math.max(...samples.map(s => s.height));
    const airtimeSteps = samples.filter(s => s.airborne).length;
    const airtime = airtimeSteps * (1000 / 60);

    assert.ok(
        apex > JUMP_APEX.min && apex < JUMP_APEX.max,
        `jump apex ${apex.toFixed(0)}px is outside ${JUMP_APEX.min}-${JUMP_APEX.max}px`
    );
    assert.ok(
        airtime > JUMP_AIRTIME.min && airtime < JUMP_AIRTIME.max,
        `airtime ${airtime.toFixed(0)}ms is outside ${JUMP_AIRTIME.min}-${JUMP_AIRTIME.max}ms`
    );

    // And it comes back down to roughly where it started.
    const finalHeight = samples[samples.length - 1].height;
    assert.ok(Math.abs(finalHeight) < 20, `did not return to ride height (${finalHeight.toFixed(1)}px off)`);
});

test('cannot jump while airborne (no mid-air stair climbing)', () => {
    const rig = createRig();
    settle(rig, 1500);

    const restY = rig.truck.chassis.position.y;
    // Mash the jump key every single step.
    const heights = runMs(rig, 2000, (truck) => truck.jump(), (truck) => restY - truck.chassis.position.y);

    assert.ok(
        Math.max(...heights) < JUMP_APEX.max,
        `spamming jump reached ${Math.max(...heights).toFixed(0)}px`
    );
});

test('holding the throttle through a jump still lands on its wheels', () => {
    // Drive is a toggle in this game, so the throttle is on nearly all the time.
    // If it doubled as air pitch, every jump would end on the roof - which is
    // exactly what a 75-second play-through used to do for a fifth of the race.
    const rig = createRig({ terrain: rampGround({ rampStart: 700, rise: -260, run: 700 }) });
    settle(rig, 1200);

    const angles = runMs(rig, 6000, (truck) => truck.accelerate(1), (truck) => truck.normalisedAngle());

    const worst = Math.max(...angles.map(Math.abs));
    assert.ok(worst < 1.6, `throttle alone rotated the truck to ${worst.toFixed(2)} rad`);
    assert.ok(
        Math.abs(angles[angles.length - 1]) < 0.6,
        'did not settle upright after the jump'
    );
});

test('holding the action button in the air flips the truck on purpose', () => {
    const rig = createRig();
    settle(rig, 1500);

    let rotation = 0;
    runMs(rig, 2500, (truck) => {
        truck.accelerate(1);
        truck.jump();               // jumps off the ground, flips once airborne
    }, (truck) => {
        if (truck.isAirborne) rotation += truck.chassis.angularVelocity;
    });

    assert.ok(
        Math.abs(rotation) > 2.0,
        `holding the action button only rotated ${Math.abs(rotation).toFixed(2)} rad`
    );
});

test('gets up to speed briskly and respects its top speed', () => {
    const rig = createRig();
    settle(rig, 1500);

    const speeds = runMs(rig, 6000, (truck) => truck.accelerate(1), (truck) => truck.getSpeed());

    const after1s = speeds[Math.round(60)];
    const top = Math.max(...speeds);

    assert.ok(after1s > 20, `too sluggish off the line: ${after1s} mph after one second`);
    assert.ok(top > 45, `top speed too low: ${top} mph`);
    assert.ok(top < 75, `top speed too high: ${top} mph`);

    // The wheel-spin cap is what limits it, so check the cap is really doing the work.
    const spinLimit = rig.tuning.maxWheelSpin * rig.tuning.wheelRadius * PX_PER_STEP_TO_MPH;
    assert.ok(top < spinLimit * 1.35, `speed ${top} mph escaped the spin cap (~${spinLimit.toFixed(0)} mph)`);
});

test('reversing the throttle stops the truck', () => {
    const rig = createRig();
    settle(rig, 1500);
    runMs(rig, 2500, (truck) => truck.accelerate(1));

    const before = rig.truck.chassis.velocity.x;
    assert.ok(before > 5, 'test needs the truck moving first');

    runMs(rig, 1500, (truck) => truck.accelerate(-1));
    assert.ok(
        rig.truck.chassis.velocity.x < before * 0.35,
        `braking barely worked: ${before.toFixed(1)} -> ${rig.truck.chassis.velocity.x.toFixed(1)} px/step`
    );
});

test('coasts to a stop instead of rolling forever', () => {
    const rig = createRig();
    settle(rig, 1500);
    runMs(rig, 2000, (truck) => truck.accelerate(1));

    runMs(rig, 8000);
    assert.ok(
        Math.abs(rig.truck.chassis.velocity.x) < 2.5,
        `still rolling at ${rig.truck.chassis.velocity.x.toFixed(2)} px/step after 8s of coasting`
    );
});

test('drives up a ramp and takes off, without flipping on landing', () => {
    const rig = createRig({ terrain: rampGround({ rampStart: 700, rise: -260, run: 700 }) });
    settle(rig, 1200);

    const samples = runMs(rig, 6000, (truck) => truck.accelerate(1), (truck) => ({
        x: truck.chassis.position.x,
        airborne: truck.isAirborne,
        angle: truck.normalisedAngle()
    }));

    assert.ok(samples.some(s => s.airborne), 'never left the ramp');
    assert.ok(samples[samples.length - 1].x > 2000, 'never made it up the ramp');

    const upright = Math.abs(samples[samples.length - 1].angle);
    assert.ok(upright < 0.9, `ended up on its roof (${upright.toFixed(2)} rad)`);
    assert.equal(rig.truck.safetyRepairs, 0, 'needed a safety repair on a normal jump');
});

test('lands nose-first from a big drop and recovers', () => {
    const rig = createRig({ tuning: { spawnDrop: 500 } });

    // Pitch it nose-down before it touches, then let it sort itself out.
    rig.truck.chassis.torque = -60;
    runMs(rig, 6000);

    const angle = Math.abs(rig.truck.normalisedAngle());
    assert.ok(angle < 0.9, `did not recover from a nose-first landing (${angle.toFixed(2)} rad)`);
    assert.ok(rig.truck.grounded, 'ended the test airborne');
});

test('self-rights when flipped, and never gets lifted by the assist', () => {
    const rig = createRig();
    settle(rig, 1200);

    flipTruck(rig.truck);
    const heights = runMs(rig, 8000, null, (truck) => GROUND_Y - truck.chassis.position.y);

    const angle = Math.abs(rig.truck.normalisedAngle());
    assert.ok(angle < 1.0, `still upside down after 8s (${angle.toFixed(2)} rad)`);

    // The old recovery code applied ~5g of lift; nothing should balloon upwards.
    const highest = Math.max(...heights);
    assert.ok(highest < 260, `recovery assist launched the truck ${highest.toFixed(0)}px up`);
});

test('boost accelerates the truck and drains the tank', () => {
    const rig = createRig();
    settle(rig, 1500);

    const before = rig.truck.chassis.velocity.x;
    runMs(rig, 1000, (truck) => {
        truck.accelerate(1);
        truck.boost();
    });

    assert.ok(rig.truck.chassis.velocity.x > before + 6, 'boost did nothing');
    assert.ok(rig.truck.boostLevel < 90, `tank did not drain (${rig.truck.boostLevel.toFixed(1)}%)`);

    runMs(rig, 5000);
    assert.equal(rig.truck.boostLevel, 100, 'tank did not refill');
});

test('boost has a ceiling and never reaches the safety clamp', () => {
    // Boost is a force, so without a taper a full tank was four seconds of
    // unopposed acceleration - it topped 150mph and got clipped by the safety
    // limiter during ordinary play, which is a guard rail doing gameplay's job.
    // Long plate: 20 seconds at full chat covers a lot of ground.
    const rig = createRig({ terrain: flatGround(-2000, 120000) });
    settle(rig, 1500);

    const hammerTheBoost = (truck) => {
        truck.accelerate(1);
        truck.boost();
    };

    const speeds = runMs(rig, 12000, hammerTheBoost, (truck) => truck.getSpeed());
    const top = Math.max(...speeds);

    assert.ok(top > 65, `boost is not worth using: only ${top} mph`);
    assert.ok(top < 100, `boost top speed ran away: ${top} mph`);

    const violations = collectViolations(rig, 600, hammerTheBoost);
    assert.deepEqual(violations, [], 'held boost tripped the safety limiter');
});

test('an empty boost tank locks out until it has recharged', () => {
    const rig = createRig();
    settle(rig, 1500);
    const hold = (truck) => truck.boost();

    // A full tank is four seconds of thrust; run it dry.
    runMs(rig, 4200, hold);
    assert.ok(rig.truck.boostLevel < 20, `tank should be near empty: ${rig.truck.boostLevel.toFixed(1)}%`);
    assert.equal(rig.truck.boostReady, false, 'empty tank is still armed');

    // Still holding the button: it must not sputter straight back on.
    runMs(rig, 600, hold, (truck) => {
        assert.equal(truck.boostActive, false, 'empty tank kept firing');
    });

    // It comes back once recharged past the threshold.
    runMs(rig, 2500, hold);
    assert.equal(rig.truck.boostReady, true, 'tank never re-armed');
});

test('jump distance metrics only count real airtime', () => {
    const rig = createRig();
    settle(rig, 1500);

    assert.equal(rig.truck.getJumpMetrics().current, 0);

    let jumped = false;
    runMs(rig, 2500, (truck) => {
        truck.accelerate(1);
        if (!jumped && truck.speed > 6) {
            truck.jump();
            jumped = true;
        }
    });

    const metrics = rig.truck.getJumpMetrics();
    assert.ok(metrics.max > 60, `jump distance not recorded: ${metrics.max}px`);
    assert.ok(metrics.maxHeight > 60, `jump height not recorded: ${metrics.maxHeight}px`);
    assert.equal(metrics.airborne, false);

    // A bounce on touchdown must not wipe the jump that was just completed.
    assert.ok(metrics.current > 60, 'completed jump distance was reset by the landing');
});
