export class AudioManager {
    constructor() {
        this.audioCtx = null;
        this.isPlaying = false;

        this.speed = 0;
        this.baseBpm = 85; // Lowered baseline BPM for a more relaxed, chill vibe
        this.currentBpm = 85;

        // Sequencer state
        this.nextNoteTime = 0;
        this.currentStep = 0; // 0-15 for 16-step sequencer
        this.intervalId = null;

        // Patterns (64 steps)
        // Bassline: More relaxed and bouncy
        this.bassPattern = [
            // Bar 1
            36, 0, 36, 0, 43, 0, 48, 0, 36, 0, 36, 0, 43, 43, 48, 0,
            // Bar 2
            36, 0, 36, 0, 43, 0, 48, 0, 36, 0, 36, 0, 43, 43, 48, 0,
            // Bar 3 (Chorus build)
            36, 0, 36, 0, 43, 0, 48, 0, 43, 0, 43, 0, 48, 48, 43, 0,
            // Bar 4 (Chorus pay-off)
            36, 0, 36, 0, 43, 0, 48, 0, 48, 0, 50, 0, 43, 0, 36, 0
        ];
        // Melody: Syncopated, melodic phrasing instead of continuous 16th notes
        this.melodyPattern = [
            // Bar 1
            60, 0, 63, 0, 0, 67, 63, 0, 60, 0, 67, 0, 72, 67, 63, 0,
            // Bar 2
            60, 0, 63, 0, 0, 67, 63, 0, 60, 0, 67, 0, 75, 72, 67, 0,
            // Bar 3 (Chorus)
            72, 0, 72, 0, 75, 0, 75, 0, 79, 0, 79, 0, 84, 79, 75, 0,
            // Bar 4 (Chorus ending)
            72, 0, 72, 0, 75, 0, 75, 0, 79, 0, 84, 0, 75, 0, 72, 0
        ];
        // Drums: Simpler breakbeat flavor
        this.drumPattern = [
            // Bar 1
            1, 0, 0, 0, 2, 0, 0, 1, 0, 0, 1, 0, 2, 0, 0, 0,
            // Bar 2
            1, 0, 0, 0, 2, 0, 0, 1, 0, 0, 1, 1, 2, 0, 0, 0,
            // Bar 3 (Chorus)
            1, 0, 1, 0, 2, 0, 0, 1, 0, 0, 1, 0, 2, 0, 0, 0,
            // Bar 4 (Chorus ending fills)
            1, 0, 0, 0, 2, 0, 0, 1, 2, 0, 1, 0, 2, 2, 2, 0
        ]; // 1=Kick, 2=Snare

        // Celebration
        this.celebrationTimeRemaining = 0;
        this.celebrationStep = 0;
        this.celebrationNotes = [72, 76, 79, 84, 72, 76, 79, 84]; // C major fanfare
    }

    init() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

            // Master output path with analyser
            this.masterGain = this.audioCtx.createGain();
            this.masterGain.gain.value = 0.8; // Prevent overall clipping

            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 64;
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

            this.masterGain.connect(this.analyser);
            this.analyser.connect(this.audioCtx.destination);
        }
    }

    getPulse() {
        if (!this.analyser || !this.isPlaying) return 0;
        this.analyser.getByteFrequencyData(this.dataArray);

        // Average the lowest 4 bins for a bass pulse
        let sum = 0;
        const bins = 4;
        for (let i = 0; i < bins; i++) {
            sum += this.dataArray[i];
        }
        return (sum / bins) / 255; // Normalize 0 to 1
    }

    start() {
        this.init();
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
        if (!this.isPlaying) {
            this.isPlaying = true;
            this.nextNoteTime = this.audioCtx.currentTime + 0.1;
            this.scheduler();
        }
    }

    stop() {
        this.isPlaying = false;
        if (this.intervalId) {
            clearTimeout(this.intervalId);
            this.intervalId = null;
        }
    }

    updateSpeed(speed) {
        this.speed = speed;
        // Map speed to BPM but keep it relatively relaxed
        let targetBpm = this.baseBpm + (Math.min(speed, 200) * 0.25);
        this.currentBpm = targetBpm;
    }

    triggerCelebration() {
        this.celebrationTimeRemaining = 2.0; // 2 seconds of celebration (in actual time, not music time)
        this.celebrationStep = 0;
    }

    midiToFrequency(note) {
        if (note === 0) return 0;
        return 440 * Math.pow(2, (note - 69) / 12);
    }

    playSynth(freq, time, duration, type, vol, filterFreq) {
        if (freq === 0) return;
        const osc = this.audioCtx.createOscillator();
        const filter = this.audioCtx.createBiquadFilter();
        const gain = this.audioCtx.createGain();

        osc.type = type;
        osc.frequency.value = freq;

        // Apply a gentle lowpass filter to make it sound warmer/less synthy
        filter.type = 'lowpass';
        filter.frequency.value = filterFreq || 800; // Default soft filter
        filter.Q.value = 1.0;

        gain.gain.setValueAtTime(vol, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + duration);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        osc.start(time);
        osc.stop(time + duration);
    }

    playKick(time) {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        // Deep, softer kick
        osc.type = 'sine';
        osc.frequency.setValueAtTime(120, time);
        osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.15);

        gain.gain.setValueAtTime(0.6, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(time);
        osc.stop(time + 0.1);
    }

    playNoiseSnare(time, filterFreq = 1500) {
        const bufferSize = this.audioCtx.sampleRate * 0.1; // 100ms
        const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.audioCtx.createBufferSource();
        noise.buffer = buffer;

        const noiseFilter = this.audioCtx.createBiquadFilter();
        // A bandpass to make it sound like a soft shaker instead of a harsh snare
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.value = filterFreq;
        noiseFilter.Q.value = 0.5;

        const gain = this.audioCtx.createGain();
        gain.gain.setValueAtTime(0.2, time); // Softer volume
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);

        noise.connect(noiseFilter);
        noiseFilter.connect(gain);
        gain.connect(this.masterGain);

        noise.start(time);
        noise.stop(time + 0.1);
    }

    scheduleNote(time, stepDuration) {
        if (!this.audioCtx) return;

        if (this.celebrationTimeRemaining > 0) {
            // Play celebration sequence
            const note = this.celebrationNotes[this.celebrationStep % this.celebrationNotes.length];
            this.playSynth(this.midiToFrequency(note), time, stepDuration * 0.8, 'square', 0.2);
            this.celebrationStep++;
            this.celebrationTimeRemaining -= stepDuration;
        } else {
            // Normal play
            // Bass
            const bassNote = this.bassPattern[this.currentStep];
            if (bassNote) {
                // Pitch variation based on speed
                const speedOffset = Math.floor(this.speed / 50) * 2; // Jump a whole step when fast
                // Use triangle wave and low filter frequency for an electric bass feel
                // Slowly sweep bass filter between 300hz and 600hz over ~30 seconds
                const bassFilterFreq = 450 + Math.sin(time * 0.2) * 150;
                this.playSynth(this.midiToFrequency(bassNote + speedOffset), time, stepDuration * 0.9, 'triangle', 0.25, bassFilterFreq);
            }

            // Melody (Only play if truck is moving fast enough)
            const melodyNote = this.melodyPattern[this.currentStep];
            if (melodyNote && this.speed > 80) {
                // Shift up an octave at very high speeds, but always play melody
                // Use sine wave and warmer filter for a soft rhodes/pad feel
                // Evolve the melody filter slowly over roughly 60 seconds (sweeps from 600hz to 1800hz)
                const melodyFilterFreq = 1200 + Math.sin(time * 0.1) * 600;
                this.playSynth(this.midiToFrequency(melodyNote + (this.speed > 120 ? 12 : 0)), time, stepDuration * 1.5, 'sine', 0.2, melodyFilterFreq);
            }

            // Drums
            const drum = this.drumPattern[this.currentStep];
            if (drum === 1) {
                this.playKick(time);
            } else if (drum === 2 && this.speed > 40) {
                // Evolve the snare/shaker tone slightly over ~40 seconds
                const snareFilterFreq = 1500 + Math.sin(time * 0.15) * 500;
                this.playNoiseSnare(time, snareFilterFreq);
            }
        }
    }

    scheduler() {
        if (!this.isPlaying) return;

        // Schedule notes a little bit into the future
        while (this.nextNoteTime < this.audioCtx.currentTime + 0.1) {
            const stepDuration = (60 / this.currentBpm) / 4; // 16th note
            this.scheduleNote(this.nextNoteTime, stepDuration);

            this.nextNoteTime += stepDuration;
            this.currentStep = (this.currentStep + 1) % 64;
        }

        this.intervalId = setTimeout(() => this.scheduler(), 25.0);
    }
}
