# monstertruckgame

a simple monster truck game for my son

Split-screen two-player racing. P1 drives with `A`/`D` (toggles), jumps with `W` -
hold it in the air to flip - and boosts with `Left Shift`. P2 uses the arrow keys and
`Right Shift`. `I` opens the physics debug sliders, `P` returns to the menu.

## Running it

```bash
npm install
npm run dev
```

`npm run build` produces `dist/`, which is what GitHub Pages deploys.

## Physics

The trucks are the game, so their physics lives in a few small, deliberate files:

| File | What it owns |
| --- | --- |
| `src/game/TruckTuning.js` | Every tuning number, with units and reasoning. Start here. |
| `src/game/Suspension.js` | One corner of spring/damper suspension, worked out by hand each step. |
| `src/game/Truck.js` | Bodies, drivetrain, jump/boost, contact state, recovery assists. |
| `src/game/PhysicsEngine.js` | Fixed-timestep loop, contact tagging, all rendering. |
| `src/game/PhysicsSafety.js` | Invariants checked every step, plus minimal repairs. |

Three things are worth knowing before changing any of it:

1. **The timestep is fixed at 60Hz.** Real frame time goes into an accumulator and the
   solver only ever sees `STEP_MS`. Forces must be applied in `preStep()`, because
   Matter clears force buffers at the end of every update.
2. **Suspension forces are applied at the chassis mount**, not the centre of mass.
   That is what produces squat under power, dive under braking, and body roll over
   bumps, so moving the anchor changes how the truck feels.
3. **Matter multiplies computed inertia by 4** (`Body._inertiaScale`). Torque values
   that look wrong on paper are sized for the real number.

## Music

`src/game/MusicScore.js` is the tune as data - key, chords, riffs, and which parts
play in which bar. `src/game/AudioManager.js` is the synth and mixer that renders it:
layered voices, a shared reverb and ping-pong delay, sidechain ducking off the kick,
and glue compression into a limiter. Nothing is sampled and nothing is downloaded.

Edit the notes in `MusicScore.js`; edit how it sounds in `AudioManager.js`.

To check a mix change without trusting your speakers, render it offline and measure
it - `init()` accepts a context for exactly this:

```js
const off = new OfflineAudioContext(2, 44100 * 12, 44100);
const am = new AudioManager(); am.init(off); am.updateSpeed(55);
let t = 0.05, step = 0;
while (t < 11) { const d = (60 / am.currentBpm) / 4; am.scheduleStep(step++ % 256, t, d); t += d; }
const buffer = await off.startRendering();   // then check peak, RMS, band balance
```

## Tests

```bash
npm test
```

Node's built-in test runner, no extra dependencies. The suites are the guard rail
against the physics quietly drifting back to feeling bad:

- `tests/suspension.test.js` - sag, travel limits, bump stops, rebound, and that the
  render state matches the bodies it is drawn from.
- `tests/driving.test.js` - jump apex and airtime bands, acceleration, top speed,
  braking, ramps, landings, self-righting, boost.
- `tests/stability.test.js` - 30 and 60 second abuse runs, determinism, framerate
  independence, truck-vs-truck collision rules, and the safety net itself.
- `tests/music.test.js` - the score is well formed and in key: melody notes, chord
  voicings, harmony lines and the arrangement's shape. The mix itself is checked by
  offline rendering (above), which Node cannot do.
- `tests/level.test.js` - track integrity: no holes, no steps a wheel would trip on,
  and every coin, boost pad and mud pit sitting on the surface rather than inside it.
  These probe the real physics bodies, not the generator's own bookkeeping, because
  the bug they exist for was the two disagreeing.

The jump and speed tests assert *bands*, not exact numbers: they exist so that a
tuning change which makes the truck floaty again fails loudly. If you deliberately
change the feel, move the band and say so in the changelog.

For hands-on tuning, run `npm run dev` and press `I` for live sliders; in dev the game
is also on `window.game`, so `game.tuning.springStiffness = 0.01` works from the
console.
