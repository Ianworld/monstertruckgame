/**
 * The tune, as data. No Web Audio here - this is what to play, AudioManager
 * decides how it sounds.
 *
 * Key of A natural minor, i - VI - III - VII (Am - F - C - G). It is the
 * progression behind half the driving music ever written because it pulls
 * forward without ever sounding sad, which is what a monster truck wants.
 *
 * Everything is a 16-step bar (16th notes). The song is 16 bars and arranges
 * itself: it opens sparse, layers up, and hits a chorus, so a two-lap race does
 * not sound like a four-bar loop on repeat.
 */

export const STEPS_PER_BAR = 16;
export const BARS = 16;
export const TOTAL_STEPS = STEPS_PER_BAR * BARS;

/** A natural minor pitch classes: A B C D E F G. */
const SCALE_PITCH_CLASSES = [9, 11, 0, 2, 4, 5, 7];

/** Every in-key note across the usable range, for diatonic transposition. */
export const SCALE_NOTES = [];
for (let note = 21; note <= 108; note++) {
    if (SCALE_PITCH_CLASSES.includes(note % 12)) SCALE_NOTES.push(note);
}

/**
 * Move a note down the scale by whole degrees, so a harmony line stays in key
 * instead of shadowing the melody a fixed number of semitones below it.
 */
export function harmoniseBelow(note, degrees = 2) {
    const index = SCALE_NOTES.indexOf(note);
    if (index === -1) return note - 3;                  // passing tone: minor third
    return SCALE_NOTES[Math.max(0, index - degrees)];
}

/** One chord per bar. Voicings are chosen so the top notes barely move. */
export const PROGRESSION = [
    { name: 'Am', bass: 45, chord: [57, 60, 64] },
    { name: 'F', bass: 41, chord: [53, 57, 60] },
    { name: 'C', bass: 48, chord: [55, 60, 64] },
    { name: 'G', bass: 43, chord: [55, 59, 62] }
];

// --- RHYTHM ---------------------------------------------------------------
// 1 = hit, 0 = rest. Hats use 1 = soft, 2 = accent, 3 = open.

export const KICK_FOUR = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
export const KICK_BUSY = [1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 1, 0];
export const BACKBEAT = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
export const HAT_EIGHTHS = [2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 0];
export const HAT_SIXTEENTHS = [2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 3, 1];

/** Semitone offsets from the bar's bass note. null is a rest. */
export const BASS_LINE = [
    0, null, null, 12,
    0, null, null, 0,
    12, null, null, 7,
    0, null, 12, null
];

/** Indices into the bar's chord, where 3 means "root, an octave up". */
export const ARP_SEQUENCE = [0, 1, 2, 3, 2, 3, 2, 1, 0, 1, 2, 3, 3, 2, 1, 0];

// --- MELODY ---------------------------------------------------------------
// Four bars, one per chord, every note diatonic to A minor. The phrase answers
// itself: bars 1 and 2 are the same shape a step apart, bar 3 lifts to the top
// of the range, bar 4 falls away and leaves a bar's breath before the loop.
export const LEAD = [
    // Am
    76, 0, 0, 76, 79, 0, 81, 0, 0, 81, 0, 79, 76, 0, 0, 0,
    // F
    72, 0, 0, 72, 76, 0, 77, 0, 0, 77, 0, 76, 72, 0, 69, 0,
    // C
    79, 0, 0, 79, 84, 0, 83, 0, 0, 79, 0, 76, 79, 0, 0, 0,
    // G
    74, 0, 0, 74, 79, 0, 77, 0, 0, 74, 0, 71, 0, 0, 0, 0
];

/** Pentatonic ladder for coin pickups, so a run of coins plays a riff. */
export const COIN_LADDER = [84, 86, 88, 91, 93, 96];

/** Chord stabs and a rising lead for the celebration flourish. */
export const FANFARE = [
    { step: 0, chord: [69, 72, 76], lead: 81 },
    { step: 2, chord: [69, 72, 76], lead: 84 },
    { step: 4, chord: [67, 71, 74], lead: 86 },
    { step: 6, chord: [72, 76, 79], lead: 88 }
];

/**
 * What plays in a given bar. This is the arrangement: the reason the track
 * breathes instead of looping flat.
 *
 * Structure is paced for a 30-45 second race, so the hook lands early (bar 4,
 * about eight seconds in) rather than after a long build nobody sticks around
 * for. Bars 8-9 drop the melody so the last chorus has somewhere to go.
 *
 *   0-1   intro     drums, bass, arp
 *   2-3   build     + pad, snare
 *   4-7   chorus    + lead, claps
 *   8-9   breakdown lead out, room to breathe
 *   10-11 build     + fill
 *   12-15 big       lead + harmony, busy kick, 16th hats
 */
export function arrangementForBar(bar) {
    const position = ((bar % BARS) + BARS) % BARS;
    const chorus = (position >= 4 && position <= 7) || position >= 12;
    const breakdown = position === 8 || position === 9;

    return {
        position,
        chorus,
        breakdown,
        kick: position >= 12 ? KICK_BUSY : KICK_FOUR,
        hats: position === 0 ? null : (position >= 12 ? HAT_SIXTEENTHS : HAT_EIGHTHS),
        snare: position >= 2 && !breakdown,
        clap: chorus,
        arp: position >= 1,
        pad: position >= 2,
        lead: chorus,
        harmony: position >= 12,
        // A snare roll into each new section.
        fill: position === 3 || position === 7 || position === 11 || position === 15
    };
}

/** The chord under a given bar. */
export function chordForBar(bar) {
    return PROGRESSION[((bar % PROGRESSION.length) + PROGRESSION.length) % PROGRESSION.length];
}
