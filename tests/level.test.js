import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';

import { LevelGenerator } from '../src/game/LevelGenerator.js';

/**
 * Track integrity.
 *
 * Everything here is checked against the real physics bodies with point probes,
 * not against the generator's own bookkeeping - the bug these tests exist for was
 * exactly a mismatch between where the generator thought the ground was and where
 * it actually put it. Coins were placed at one absolute height across 2,000px of
 * hills, which buried 51 of the 79 of them, some 500px underground.
 */

function buildTrack() {
    const engine = Matter.Engine.create();
    const generator = new LevelGenerator(engine.world);
    generator.generateFixedTrack();

    const bodies = Matter.Composite.allBodies(engine.world);
    return {
        generator,
        terrain: bodies.filter(b => !b.isSensor),
        coins: bodies.filter(b => b.label === 'coin'),
        pads: bodies.filter(b => b.label === 'boost_pad'),
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

/** Top surface of the real bodies at x, or NaN over a hole. */
function surfaceAt(terrain, x) {
    for (let y = -3000; y < 3000; y += 2) {
        if (Matter.Query.point(terrain, { x, y }).length > 0) return y;
    }
    return NaN;
}

const RACE_START = -700;
const RACE_END = 33000;

test('the track is continuous from the start wall to the run-off', () => {
    const { terrain } = buildTrack();

    const holes = [];
    for (let x = RACE_START; x < RACE_END; x += 37) {
        if (Number.isNaN(surfaceAt(terrain, x))) holes.push(x);
    }

    assert.deepEqual(holes.slice(0, 5), [], `no ground at x=${holes.slice(0, 5).join(', ')}`);
});

test('the track has no steps a wheel would trip over', () => {
    const { terrain } = buildTrack();

    let worst = 0;
    let worstX = 0;
    for (let x = RACE_START; x < RACE_END - 5; x += 5) {
        const here = surfaceAt(terrain, x);
        const next = surfaceAt(terrain, x + 5);
        if (Number.isNaN(here) || Number.isNaN(next)) continue;
        const step = Math.abs(next - here);
        if (step > worst) {
            worst = step;
            worstX = x;
        }
    }

    // A 37px tyre climbs a small lip happily; a 40px wall is a crash.
    assert.ok(worst < 20, `${worst.toFixed(0)}px vertical step at x=${worstX}`);
});

test('the generator knows where its own ground is', () => {
    // groundYAt is what every pickup is placed against, so if it disagrees with
    // the bodies then nothing placed on the track can be trusted.
    const { generator, terrain } = buildTrack();

    let worst = 0;
    let worstX = 0;
    for (let x = RACE_START; x < RACE_END; x += 37) {
        const actual = surfaceAt(terrain, x);
        if (Number.isNaN(actual)) continue;
        const error = Math.abs(actual - generator.groundYAt(x));
        if (error > worst) {
            worst = error;
            worstX = x;
        }
    }

    assert.ok(worst < 12, `surface model is ${worst.toFixed(0)}px out at x=${worstX}`);
});

test('sloped segments put their top face where they were asked to', () => {
    // Regression: the centre used to be offset 150px straight down in world space
    // rather than perpendicular, so a rotated block's surface ended up elsewhere.
    const engine = Matter.Engine.create();
    const generator = new LevelGenerator(engine.world);
    generator.addSegment(0, 0, 1000, -400);          // a steep ramp
    const terrain = Matter.Composite.allBodies(engine.world);

    for (const x of [100, 300, 500, 700, 900]) {
        const expected = -0.4 * x;                    // the line from (0,0) to (1000,-400)
        const actual = surfaceAt(terrain, x);
        assert.ok(
            Math.abs(actual - expected) < 8,
            `ramp surface at x=${x} is ${actual.toFixed(0)}, expected ${expected.toFixed(0)}`
        );
    }
});

test('every coin floats above the track, in reach of the truck', () => {
    const { terrain, coins } = buildTrack();
    assert.ok(coins.length > 50, `only ${coins.length} coins on the track`);

    const heights = coins.map(coin => ({
        x: Math.round(coin.position.x),
        gap: clearance(terrain, coin.position.x, coin.position.y)
    }));

    const buried = heights.filter(h => h.gap === 0);
    assert.deepEqual(buried.slice(0, 5), [], `coins inside the terrain: ${JSON.stringify(buried.slice(0, 5))}`);

    const stranded = heights.filter(h => !Number.isFinite(h.gap));
    assert.deepEqual(stranded.slice(0, 5), [], `coins over a hole: ${JSON.stringify(stranded.slice(0, 5))}`);

    // The truck's silhouette covers roughly 0-120px above the ground, so this band
    // is "collect by driving" through "collect with a hop" - never "unreachable".
    const tooHigh = heights.filter(h => h.gap > 200);
    assert.deepEqual(tooHigh.slice(0, 5), [], `coins out of reach: ${JSON.stringify(tooHigh.slice(0, 5))}`);

    const lowest = Math.min(...heights.map(h => h.gap));
    assert.ok(lowest > 25, `a coin is only ${lowest}px off the deck and will be hidden by the tyres`);
});

test('coins follow the terrain rather than sitting at one height', () => {
    // The failure mode was a whole run pinned to the height of the last segment.
    // Coins on a hill must move with it.
    const { terrain, coins } = buildTrack();

    const sorted = [...coins].sort((a, b) => a.position.x - b.position.x);
    const groundSpread = [];
    for (let i = 1; i < sorted.length; i++) {
        const previous = sorted[i - 1];
        const coin = sorted[i];
        if (coin.position.x - previous.position.x > 200) continue;   // different run

        const drop = Math.abs(surfaceAt(terrain, coin.position.x) - surfaceAt(terrain, previous.position.x));
        if (drop > 30) {
            // Neighbouring coins over sloping ground should have followed it.
            const coinDrop = Math.abs(coin.position.y - previous.position.y);
            groundSpread.push({ x: Math.round(coin.position.x), drop, coinDrop });
        }
    }

    assert.ok(groundSpread.length > 5, 'expected some coin runs over sloping ground');
    for (const sample of groundSpread) {
        assert.ok(
            sample.coinDrop > sample.drop * 0.4,
            `coins ignored a ${sample.drop.toFixed(0)}px slope at x=${sample.x} (moved ${sample.coinDrop.toFixed(0)}px)`
        );
    }
});

test('boost pads sit on the track and follow its slope', () => {
    const { generator, terrain, pads } = buildTrack();
    assert.ok(pads.length > 3, `only ${pads.length} boost pads`);

    for (const pad of pads) {
        const gap = clearance(terrain, pad.position.x, pad.position.y);
        assert.ok(gap > 0 && gap < 40, `boost pad at x=${Math.round(pad.position.x)} floats/sinks (${gap}px)`);

        const slope = generator.groundAngleAt(pad.position.x);
        assert.ok(
            Math.abs(pad.angle - slope) < 0.12,
            `boost pad at x=${Math.round(pad.position.x)} is ${pad.angle.toFixed(2)} rad on ${slope.toFixed(2)} rad ground`
        );
    }
});

test('mud pits lie in the track surface', () => {
    const { terrain, mud } = buildTrack();
    assert.ok(mud.length > 0, 'no mud pits');

    for (const pit of mud) {
        const gap = clearance(terrain, pit.position.x, pit.position.y);
        assert.ok(gap >= 0 && gap < 40, `mud pit at x=${Math.round(pit.position.x)} is ${gap}px off the ground`);
    }
});

test('groundYAt handles the ends of the track without inventing terrain', () => {
    const { generator } = buildTrack();
    const first = generator.surface[0];
    const last = generator.surface[generator.surface.length - 1];

    assert.equal(generator.groundYAt(first.x - 5000), first.y);
    assert.equal(generator.groundYAt(last.x + 5000), last.y);
    assert.ok(Number.isFinite(generator.groundYAt((first.x + last.x) / 2)));
});
