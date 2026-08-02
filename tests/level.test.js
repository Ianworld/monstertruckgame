import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';

import { APRON_START, LevelGenerator } from '../src/game/LevelGenerator.js';
import { COURSES, getCourse } from '../src/game/Courses.js';

/**
 * Track integrity, checked for EVERY course.
 *
 * Everything here probes the real physics bodies rather than the generator's own
 * bookkeeping - the bug these tests exist for was exactly a mismatch between where
 * the generator thought the ground was and where it actually put it. Coins were
 * placed at one absolute height across 2,000px of hills, which buried 51 of the 79
 * of them, some 500px underground.
 *
 * Whether a course can actually be FINISHED is a separate question, and a physics
 * one; see courses.test.js, which drives a bot round each of them.
 */

function buildCourse(course) {
    const engine = Matter.Engine.create();
    const generator = new LevelGenerator(engine.world).build(course);

    const bodies = Matter.Composite.allBodies(engine.world);
    return {
        generator,
        // Ground only. Crates are loose furniture and tunnel roofs are above you,
        // so neither is something a probe looking for the track should find.
        terrain: bodies.filter(b => !b.isSensor && b.isStatic && b.label !== 'tunnel_roof'),
        roofs: bodies.filter(b => b.label === 'tunnel_roof'),
        coins: bodies.filter(b => b.label === 'coin'),
        pads: bodies.filter(b => b.label === 'boost_pad'),
        springs: bodies.filter(b => b.label === 'spring_pad'),
        crates: bodies.filter(b => b.label === 'crate'),
        mud: bodies.filter(b => b.label === 'mud_pit')
    };
}

/** Distance straight down from a point to solid track. 0 means it is buried. */
function clearance(terrain, x, y, max = 900) {
    for (let depth = 0; depth <= max; depth += 2) {
        if (Matter.Query.point(terrain, { x, y: y + depth }).length > 0) return depth;
    }
    return Infinity;
}

/**
 * Top surface of the real bodies at x, or NaN over a hole.
 *
 * `hint` narrows the search window. Scanning the full 6000px world at every
 * sample made this suite take 18 seconds. It is not circular to seed the search
 * from the generator's model: the "knows where its own ground is" test proves
 * that model is within 12px of the bodies, without a hint.
 */
function surfaceAt(terrain, x, hint) {
    const from = hint === undefined ? -3000 : hint - 200;
    const to = hint === undefined ? 3000 : hint + 200;

    for (let y = from; y < to; y += 2) {
        if (Matter.Query.point(terrain, { x, y }).length > 0) return y;
    }
    return NaN;
}

test('there are several distinct courses to choose from', () => {
    assert.ok(COURSES.length >= 3, `only ${COURSES.length} courses`);

    const ids = COURSES.map(c => c.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate course ids');

    for (const course of COURSES) {
        assert.ok(course.name && course.blurb, `${course.id} is missing its name or blurb`);
        assert.ok(course.difficulty >= 1 && course.difficulty <= 3, `${course.id} difficulty out of range`);
        assert.equal(typeof course.build, 'function', `${course.id} has no build()`);
    }

    assert.equal(getCourse('nonsense').id, COURSES[0].id, 'unknown ids should fall back, not throw');
});

for (const course of COURSES) {
    const label = course.name;

    test(`${label}: the track is continuous from the apron to the run-off`, () => {
        const { generator, terrain } = buildCourse(course);

        const holes = [];
        for (let x = APRON_START + 50; x < generator.finishX + 2000; x += 37) {
            if (Number.isNaN(surfaceAt(terrain, x, generator.groundYAt(x)))) holes.push(Math.round(x));
        }

        assert.deepEqual(holes.slice(0, 5), [], `no ground at x=${holes.slice(0, 5).join(', ')}`);
    });

    test(`${label}: no steps a wheel would trip over`, () => {
        const { generator, terrain } = buildCourse(course);

        let worst = 0;
        let worstX = 0;
        for (let x = APRON_START + 50; x < generator.finishX; x += 5) {
            const here = surfaceAt(terrain, x, generator.groundYAt(x));
            const next = surfaceAt(terrain, x + 5, generator.groundYAt(x + 5));
            if (Number.isNaN(here) || Number.isNaN(next)) continue;
            if (Math.abs(next - here) > worst) {
                worst = Math.abs(next - here);
                worstX = Math.round(x);
            }
        }

        assert.ok(worst < 20, `${worst.toFixed(0)}px vertical step at x=${worstX}`);
    });

    test(`${label}: nothing is steep enough to stop a truck`, () => {
        // Above about 40 degrees a monster truck is climbing rather than driving,
        // and these courses are meant to flow.
        const { generator } = buildCourse(course);
        const points = generator.surface;

        let steepest = 0;
        let steepestX = 0;
        for (let i = 1; i < points.length; i++) {
            const dx = points[i].x - points[i - 1].x;
            if (dx <= 0 || points[i].x > generator.finishX) continue;
            const slope = Math.abs(Math.atan2(points[i].y - points[i - 1].y, dx));
            if (slope > steepest) {
                steepest = slope;
                steepestX = Math.round(points[i].x);
            }
        }

        const degrees = steepest * 180 / Math.PI;
        assert.ok(degrees < 40, `${degrees.toFixed(0)} degree slope at x=${steepestX}`);
    });

    test(`${label}: the generator knows where its own ground is`, () => {
        const { generator, terrain } = buildCourse(course);

        let worst = 0;
        let worstX = 0;
        for (let x = APRON_START + 50; x < generator.finishX; x += 37) {
            const actual = surfaceAt(terrain, x);
            if (Number.isNaN(actual)) continue;
            const error = Math.abs(actual - generator.groundYAt(x));
            if (error > worst) {
                worst = error;
                worstX = Math.round(x);
            }
        }

        assert.ok(worst < 12, `surface model is ${worst.toFixed(0)}px out at x=${worstX}`);
    });

    test(`${label}: every coin floats above the track, in reach`, () => {
        const { terrain, coins } = buildCourse(course);
        assert.ok(coins.length > 30, `only ${coins.length} coins`);

        const gaps = coins.map(coin => ({
            x: Math.round(coin.position.x),
            gap: clearance(terrain, coin.position.x, coin.position.y)
        }));

        assert.deepEqual(gaps.filter(g => g.gap === 0).slice(0, 5), [], 'coins inside the terrain');
        assert.deepEqual(gaps.filter(g => !Number.isFinite(g.gap)).slice(0, 5), [], 'coins over a hole');

        // The truck's silhouette covers roughly 0-120px above the ground, so this
        // band runs from "collect by driving" to "collect with a hop".
        assert.deepEqual(gaps.filter(g => g.gap > 200).slice(0, 5), [], 'coins out of reach');
        const lowest = Math.min(...gaps.map(g => g.gap));
        assert.ok(lowest > 25, `a coin is only ${lowest}px off the deck`);
    });

    test(`${label}: pads and mud sit on the surface`, () => {
        const { generator, terrain, pads, springs, mud } = buildCourse(course);

        for (const body of [...pads, ...springs, ...mud]) {
            const gap = clearance(terrain, body.position.x, body.position.y);
            assert.ok(
                gap > 0 && gap < 40,
                `${body.label} at x=${Math.round(body.position.x)} is ${gap}px off the ground`
            );

            const slope = generator.groundAngleAt(body.position.x);
            assert.ok(
                Math.abs(body.angle - slope) < 0.12,
                `${body.label} at x=${Math.round(body.position.x)} does not follow the slope`
            );
        }
    });

    test(`${label}: crates rest on the track rather than in it`, () => {
        const { terrain, crates } = buildCourse(course);

        for (const crate of crates) {
            const gap = clearance(terrain, crate.position.x, crate.position.y);
            assert.ok(Number.isFinite(gap), `crate at x=${Math.round(crate.position.x)} is over a hole`);
            assert.ok(gap < 400, `crate at x=${Math.round(crate.position.x)} is floating ${gap}px up`);
            assert.equal(crate.isStatic, false, 'crates must be smashable, not scenery');
        }
    });

    test(`${label}: tunnels are tall enough to drive through`, () => {
        const { generator, terrain, roofs } = buildCourse(course);
        const tunnels = generator.markers.filter(m => m.type === 'tunnel');
        assert.equal(roofs.length, tunnels.length, 'every tunnel marker should have a roof body');

        for (const roof of roofs) {
            // Measure the real gap between the floor and the underside of the roof,
            // sampled across the tunnel rather than trusting the marker.
            for (const x of [roof.bounds.min.x + 20, roof.position.x, roof.bounds.max.x - 20]) {
                const floor = surfaceAt(terrain, x, generator.groundYAt(x));
                const headroom = floor - roof.bounds.max.y;
                // The truck stands about 180px to the top of the driver's head.
                assert.ok(
                    headroom > 200,
                    `tunnel at x=${Math.round(x)} leaves only ${headroom.toFixed(0)}px of headroom`
                );
            }
        }
    });

    test(`${label}: the course is a sensible length and starts on the apron`, () => {
        const { generator } = buildCourse(course);

        assert.ok(
            generator.finishX > 12000 && generator.finishX < 40000,
            `${generator.finishX}px is outside the range a race should be`
        );

        // The trucks spawn at x=120..400 and settle during the countdown, so the
        // start has to be flat and level whatever the course does afterwards.
        for (const x of [0, 200, 400, 800]) {
            assert.equal(generator.groundYAt(x), 250, `start apron is not level at x=${x}`);
        }
    });
}

test('a dry run matches the built course without making bodies', () => {
    // The menu previews courses this way, so the picture must match the track.
    for (const course of COURSES) {
        const dry = new LevelGenerator(null).build(course);
        const wet = new LevelGenerator(Matter.Engine.create().world).build(course);

        assert.equal(dry.finishX, wet.finishX, `${course.id} finish differs`);
        assert.equal(dry.surface.length, wet.surface.length, `${course.id} surface differs`);
        assert.equal(dry.markers.length, wet.markers.length, `${course.id} markers differ`);
        assert.equal(dry.trackBodies.length, 0, 'a dry run should not build bodies');
    }
});
