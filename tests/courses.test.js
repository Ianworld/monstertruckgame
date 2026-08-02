import test from 'node:test';
import assert from 'node:assert/strict';

import { COURSES } from '../src/game/Courses.js';
import { driveCourse } from './helpers/harness.js';

/**
 * Can each course actually be finished?
 *
 * Level geometry being valid does not mean a course is playable. A bot holding
 * the throttle - the model of a child who has found the go button and intends to
 * keep it pressed - drives every course here from start to finish line.
 *
 * This has already earned its keep twice. It caught whoops whose 230px wavelength
 * was narrower than the 116px wheelbase, so the truck grounded out on the crest
 * between its own wheels; and it caught crate stacks being ploughed into a heap
 * that the truck climbed nose-up and stopped dead against, for the rest of the
 * race. Neither was visible in the geometry.
 */

for (const course of COURSES) {
    test(`${course.name}: a bot on full throttle finishes it`, () => {
        const run = driveCourse(course, { boost: false, maxSeconds: 100 });

        assert.ok(
            run.finished,
            `stopped at ${run.reached} of ${run.finishX} after ${run.seconds}s ` +
            `(worst tilt ${run.worstTiltDeg} degrees)`
        );
    });

    test(`${course.name}: it never gets stuck on the way round`, () => {
        const run = driveCourse(course, { boost: true, maxSeconds: 100 });

        assert.ok(run.finished, `did not finish: reached ${run.reached} of ${run.finishX}`);
        // Any full second spent going nowhere is an obstacle that beat the player.
        assert.equal(run.stalledSeconds, 0, `spent ${run.stalledSeconds}s stalled`);
        assert.equal(run.repairs, 0, 'the safety net had to rescue the truck');
        assert.ok(run.worstTiltDeg < 100, `rolled to ${run.worstTiltDeg} degrees`);
    });

    test(`${course.name}: takes a reasonable time and gives plenty to collect`, () => {
        const run = driveCourse(course, { boost: true, maxSeconds: 100 });

        // Long enough to be a race, short enough to want another go.
        assert.ok(
            run.seconds > 15 && run.seconds < 60,
            `${run.seconds}s is outside the 15-60s a race should take`
        );
        assert.ok(run.coins > 20, `only ${run.coins} coins collected just by driving`);
    });
}

test('the courses feel meaningfully different from each other', () => {
    const runs = COURSES.map(course => ({
        course,
        run: driveCourse(course, { boost: true, maxSeconds: 100 })
    }));

    // Not all the same length.
    const times = runs.map(r => r.run.seconds);
    assert.ok(Math.max(...times) - Math.min(...times) > 3, `all courses take about ${times[0]}s`);

    // Each course uses a different mix of obstacles.
    const signatures = runs.map(({ course }) => {
        const source = course.build.toString();
        return ['mud', 'crates', 'ice', 'tunnel', 'spring', 'whoops']
            .filter(feature => source.includes(`${feature}(`))
            .join(',');
    });
    assert.equal(new Set(signatures).size, signatures.length, `courses share an obstacle mix: ${signatures}`);
});
