import {
    ARP_SEQUENCE,
    BACKBEAT,
    BASS_LINE,
    COIN_LADDER,
    FANFARE,
    LEAD,
    STEPS_PER_BAR,
    TOTAL_STEPS,
    arrangementForBar,
    chordForBar,
    harmoniseBelow
} from './MusicScore.js';

/** How often the lookahead scheduler wakes up, in ms. */
export const SCHEDULER_TICK_MS = 25;

/**
 * Time constant for tempo changes. Long on purpose: the truck's speed jumps
 * around on every bump, and a tempo that chased it would sound like a drummer
 * losing their place. About a second to settle reads as the track responding.
 */
export const TEMPO_GLIDE_MS = 900;

/** Slowest to fastest, in BPM added on top of baseBpm. */
export const BPM_RANGE = 26;

/**
 * The soundtrack: a small synth-and-mixer rig rather than a row of bare
 * oscillators.
 *
 * What makes this sound produced rather than chiptune is the signal path, not
 * the notes:
 *
 *   - every voice is LAYERED (the kick is a pitched body plus a click, the snare
 *     is noise plus two tuned tones, the lead is three detuned saws)
 *   - everything runs through shared reverb and a tempo-synced ping-pong delay,
 *     so the parts sit in one space instead of side by side
 *   - the bass, pad and arp are SIDECHAINED to the kick, which is the pumping
 *     that makes a four-on-the-floor track breathe
 *   - a glue compressor and a limiter hold the mix together
 *
 * The arrangement in MusicScore.js layers up over 16 bars, and the truck's speed
 * drives tempo, filter brightness and how many parts are playing - so the music
 * responds to the race instead of looping underneath it.
 */
export class AudioManager {
    constructor() {
        this.audioCtx = null;
        this.isPlaying = false;

        this.speed = 0;
        this.intensity = 0;          // 0..1, how hard the player is driving
        this.targetIntensity = 0;    // where the driving says it should be
        this.baseBpm = 100;
        this.currentBpm = 100;

        this.nextNoteTime = 0;
        this.currentStep = 0;
        this.timerId = null;

        this.coinStreak = 0;
        this.lastCoinTime = -10;
        this.lastFanfareTime = -10;

        // Auto-ranging bounds for getPulse().
        this.pulseMin = 1;
        this.pulseMax = 0;
    }

    // ------------------------------------------------------------ mixer setup

    /**
     * @param {BaseAudioContext} [context] inject an OfflineAudioContext to render
     *   and measure the mix without a speaker - that is how the levels below were
     *   checked rather than guessed at.
     */
    init(context) {
        if (this.audioCtx) return;

        const Ctx = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = context || new Ctx();
        const ctx = this.audioCtx;

        // Master: rumble filter, air, glue compression, then a limiter.
        this.masterGain = ctx.createGain();
        this.masterGain.gain.value = 0.72;   // headroom so the limiter is a safety net, not the sound

        // Below ~32Hz there is nothing to hear, only headroom to lose.
        this.rumbleFilter = ctx.createBiquadFilter();
        this.rumbleFilter.type = 'highpass';
        this.rumbleFilter.frequency.value = 32;

        // A little air on top. Without it a synth mix reads as dull rather than
        // produced - the measured balance here was 2% above 3kHz before this.
        this.airShelf = ctx.createBiquadFilter();
        this.airShelf.type = 'highshelf';
        this.airShelf.frequency.value = 5500;
        this.airShelf.gain.value = 3;

        this.glue = ctx.createDynamicsCompressor();
        this.glue.threshold.value = -15;
        this.glue.knee.value = 12;
        this.glue.ratio.value = 3.5;
        this.glue.attack.value = 0.004;
        this.glue.release.value = 0.18;

        this.limiter = ctx.createDynamicsCompressor();
        this.limiter.threshold.value = -1.5;
        this.limiter.knee.value = 0;
        this.limiter.ratio.value = 20;
        this.limiter.attack.value = 0.001;
        this.limiter.release.value = 0.05;

        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 128;
        this.analyser.smoothingTimeConstant = 0.45;   // snappy enough to show the kick
        this.pulseData = new Uint8Array(this.analyser.frequencyBinCount);

        this.masterGain.connect(this.rumbleFilter);
        this.rumbleFilter.connect(this.airShelf);
        this.airShelf.connect(this.glue);
        this.glue.connect(this.limiter);
        this.limiter.connect(this.analyser);
        this.analyser.connect(ctx.destination);

        // Sends.
        this.reverbReturn = ctx.createGain();
        this.reverbReturn.gain.value = 0.9;
        this.reverb = ctx.createConvolver();
        this.reverb.buffer = this.createReverbImpulse(2.4, 3.2);
        this.reverbSend = ctx.createGain();
        this.reverbSend.gain.value = 1;
        const preDelay = ctx.createDelay(0.2);
        preDelay.delayTime.value = 0.018;      // a touch of air before the tail
        this.reverbSend.connect(preDelay);
        preDelay.connect(this.reverb);
        this.reverb.connect(this.reverbReturn);
        this.reverbReturn.connect(this.masterGain);

        this.delaySend = ctx.createGain();
        this.delaySend.gain.value = 1;
        this.buildPingPongDelay();

        // Buses. Drums get saturation for punch; the melodic parts get ducked.
        this.drumBus = ctx.createGain();
        this.drumBus.gain.value = 0.95;
        const drumSaturator = ctx.createWaveShaper();
        drumSaturator.curve = this.createSaturationCurve(0.35);
        drumSaturator.oversample = '2x';
        this.drumBus.connect(drumSaturator);
        drumSaturator.connect(this.masterGain);

        // Sidechain target: pumped down on every kick.
        this.duckBus = ctx.createGain();
        this.duckBus.gain.value = 1;
        this.duckBus.connect(this.masterGain);

        this.bassBus = ctx.createGain();
        this.bassBus.gain.value = 0.9;
        this.bassBus.connect(this.duckBus);

        this.padBus = ctx.createGain();
        this.padBus.gain.value = 0.2;
        this.padBus.connect(this.duckBus);

        this.arpBus = ctx.createGain();
        this.arpBus.gain.value = 0.42;
        this.arpBus.connect(this.duckBus);

        // The lead stays out of the sidechain so the melody never wobbles.
        this.leadBus = ctx.createGain();
        this.leadBus.gain.value = 0.5;
        this.leadBus.connect(this.masterGain);

        this.sfxBus = ctx.createGain();
        this.sfxBus.gain.value = 0.7;
        this.sfxBus.connect(this.masterGain);

        // One noise buffer, reused. Building a fresh one per hi-hat is the kind of
        // thing that quietly turns into a garbage collection stutter.
        this.noiseBuffer = this.createNoiseBuffer(2);
    }

    buildPingPongDelay() {
        const ctx = this.audioCtx;

        this.delayL = ctx.createDelay(1.5);
        this.delayR = ctx.createDelay(1.5);
        const feedbackL = ctx.createGain();
        const feedbackR = ctx.createGain();
        feedbackL.gain.value = 0.34;
        feedbackR.gain.value = 0.34;

        // Tame the repeats so they sit behind the dry signal.
        const damping = ctx.createBiquadFilter();
        damping.type = 'lowpass';
        damping.frequency.value = 2600;

        const panL = ctx.createStereoPanner();
        const panR = ctx.createStereoPanner();
        panL.pan.value = -0.75;
        panR.pan.value = 0.75;

        this.delaySend.connect(this.delayL);
        this.delayL.connect(feedbackL);
        feedbackL.connect(damping);
        damping.connect(this.delayR);
        this.delayR.connect(feedbackR);
        feedbackR.connect(this.delayL);

        this.delayL.connect(panL);
        this.delayR.connect(panR);

        this.delayReturn = ctx.createGain();
        this.delayReturn.gain.value = 0.45;
        panL.connect(this.delayReturn);
        panR.connect(this.delayReturn);
        this.delayReturn.connect(this.masterGain);

        // Dotted-eighth repeats, set ONCE and never touched again.
        //
        // This used to follow the tempo. Do not make it do that again: changing a
        // delay line's length re-reads its buffer at a different rate, which
        // pitch-shifts whatever is already inside it. With the tempo tracking road
        // speed, the delay was being retuned every 25ms, and since the arp and lead
        // are what feed it, the melody warbled continuously. Ramping the change
        // does not help - a slower slide is a slower warble.
        //
        // Fixed at the base tempo, the repeats drift a few percent off the grid at
        // the top of the tempo range. That is inaudible; the warble was not.
        const beat = 60 / this.baseBpm;
        this.delayL.delayTime.value = beat * 0.75;
        this.delayR.delayTime.value = beat * 0.375;
    }

    createReverbImpulse(seconds, decay) {
        const ctx = this.audioCtx;
        const length = Math.floor(ctx.sampleRate * seconds);
        const impulse = ctx.createBuffer(2, length, ctx.sampleRate);

        for (let channel = 0; channel < 2; channel++) {
            const data = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                const fade = Math.pow(1 - i / length, decay);
                data[i] = (Math.random() * 2 - 1) * fade;
            }
        }
        return impulse;
    }

    createNoiseBuffer(seconds) {
        const ctx = this.audioCtx;
        const length = Math.floor(ctx.sampleRate * seconds);
        const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        return buffer;
    }

    createSaturationCurve(amount) {
        const samples = 1024;
        const curve = new Float32Array(samples);
        const drive = 1 + amount * 5;
        for (let i = 0; i < samples; i++) {
            const x = (i / (samples - 1)) * 2 - 1;
            curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
        }
        return curve;
    }

    // ------------------------------------------------------------- transport

    start() {
        this.init();
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

        if (!this.isPlaying) {
            this.isPlaying = true;
            this.nextNoteTime = this.audioCtx.currentTime + 0.08;
            this.scheduler();
        }
    }

    stop() {
        this.isPlaying = false;
        if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
    }

    /**
     * Called every frame with the truck's speed. Sets a TARGET only - the tempo
     * eases towards it in advanceTempo() rather than snapping to whatever the
     * speedometer said this frame, which would make the groove rush and drag with
     * every bump.
     */
    updateSpeed(speed) {
        this.speed = speed;
        // Idling is calm; the track is at full tilt by cruising speed.
        this.targetIntensity = Math.max(0, Math.min(1, (speed - 8) / 50));
    }

    /**
     * Ease the tempo towards the target. Pure state, no audio nodes, so the glide
     * can be tested without a sound card.
     * @param {number} dt milliseconds since the last call
     */
    advanceTempo(dt) {
        const ease = 1 - Math.exp(-dt / TEMPO_GLIDE_MS);
        this.intensity += (this.targetIntensity - this.intensity) * ease;
        this.currentBpm = this.baseBpm + this.intensity * BPM_RANGE;
        return this.currentBpm;
    }

    /**
     * Low-end energy, 0..1, for the background to pump along to.
     *
     * Auto-ranged against the recent minimum and maximum. A compressed mix sits
     * near the top of the absolute scale all the time - measured raw, this only
     * moved between 0.75 and 0.89, so the visuals barely twitched. What the
     * screen should follow is the kick hitting, not how loud the track is.
     */
    getPulse() {
        if (!this.analyser || !this.isPlaying) return 0;
        this.analyser.getByteFrequencyData(this.pulseData);

        let sum = 0;
        const bins = 5;
        for (let i = 0; i < bins; i++) sum += this.pulseData[i];
        const raw = (sum / bins) / 255;

        // The bounds creep back towards each other so the range keeps adapting.
        this.pulseMin = Math.min(raw, this.pulseMin + 0.0015);
        this.pulseMax = Math.max(raw, this.pulseMax - 0.0015);

        const span = Math.max(0.06, this.pulseMax - this.pulseMin);
        return Math.max(0, Math.min(1, (raw - this.pulseMin) / span));
    }

    scheduler() {
        if (!this.isPlaying) return;

        this.advanceTempo(SCHEDULER_TICK_MS);

        const stepDuration = (60 / this.currentBpm) / 4;
        while (this.nextNoteTime < this.audioCtx.currentTime + 0.12) {
            this.scheduleStep(this.currentStep, this.nextNoteTime, stepDuration);
            this.nextNoteTime += stepDuration;
            this.currentStep = (this.currentStep + 1) % TOTAL_STEPS;
        }

        this.timerId = setTimeout(() => this.scheduler(), SCHEDULER_TICK_MS);
    }

    // ----------------------------------------------------------- arrangement

    scheduleStep(step, time, stepDuration) {
        const bar = Math.floor(step / STEPS_PER_BAR);
        const beat = step % STEPS_PER_BAR;
        const plan = arrangementForBar(bar);
        const chord = chordForBar(bar);
        const intensity = this.intensity;

        // --- DRUMS ---
        if (plan.kick[beat]) {
            this.playKick(time, beat === 0 ? 1 : 0.9);
            this.duck(time);
        }

        if (plan.snare && BACKBEAT[beat]) {
            this.playSnare(time);
            if (plan.clap) this.playClap(time);
        }

        if (plan.hats && intensity > 0.12) {
            const hat = plan.hats[beat];
            if (hat) this.playHat(time, hat === 3, hat === 2 ? 0.42 : 0.24);
        }

        // Snare roll into the next section, rising in level and brightness.
        if (plan.fill && beat >= 13 && intensity > 0.3) {
            this.playSnare(time, 0.35 + (beat - 13) * 0.18, 900 + (beat - 13) * 320);
        }

        // --- BASS ---
        const bassOffset = BASS_LINE[beat];
        if (bassOffset !== null && bassOffset !== undefined) {
            // Short enough that consecutive notes do not overlap into a drone.
            this.playBass(chord.bass + bassOffset, time, stepDuration * 1.15, intensity);
        }

        // --- PAD ---
        if (plan.pad && beat === 0) {
            this.playPad(chord.chord, time, stepDuration * STEPS_PER_BAR * 0.95);
        }

        // --- ARP --- alternating sides, which is most of the mix's width
        if (plan.arp && intensity > 0.2) {
            const voices = [...chord.chord, chord.chord[0] + 12];
            const note = voices[ARP_SEQUENCE[beat]];
            this.playArp(note + 12, time, stepDuration * 1.2, beat % 2 ? -0.55 : 0.55);
        }

        // --- LEAD ---
        if (plan.lead && intensity > 0.25) {
            const note = LEAD[(bar % 4) * STEPS_PER_BAR + beat];
            if (note) {
                this.playLead(note, time, stepDuration * 2.4, 0.5);
                if (plan.harmony) {
                    this.playLead(harmoniseBelow(note), time, stepDuration * 2.4, 0.24);
                }
            }
        }
    }

    /** Sidechain: dip the melodic buses on every kick so the track pumps. */
    duck(time) {
        const gain = this.duckBus.gain;
        gain.cancelScheduledValues(time);
        gain.setValueAtTime(1, time);
        gain.linearRampToValueAtTime(0.45, time + 0.025);
        gain.linearRampToValueAtTime(1, time + 0.19);
    }

    // ---------------------------------------------------------------- voices

    noiseSource(time, duration) {
        const source = this.audioCtx.createBufferSource();
        source.buffer = this.noiseBuffer;
        source.start(time, Math.random() * 1.5);
        source.stop(time + duration);
        return source;
    }

    /** Pitched body plus a click transient - the click is what you hear as punch. */
    playKick(time, gain = 1) {
        const ctx = this.audioCtx;

        const body = ctx.createOscillator();
        body.type = 'sine';
        body.frequency.setValueAtTime(165, time);
        body.frequency.exponentialRampToValueAtTime(45, time + 0.06);

        // Short tail on purpose: a long low decay stacks up at four kicks a bar
        // and turns the whole mix to mud.
        const bodyGain = ctx.createGain();
        bodyGain.gain.setValueAtTime(0.0001, time);
        bodyGain.gain.exponentialRampToValueAtTime(gain, time + 0.005);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);

        body.connect(bodyGain);
        bodyGain.connect(this.drumBus);
        body.start(time);
        body.stop(time + 0.24);

        const click = this.noiseSource(time, 0.02);
        const clickFilter = ctx.createBiquadFilter();
        clickFilter.type = 'highpass';
        clickFilter.frequency.value = 1800;
        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(0.4 * gain, time);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.018);

        click.connect(clickFilter);
        clickFilter.connect(clickGain);
        clickGain.connect(this.drumBus);
    }

    /** Noise snap over two tuned tones, which is what stops it sounding like static. */
    playSnare(time, gain = 0.72, tone = 1600) {
        const ctx = this.audioCtx;

        const noise = this.noiseSource(time, 0.22);
        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = 'highpass';
        noiseFilter.frequency.value = tone;
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(gain, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.19);

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.drumBus);
        noiseGain.connect(this.reverbSend);

        for (const frequency of [185, 331]) {
            const osc = ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.value = frequency;
            const oscGain = ctx.createGain();
            oscGain.gain.setValueAtTime(gain * 0.45, time);
            oscGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.11);
            osc.connect(oscGain);
            oscGain.connect(this.drumBus);
            osc.start(time);
            osc.stop(time + 0.12);
        }
    }

    /** Four staggered bursts. A single burst reads as a snare; several read as hands. */
    playClap(time) {
        const ctx = this.audioCtx;

        [0, 0.011, 0.021, 0.031].forEach((offset, index) => {
            const last = index === 3;
            const at = time + offset;
            const burst = this.noiseSource(at, last ? 0.18 : 0.03);

            const filter = ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 1650;
            filter.Q.value = 1.1;

            const gain = ctx.createGain();
            gain.gain.setValueAtTime(last ? 0.3 : 0.22, at);
            gain.gain.exponentialRampToValueAtTime(0.0001, at + (last ? 0.16 : 0.028));

            burst.connect(filter);
            filter.connect(gain);
            gain.connect(this.drumBus);
            if (last) gain.connect(this.reverbSend);
        });
    }

    playHat(time, open, gain) {
        const ctx = this.audioCtx;
        const duration = open ? 0.26 : 0.045;

        const noise = this.noiseSource(time, duration + 0.02);
        const highpass = ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 7200;
        const peak = ctx.createBiquadFilter();
        peak.type = 'bandpass';
        peak.frequency.value = 10500;
        peak.Q.value = 0.8;

        const level = ctx.createGain();
        level.gain.setValueAtTime(gain, time);
        level.gain.exponentialRampToValueAtTime(0.0001, time + duration);

        const pan = ctx.createStereoPanner();
        pan.pan.value = -0.25;

        noise.connect(highpass);
        highpass.connect(peak);
        peak.connect(level);
        level.connect(pan);
        pan.connect(this.drumBus);
    }

    /** Detuned saws over a sub sine, with a filter envelope. */
    playBass(midi, time, duration, intensity) {
        const ctx = this.audioCtx;
        const frequency = this.midiToFrequency(midi);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 5;
        const peakCutoff = 900 + intensity * 1600;
        filter.frequency.setValueAtTime(peakCutoff, time);
        filter.frequency.exponentialRampToValueAtTime(320, time + duration * 0.8);

        const shaper = ctx.createWaveShaper();
        shaper.curve = this.createSaturationCurve(0.25);

        const level = ctx.createGain();
        level.gain.setValueAtTime(0.0001, time);
        level.gain.exponentialRampToValueAtTime(0.42, time + 0.008);
        level.gain.exponentialRampToValueAtTime(0.0001, time + duration);

        filter.connect(shaper);
        shaper.connect(level);
        level.connect(this.bassBus);

        for (const detune of [-7, 7]) {
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.value = frequency;
            osc.detune.value = detune;
            osc.connect(filter);
            osc.start(time);
            osc.stop(time + duration + 0.02);
        }

        // Sub octave for weight, kept quiet - it is felt more than heard, and at
        // full level it swamps everything above it.
        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.value = frequency / 2;
        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(0.0001, time);
        subGain.gain.exponentialRampToValueAtTime(0.18, time + 0.01);
        subGain.gain.exponentialRampToValueAtTime(0.0001, time + duration * 0.8);
        sub.connect(subGain);
        subGain.connect(this.bassBus);
        sub.start(time);
        sub.stop(time + duration + 0.02);
    }

    /** Wide, soft chord bed. Slow attack so it never competes with the kick. */
    playPad(notes, time, duration) {
        const ctx = this.audioCtx;

        notes.forEach((note, index) => {
            const spread = notes.length > 1 ? (index / (notes.length - 1)) * 2 - 1 : 0;

            for (const detune of [-6, 6]) {
                const osc = ctx.createOscillator();
                osc.type = 'sawtooth';
                osc.frequency.value = this.midiToFrequency(note);
                osc.detune.value = detune;

                const filter = ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.value = 1100 + this.intensity * 900;
                filter.Q.value = 0.7;

                const level = ctx.createGain();
                level.gain.setValueAtTime(0.0001, time);
                level.gain.linearRampToValueAtTime(0.14, time + 0.35);
                level.gain.setValueAtTime(0.14, time + duration * 0.7);
                level.gain.exponentialRampToValueAtTime(0.0001, time + duration);

                // Voices fanned hard across the image; the pad is what makes the
                // mix sound wide, since bass and lead have to stay centred.
                const pan = ctx.createStereoPanner();
                pan.pan.value = spread * 0.85 + (detune > 0 ? 0.1 : -0.1);

                osc.connect(filter);
                filter.connect(level);
                level.connect(pan);
                pan.connect(this.padBus);
                pan.connect(this.reverbSend);

                osc.start(time);
                osc.stop(time + duration + 0.05);
            }
        });
    }

    /** Short pluck feeding the ping-pong delay - this is most of the "space". */
    playArp(midi, time, duration, panning = 0.5) {
        const ctx = this.audioCtx;

        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = this.midiToFrequency(midi);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(4200, time);
        filter.frequency.exponentialRampToValueAtTime(900, time + duration);

        const level = ctx.createGain();
        level.gain.setValueAtTime(0.0001, time);
        level.gain.exponentialRampToValueAtTime(0.22, time + 0.006);
        level.gain.exponentialRampToValueAtTime(0.0001, time + duration);

        const pan = ctx.createStereoPanner();
        pan.pan.value = panning;

        osc.connect(filter);
        filter.connect(level);
        level.connect(pan);
        pan.connect(this.arpBus);
        pan.connect(this.delaySend);

        osc.start(time);
        osc.stop(time + duration + 0.02);
    }

    /** Three-oscillator supersaw. The detuning is what stops it sounding like a beep. */
    playLead(midi, time, duration, gain) {
        const ctx = this.audioCtx;
        const frequency = this.midiToFrequency(midi);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 1.2;
        filter.frequency.setValueAtTime(3000 + this.intensity * 2800, time);
        filter.frequency.exponentialRampToValueAtTime(1700, time + duration);

        const level = ctx.createGain();
        level.gain.setValueAtTime(0.0001, time);
        level.gain.exponentialRampToValueAtTime(gain, time + 0.012);
        level.gain.setValueAtTime(gain, time + duration * 0.55);
        level.gain.exponentialRampToValueAtTime(0.0001, time + duration);

        filter.connect(level);
        level.connect(this.leadBus);
        level.connect(this.reverbSend);
        level.connect(this.delaySend);

        [-14, 0, 14].forEach((detune, index) => {
            const osc = ctx.createOscillator();
            osc.type = index === 1 ? 'sawtooth' : 'square';
            osc.frequency.value = frequency;
            osc.detune.value = detune;

            const voiceGain = ctx.createGain();
            voiceGain.gain.value = index === 1 ? 0.6 : 0.3;

            osc.connect(voiceGain);
            voiceGain.connect(filter);
            osc.start(time);
            osc.stop(time + duration + 0.05);
        });
    }

    // ------------------------------------------------------------------- sfx

    /**
     * Coins climb a pentatonic ladder while you keep collecting, so a coin run
     * plays a little riff instead of the same blip 20 times.
     */
    playCoinSound() {
        if (!this.audioCtx) return;
        const ctx = this.audioCtx;
        const time = ctx.currentTime;

        if (time - this.lastCoinTime > 0.9) this.coinStreak = 0;
        this.lastCoinTime = time;

        // Climb the ladder, then trill between the top two notes. Sitting on one
        // pitch for a long coin run sounds like a stuck button.
        const top = COIN_LADDER.length - 1;
        const index = this.coinStreak <= top ? this.coinStreak : top - (this.coinStreak % 2);
        const note = COIN_LADDER[index];
        this.coinStreak++;

        for (const [interval, gain, delay] of [[0, 0.22, 0], [7, 0.16, 0.055]]) {
            const at = time + delay;
            const osc = ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.value = this.midiToFrequency(note + interval);

            const level = ctx.createGain();
            level.gain.setValueAtTime(0.0001, at);
            level.gain.exponentialRampToValueAtTime(gain, at + 0.005);
            level.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);

            osc.connect(level);
            level.connect(this.sfxBus);
            level.connect(this.reverbSend);
            level.connect(this.delaySend);

            osc.start(at);
            osc.stop(at + 0.3);
        }
    }

    /** Splintering wood: a filtered noise crack over a low woody thud. */
    playSmashSound() {
        if (!this.audioCtx) return;
        const ctx = this.audioCtx;
        const time = ctx.currentTime;

        const crack = this.noiseSource(time, 0.22);
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 2400;
        filter.Q.value = 0.7;
        const level = ctx.createGain();
        level.gain.setValueAtTime(0.3, time);
        level.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);

        crack.connect(filter);
        filter.connect(level);
        level.connect(this.sfxBus);
        level.connect(this.reverbSend);

        const thud = ctx.createOscillator();
        thud.type = 'triangle';
        thud.frequency.setValueAtTime(180, time);
        thud.frequency.exponentialRampToValueAtTime(70, time + 0.12);
        const thudGain = ctx.createGain();
        thudGain.gain.setValueAtTime(0.28, time);
        thudGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
        thud.connect(thudGain);
        thudGain.connect(this.sfxBus);
        thud.start(time);
        thud.stop(time + 0.18);
    }

    /** Springboard: a cartoon boing, pitch rising as you leave the pad. */
    playSpringSound() {
        if (!this.audioCtx) return;
        const ctx = this.audioCtx;
        const time = ctx.currentTime;

        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(180, time);
        osc.frequency.exponentialRampToValueAtTime(900, time + 0.18);

        // A little wobble on the way up is what makes it read as a spring.
        const wobble = ctx.createOscillator();
        wobble.type = 'sine';
        wobble.frequency.value = 22;
        const wobbleDepth = ctx.createGain();
        wobbleDepth.gain.value = 120;
        wobble.connect(wobbleDepth);
        wobbleDepth.connect(osc.frequency);

        const level = ctx.createGain();
        level.gain.setValueAtTime(0.0001, time);
        level.gain.exponentialRampToValueAtTime(0.26, time + 0.01);
        level.gain.exponentialRampToValueAtTime(0.0001, time + 0.3);

        osc.connect(level);
        level.connect(this.sfxBus);
        level.connect(this.reverbSend);

        osc.start(time); osc.stop(time + 0.32);
        wobble.start(time); wobble.stop(time + 0.32);
    }

    /**
     * A flourish laid OVER the music rather than replacing it - stopping the
     * track for two seconds every time you clip a boost pad is worse than the
     * fanfare is good.
     */
    triggerCelebration() {
        if (!this.audioCtx) return;
        const time = this.audioCtx.currentTime;
        if (time - this.lastFanfareTime < 1.2) return;
        this.lastFanfareTime = time;

        const sixteenth = (60 / this.currentBpm) / 4;

        for (const hit of FANFARE) {
            const at = time + hit.step * sixteenth;
            this.playLead(hit.lead, at, sixteenth * 3, 0.42);
            for (const note of hit.chord) {
                this.playArp(note + 12, at, sixteenth * 2.5);
            }
        }

        // Crash: a long, bright noise wash under the fanfare.
        const ctx = this.audioCtx;
        const crash = this.noiseSource(time, 1.4);
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 5200;
        const level = ctx.createGain();
        level.gain.setValueAtTime(0.22, time);
        level.gain.exponentialRampToValueAtTime(0.0001, time + 1.3);

        crash.connect(filter);
        filter.connect(level);
        level.connect(this.drumBus);
        level.connect(this.reverbSend);
    }

    midiToFrequency(note) {
        return 440 * Math.pow(2, (note - 69) / 12);
    }
}
