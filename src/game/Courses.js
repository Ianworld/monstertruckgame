/**
 * The courses.
 *
 * Design rules, in order of importance:
 *
 *   1. Never trap a player. There are no holes, no walls to nose into and no
 *      obstacle that can stop a truck dead. Dips have floors and tunnels are tall
 *      enough to drive flat out.
 *   2. Keep it flowing. Long readable sections, generous landings, and nothing
 *      that needs a run-up to be repeated.
 *   3. Then add a challenge or two - a real jump, a slick corner, a mud drag -
 *      but always with a way through for someone who just holds the throttle.
 *
 * Each course is written against the cursor API in LevelGenerator, so it reads
 * roughly as the ride feels. Terrain calls extend the track; obstacle calls
 * decorate the section just built, positioned by fraction along it.
 */

export const COURSES = [
    {
        id: 'speedway',
        name: 'Sunshine Speedway',
        blurb: 'Wide open, rolling and full of coins',
        difficulty: 1,
        palette: { hue: 95, step: 5 },
        build(track) {
            // Gentle rollers to settle into, paved with coins.
            track.hill(1500, 130).coins();
            track.hill(1500, 150).coins();

            // First real lift, with a boost to make it easy.
            track.slope(900, -180).boost(0.6);
            track.hill(1600, 200).coins(110);

            // A long friendly jump: ramp up, scoop out, land on the far side.
            track.ramp(800, 240).boost(0.55);
            track.dip(1300, 200).coins(130);

            track.whoops(5, 20).coins(85);

            // Big finish: launch, fly, land soft.
            track.slope(1000, 160);
            track.ramp(900, 300).boost(0.6);
            track.dip(1600, 260).coins(150);

            track.hill(1400, 140).coins();

            // Last third: a rolling run home with one more launch.
            track.whoops(4, 22).coins(85);
            track.slope(1100, -150).boost(0.5);
            track.dip(1500, 230).coins(140);
            track.hill(1600, 170).coins(100);
            track.slope(1200, 120);
        }
    },
    {
        id: 'mudbog',
        name: 'Mud Bog',
        blurb: 'Sloppy going, smashable crates, keep your boot in',
        difficulty: 2,
        palette: { hue: 25, step: 4 },
        build(track) {
            track.flat(900).crates(4, 2, 0.6);
            track.hill(1300, 140).coins();

            // First bog. Boost sits before it so there is always a way through.
            track.flat(500).boost(0.4);
            track.flat(1500).mud();
            track.coins(85);

            track.whoops(6, 26).coins(95);

            // Crate alley on the climb.
            track.slope(1100, -160).crates(3, 3, 0.35).crates(4, 2, 0.75);

            track.dip(1200, 190).coins(120);

            // The long drag: two bogs back to back with a breather between.
            track.flat(1400).mud(0.05, 0.95);
            track.flat(700).boost(0.5).crates(5, 2, 0.8);
            track.flat(1300).mud(0.05, 0.95);

            track.hill(1500, 210).coins(110);
            track.whoops(4, 30);
            track.slope(1100, 140).crates(4, 3, 0.5);
            track.flat(900).coins(85);
        }
    },
    {
        id: 'glacier',
        name: 'Glacier Run',
        blurb: 'Slippery ice, big air and a couple of caves',
        difficulty: 2,
        palette: { hue: 190, step: 3 },
        build(track) {
            track.hill(1400, 150).coins();

            // First taste of ice on the flat, where sliding is only funny.
            track.ice(1200).coins(85);

            track.slope(900, -200).boost(0.6);
            track.dip(1400, 230).coins(130);

            // Ice cave: low roof, so no jumping your way out of the slide.
            track.tunnel(1300).coins(80);

            // Trampoline into a long descent.
            track.flat(600).spring(0.5);
            track.slope(1500, 220).coins(140);

            track.ice(1400, -80).coins(90);
            track.whoops(4, 22);

            // The one properly big jump on the course, well signposted.
            track.ramp(1000, 320).boost(0.55);
            track.dip(1800, 300).coins(160);

            track.tunnel(1000, 250);
            track.ice(1000, 60);
            track.hill(1300, 160).coins();

            // Run for home: a bobsleigh drop, one last cave, and a springboard
            // over the line.
            track.whoops(4, 20).coins(85);
            track.ice(1300, -60).coins(95);
            track.slope(1200, 200).boost(0.4);
            track.dip(1500, 210).coins(135);
            track.tunnel(900, 250);
            track.flat(800).spring(0.5);
        }
    },
    {
        id: 'scrapyard',
        name: 'Scrapyard Smash',
        blurb: 'Crates everywhere, tight tunnels, springboards',
        difficulty: 3,
        palette: { hue: 285, step: 7 },
        build(track) {
            track.flat(800).crates(5, 3, 0.6);
            track.whoops(4, 24).coins(90);

            track.flat(700).crates(4, 4, 0.5);
            track.slope(1000, -170).boost(0.5);

            // Springboard straight out of a tunnel mouth.
            track.tunnel(1100, 240).coins(80);
            track.flat(700).spring(0.45).crates(3, 2, 0.85);

            track.dip(1300, 210).coins(125);
            track.flat(900).crates(6, 2, 0.5);

            track.whoops(6, 28).coins(100);

            // Double springboard over a scoop.
            track.flat(600).spring(0.5);
            track.dip(1400, 240).coins(150);
            track.flat(600).spring(0.5);

            track.tunnel(900, 240);
            track.slope(1000, -140).boost(0.5).crates(4, 3, 0.8);
            track.dip(1200, 180).coins(120);
            track.hill(1200, 150).coins();
            track.flat(900).crates(5, 3, 0.5);
        }
    }
];

export const DEFAULT_COURSE_ID = COURSES[0].id;

export function getCourse(id) {
    return COURSES.find(course => course.id === id) || COURSES[0];
}
