# Changelog

All notable changes to this project will be documented in this file.

## [0.3.1] - 2026-08-01

### Fixed
- Notes drifted out of tune as the truck sped up and slowed down. The ping-pong
  delay was being retuned to match the tempo every 25ms, and changing a delay
  line's length re-reads its buffer at a different rate - which pitch-shifts
  whatever is already inside it. Since the arp and lead feed the delay, the melody
  warbled. Measured on a steady 440Hz tone through a full tempo sweep, the delayed
  copy wandered between 420 and 460Hz: **157 cents, more than a semitone**. The
  delay time is now fixed at the base tempo and never touched again; the same
  measurement reads 440Hz flat, zero drift. Repeats sit a few percent off the grid
  at the top of the tempo range, which is inaudible next to what it replaced.
- Tempo chased the speedometer frame by frame, so it rushed and dragged over every
  bump and landing. Speed now sets a target and the tempo eases towards it with
  about a second's glide, which reads as the track responding rather than as a
  drummer losing their place.

## [0.3] - 2026-08-01

### Added
- Split-screen race HUD: per-player speed, boost, coin and distance panels, a shared
  race timer, and a mini-map progress bar showing both trucks against the finish
  line. (This was already sitting in the working tree before the physics work below
  and ships as part of the same release.)
- New soundtrack. The score moved to `src/game/MusicScore.js` (a written tune in A
  minor over Am-F-C-G, with a 16-bar arrangement that builds, breaks down and pays
  off) and `AudioManager` became a small synth-and-mixer rig instead of a row of
  bare oscillators:
  - layered voices - the kick is a pitched body plus a click transient, the snare is
    noise over two tuned tones, the lead is a three-oscillator detuned supersaw
  - shared convolution reverb and a tempo-synced ping-pong delay, so the parts share
    one space rather than sitting side by side
  - the bass, pad and arp are sidechained to the kick, which is the pumping that
    makes four-on-the-floor breathe
  - glue compression, a limiter, a rumble filter and an air shelf on the master
  - speed drives tempo (100-126bpm), filter brightness and how many parts play
- Coin pickups climb a pentatonic ladder and trill at the top, so a run of coins
  plays a riff instead of the same blip twenty times. The celebration is a fanfare
  laid over the music rather than replacing it.
- Real spring/damper suspension (`src/game/Suspension.js`): progressive rate, separate
  bump and rebound damping, bump stops, top-out stops and trailing arms. Forces are
  applied at the chassis mount, so squat, dive and body roll come out of the physics
  instead of being faked.
- Fixed 60Hz timestep with a frame-time accumulator, so the trucks feel the same at
  30, 60 or 144fps and the simulation is reproducible.
- Contact tagging in the physics engine, giving the trucks a real answer to "am I on
  the ground?" instead of guessing from velocities.
- Suspension rendering from scratch: coilovers drawn from the actual mount to the
  actual hub, coils that bunch up as the spring compresses and run hot near the bump
  stop, articulating A-arms, treaded tyres with rims that spin, and tyre squash on
  impact.
- `src/game/TruckTuning.js`: every physics number in one documented table, with the
  live-tunable ones wired to the debug menu (I key).
- `src/game/PhysicsSafety.js`: per-step invariant checks (finite state, sane speeds,
  hubs still attached, truck inside the world) with minimal repairs, counted on
  `truck.safetyRepairs` rather than hidden.
- `LevelGenerator` records the drivable surface as it builds the track, and exposes
  `groundYAt(x)` / `groundAngleAt(x)`. Everything placed on the course is positioned
  against that rather than against whatever the terrain height happened to be when
  the last segment finished.
- Test suite: `npm test` (Node's built-in runner, no new dependencies). 47 tests
  covering suspension behaviour, jump/acceleration/top-speed bands, 60-second abuse
  runs, framerate independence, determinism, track integrity, and the guard rails
  themselves.
- Jump height and distance are now measured and reported per jump.

### Changed
- Trucks are much heavier and gravity is far stronger (2.6): jumps arc ~260px and land
  in under a second, where they used to reach ~1,400px and hang for nearly two.
- Wheels are heavy and driven by torque against a wheel-spin cap, so acceleration
  builds and top speed is predictable: ~60mph cruising, ~80mph on boost, with 0-55mph
  taking about two seconds. Acceleration is unchanged - it is the gearing that runs
  out sooner, not the power.
- Boost is a resource again: thrust tapers off towards a terminal speed, the tank
  refills slower than it drains, and running it dry locks boost out until it has
  recharged to 30%.
- Airborne pitch moved off the throttle and onto the jump button: hold `W` (P1) or
  `Up` (P2) in the air to flip, otherwise the truck auto-levels and lands on its
  wheels. Because drive is a toggle, the throttle is on nearly all the time, and
  using it for air pitch meant a full race was spent upside down about a fifth of
  the time. Flips are rate-limited rather than raw torque, so a long jump cannot
  turn into an involuntary triple backflip.
- Holding the jump button on the ground now hops repeatedly, gated by a cooldown.
- Self-righting only ever applies torque plus a sub-1g hop, and escalates with time.
- Taller monster-truck stance, which is what leaves room for the shocks to be seen.
- The two trucks no longer collide with each other; each races the same distance from
  its own grid slot.
- Terrain segments overlap slightly so tyres cannot drop into the seams between them.

### Removed
- The `soundfont-player` dependency. The music is synthesised in the browser now, so
  it no longer waits on a CDN for sampled instruments that were quieter and duller
  than the synth voices replacing them.

### Fixed
- The background pulse effect was reading absolute low-end loudness, which on a
  compressed mix only moves between 0.75 and 0.89 - the screen barely twitched. It
  now auto-ranges against the recent minimum and maximum, so it follows the kick.
- The melody only played above 80mph. After the speed rebalance that meant it almost
  never played at all.
- Coins were placed at one absolute height across up to 2,000px of hills, taken from
  the terrain height at the END of the run. 51 of the 79 coins were underground, some
  by 500px. Coins, boost pads and mud pits are now positioned by height above the
  track surface, sampled at their own x.
- Sloped terrain blocks were sunk 150px straight down in world space instead of
  perpendicular to their own slope, so the surface the truck drove on was not the
  surface the level described - on the steepest ramp it sat 56px sideways of where it
  belonged and tore a 110px notch out of the crest.
- `addSegment` silently flattened sloped arguments to their average height, which put
  a 42px vertical wall across the track at the finish line. It now builds what it was
  asked for, and `addSlopeSegment` is an alias for it.
- Boost pad angles were hand-written constants that no longer matched the ground under
  them; they now follow the real slope.
- The start gantry floated 130px above the ground and the finish flags were buried;
  both are now drawn at the measured ground height.
- A coin overlapping the chassis and both wheels was counted up to three times, so a
  79-coin track could score 83.
- Suspension had no travel at all: near-rigid "guide" constraints pinned each wheel to
  a fixed point on the chassis, so the shock springs could never move.
- Self-righting applied about 5g of upward force whenever the truck tilted past 45
  degrees, which is what made the whole game feel weightless.
- The wheel-spin limit was set in the wrong units (25 rad/step) and never engaged.
- "Airborne" was inferred from vertical velocity, so the top of a jump arc counted as
  grounded - which allowed mid-air jumping and applied down-force in the air.
- Shocks were drawn as a fixed six-coil spring across a gap that never changed, from
  the wrong anchor points, on top of the bodywork.
- Mud drag was applied once per contact pair, so being in a pit could cost triple.
- Boost pads launched the chassis out from under its own wheels.
- Held boost was unbounded acceleration - about 150mph, fast enough that the safety
  limiter was quietly clipping the truck's speed during ordinary play.
- An empty boost tank drained and refilled on alternate steps, which handed the
  player half boost forever instead of making them wait.

## [0.2] - 2026-03-01

### Added
- Feature tracking for player rounds won, updating the UI to display the total number of rounds won by each player at the conclusion of each minute round.

### Changed
- Reverted the short-lived speed update throttling mechanism. The speedometer now updates per-frame to ensure real-time responsiveness and accuracy without a 1/10th of a second throttle.
- Updated npm packages and dependencies.
