import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioManager, BPM_RANGE, SCHEDULER_TICK_MS, TEMPO_GLIDE_MS } from '../src/game/AudioManager.js';
import {
    ARP_SEQUENCE,
    BACKBEAT,
    BARS,
    BASS_LINE,
    COIN_LADDER,
    HAT_EIGHTHS,
    HAT_SIXTEENTHS,
    KICK_BUSY,
    KICK_FOUR,
    LEAD,
    PROGRESSION,
    SCALE_NOTES,
    STEPS_PER_BAR,
    TOTAL_STEPS,
    arrangementForBar,
    chordForBar,
    harmoniseBelow
} from '../src/game/MusicScore.js';

/**
 * The score is hand-entered note data, which is exactly the sort of thing that
 * picks up a typo nobody notices until a wrong note is playing on loop under a
 * child's game. These tests check it is well formed and in key.
 *
 * The MIX is verified separately by rendering AudioManager through an
 * OfflineAudioContext in the browser and measuring peak, RMS, spectral balance
 * and stereo width - none of which Node can do.
 */

const inKey = (note) => SCALE_NOTES.includes(note);

test('every rhythm pattern is exactly one bar', () => {
    const patterns = { KICK_FOUR, KICK_BUSY, BACKBEAT, HAT_EIGHTHS, HAT_SIXTEENTHS, BASS_LINE, ARP_SEQUENCE };

    for (const [name, pattern] of Object.entries(patterns)) {
        assert.equal(pattern.length, STEPS_PER_BAR, `${name} is ${pattern.length} steps, not ${STEPS_PER_BAR}`);
    }
});

test('the drums land where a listener expects them', () => {
    // Four on the floor, and the backbeat on 2 and 4.
    assert.deepEqual([0, 4, 8, 12].map(i => KICK_FOUR[i]), [1, 1, 1, 1]);
    assert.deepEqual([4, 12].map(i => BACKBEAT[i]), [1, 1]);
    assert.equal(BACKBEAT.filter(Boolean).length, 2, 'the backbeat should be exactly two hits');

    // Hats accent the downbeats.
    for (const beat of [0, 4, 8, 12]) {
        assert.equal(HAT_EIGHTHS[beat], 2, `hat on beat ${beat} should be accented`);
        assert.equal(HAT_SIXTEENTHS[beat], 2, `16th hat on beat ${beat} should be accented`);
    }
});

test('the melody is four bars and entirely in key', () => {
    assert.equal(LEAD.length, STEPS_PER_BAR * 4, 'the lead should cover the four-chord progression');

    const notes = LEAD.filter(Boolean);
    assert.ok(notes.length > 25, `only ${notes.length} melody notes - the hook is too sparse`);

    for (const note of notes) {
        assert.ok(inKey(note), `melody note ${note} is not in A natural minor`);
        assert.ok(note >= 60 && note <= 96, `melody note ${note} is outside a singable range`);
    }

    // Each bar should have somewhere to breathe, or it reads as a machine gun.
    for (let bar = 0; bar < 4; bar++) {
        const slice = LEAD.slice(bar * STEPS_PER_BAR, (bar + 1) * STEPS_PER_BAR);
        const rests = slice.filter(n => n === 0).length;
        assert.ok(rests >= 6, `bar ${bar} of the melody only rests ${rests} of 16 steps`);
    }
});

test('the melody moves in steps rather than leaping about', () => {
    const notes = LEAD.filter(Boolean);
    let leaps = 0;

    for (let i = 1; i < notes.length; i++) {
        const interval = Math.abs(notes[i] - notes[i - 1]);
        assert.ok(interval <= 12, `a ${interval}-semitone jump is not a melody, it is an alarm`);
        if (interval > 4) leaps++;
    }

    assert.ok(leaps < notes.length * 0.5, 'more than half the melody is leaps');
});

test('the progression is four voice-led chords', () => {
    assert.equal(PROGRESSION.length, 4);

    for (const chord of PROGRESSION) {
        assert.equal(chord.chord.length, 3, `${chord.name} should be a triad`);
        assert.ok(chord.bass < chord.chord[0], `${chord.name} bass is not below its voicing`);
        assert.ok(chord.bass >= 36 && chord.bass <= 52, `${chord.name} bass note ${chord.bass} is out of range`);
        for (const note of chord.chord) {
            assert.ok(inKey(note), `${chord.name} contains ${note}, which is out of key`);
        }
    }

    // Voice leading: the top of each chord should barely move.
    for (let i = 1; i < PROGRESSION.length; i++) {
        const move = Math.abs(PROGRESSION[i].chord[2] - PROGRESSION[i - 1].chord[2]);
        assert.ok(move <= 4, `voicing jumps ${move} semitones between chords ${i - 1} and ${i}`);
    }
});

test('the arp only ever asks for notes the chord has', () => {
    assert.ok(ARP_SEQUENCE.every(index => index >= 0 && index <= 3), 'arp index out of range');
    // 3 is "root, an octave up", so a triad plus one is all the voices needed.
    assert.ok(ARP_SEQUENCE.includes(0) && ARP_SEQUENCE.includes(3), 'arp should span the full voicing');
});

test('the bass line locks to the kick and stays near its root', () => {
    assert.ok(BASS_LINE[0] === 0, 'the bar should start on the root');

    for (const offset of BASS_LINE) {
        if (offset === null) continue;
        assert.ok([0, 7, 12].includes(offset), `bass offset ${offset} is not a root, fifth or octave`);
    }

    // It has to hit the downbeats, where the kick is.
    for (const beat of [0, 4, 12]) {
        assert.notEqual(BASS_LINE[beat], null, `no bass on beat ${beat}, where the kick lands`);
    }
});

test('the arrangement builds, breaks down and pays off', () => {
    const bars = Array.from({ length: BARS }, (_, bar) => arrangementForBar(bar));

    assert.equal(bars[0].hats, null, 'bar 0 should be sparse');
    assert.equal(bars[0].lead, false, 'the melody should not open the track');

    const leadBars = bars.filter(b => b.lead).length;
    assert.ok(leadBars >= 6 && leadBars <= 10, `the hook plays in ${leadBars} of 16 bars`);

    // The hook has to arrive early - a 30 second race cannot wait 15 seconds.
    const firstLead = bars.findIndex(b => b.lead);
    assert.ok(firstLead > 0 && firstLead <= 4, `the melody first appears in bar ${firstLead}`);

    // Something has to drop out, or the payoff has nowhere to go.
    assert.ok(bars.some(b => b.breakdown), 'no breakdown in the arrangement');
    assert.ok(bars[15].harmony, 'the last bars should be the biggest');
    assert.equal(bars[15].kick, KICK_BUSY, 'the final section should use the busy kick');

    // Every bar has drums; silence mid-race would read as a bug.
    for (const bar of bars) assert.ok(bar.kick && bar.kick.length === STEPS_PER_BAR);
});

test('the song loops without a seam', () => {
    assert.equal(TOTAL_STEPS, STEPS_PER_BAR * BARS);
    assert.deepEqual(arrangementForBar(0), arrangementForBar(BARS));
    assert.deepEqual(chordForBar(0), chordForBar(PROGRESSION.length));
    assert.deepEqual(chordForBar(BARS - 1), PROGRESSION[(BARS - 1) % PROGRESSION.length]);
});

test('harmony lines stay in key and below the melody', () => {
    for (const note of LEAD.filter(Boolean)) {
        const harmony = harmoniseBelow(note);
        assert.ok(harmony < note, `harmony ${harmony} is not below melody note ${note}`);
        assert.ok(inKey(harmony), `harmony note ${harmony} is out of key`);
        // A third or so below - close enough to sound like one part, not two tunes.
        assert.ok(note - harmony <= 5, `harmony sits ${note - harmony} semitones down`);
    }
});

// --------------------------------------------------------------- tempo glide
// AudioManager needs a browser for sound, but its tempo logic is pure state and
// runs fine here. These exist because tempo used to follow speed instantly, and
// anything downstream of tempo that moves - notably the delay line - turns that
// into audible pitch artefacts.

const tick = (audio, ms = SCHEDULER_TICK_MS) => audio.advanceTempo(ms);
const settle = (audio, ms) => {
    for (let elapsed = 0; elapsed < ms; elapsed += SCHEDULER_TICK_MS) tick(audio);
};

test('speed sets a tempo target rather than the tempo itself', () => {
    const audio = new AudioManager();
    const resting = audio.currentBpm;

    audio.updateSpeed(70);
    assert.equal(audio.currentBpm, resting, 'updateSpeed moved the tempo directly');
    assert.ok(audio.targetIntensity > 0.9, 'target did not follow the speed');
});

test('tempo glides to the target instead of snapping', () => {
    const audio = new AudioManager();
    audio.updateSpeed(70);

    const afterOneTick = tick(audio);
    assert.ok(
        afterOneTick - audio.baseBpm < BPM_RANGE * 0.1,
        `tempo jumped ${(afterOneTick - audio.baseBpm).toFixed(1)}bpm in a single 25ms tick`
    );

    settle(audio, TEMPO_GLIDE_MS * 5);
    assert.ok(
        Math.abs(audio.currentBpm - (audio.baseBpm + BPM_RANGE)) < 1,
        `tempo settled at ${audio.currentBpm.toFixed(1)}, not the full ${audio.baseBpm + BPM_RANGE}`
    );
});

test('a one-frame speed spike barely moves the tempo', () => {
    // Landing a jump or clipping a boost pad spikes the speedometer for a few
    // frames. The drummer should not notice.
    const audio = new AudioManager();
    audio.updateSpeed(30);
    settle(audio, 4000);
    const cruising = audio.currentBpm;

    audio.updateSpeed(85);
    tick(audio);
    audio.updateSpeed(30);
    settle(audio, 200);

    assert.ok(
        Math.abs(audio.currentBpm - cruising) < 1.5,
        `a momentary spike shifted the tempo by ${Math.abs(audio.currentBpm - cruising).toFixed(2)}bpm`
    );
});

test('tempo stays inside its designed range whatever the speed', () => {
    const audio = new AudioManager();

    for (const speed of [-50, 0, 8, 45, 200, 100000]) {
        audio.updateSpeed(speed);
        settle(audio, TEMPO_GLIDE_MS * 6);
        assert.ok(Number.isFinite(audio.currentBpm), `speed ${speed} produced ${audio.currentBpm}`);
        assert.ok(
            audio.currentBpm >= audio.baseBpm - 0.001 && audio.currentBpm <= audio.baseBpm + BPM_RANGE + 0.001,
            `speed ${speed} drove the tempo to ${audio.currentBpm.toFixed(1)}bpm`
        );
    }
});

test('slowing down glides too, and lands back at rest', () => {
    const audio = new AudioManager();
    audio.updateSpeed(80);
    settle(audio, TEMPO_GLIDE_MS * 6);

    audio.updateSpeed(0);
    const firstTick = tick(audio);
    assert.ok(firstTick > audio.baseBpm + BPM_RANGE * 0.9, 'tempo dropped off a cliff when the throttle closed');

    settle(audio, TEMPO_GLIDE_MS * 6);
    assert.ok(Math.abs(audio.currentBpm - audio.baseBpm) < 1, 'tempo never came back down');
});

test('the coin ladder rises and stays in key', () => {
    for (let i = 1; i < COIN_LADDER.length; i++) {
        assert.ok(COIN_LADDER[i] > COIN_LADDER[i - 1], 'the coin ladder should climb');
    }
    for (const note of COIN_LADDER) {
        assert.ok(inKey(note), `coin note ${note} clashes with the music`);
    }
});
