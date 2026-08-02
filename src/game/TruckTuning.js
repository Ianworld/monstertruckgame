/**
 * Central tuning table for truck physics, suspension and drivetrain.
 *
 * UNITS (all Matter.js native, so the numbers here are the numbers the solver sees):
 *   distance  px
 *   time      one fixed 60Hz step (STEP_MS)
 *   velocity  px per step   (Matter normalises body.velocity to a 16.667ms step)
 *   force     applying force F to mass m for one step changes velocity by
 *             F / m * STEP_SQ  -- that dt^2 is why spring rates look tiny.
 *
 * Reason in gravities and px/s, then convert with the helpers at the bottom.
 * Anything marked LIVE can be changed at runtime from the debug menu (I key);
 * geometry and mass changes need a truck rebuild.
 */

export const STEP_MS = 1000 / 60;
export const STEP_SQ = STEP_MS * STEP_MS;   // 277.78 - the dt^2 in Verlet integration
export const GRAVITY_SCALE = 0.001;         // Matter's engine.gravity.scale

// ~40px to the metre (a 150px chassis is a 3.75m truck), 60 steps to the second.
export const PX_PER_STEP_TO_MPH = (60 / 40) * 2.237;

export const DEFAULT_TUNING = {
    // --- WORLD -------------------------------------------------------------
    // 2.6 => 2600 px/s^2, about 6.6x real gravity at our scale. Cartoon-snappy:
    // jumps arc high but come down fast instead of hanging in the air.
    gravity: 2.6,                   // LIVE

    // --- MASS (heavy wheels are the whole point) ---------------------------
    chassisMass: 60,
    wheelMass: 26,                  // 43% of the chassis EACH - big unsprung weight
    driverMass: 2,
    // Matter bleeds this fraction of velocity per step, so it scales with speed and
    // acts as the aero drag that stops a long descent from running away. The spin
    // cap sets cruising speed; this is what caps a downhill charge.
    chassisAirFriction: 0.0055,
    wheelAirFriction: 0.003,

    // --- GEOMETRY (chassis-local px, +x forward, +y down) ------------------
    chassisWidth: 150,
    chassisHeight: 44,
    wheelBase: 58,                  // hub offset from centre, both axles
    wheelRadius: 37,                // 74px tall tyres under a 44px chassis
    anchorY: -6,                    // suspension top mount, just above centreline
    // Rest length puts the static hub 62px below the chassis centre, which is
    // 34px below the bodywork - the gap where the shocks are visible. Shorten it
    // and the tyres swallow the suspension, which is how the old truck looked
    // like it had no springs at all.
    restLength: 77,
    maxCompression: 30,             // hub travel up from rest before the bump stop
    maxExtension: 20,               // hub droop below rest before topping out
    staticSag: 9,                   // where the truck settles under its own weight
    armLength: 62,                  // trailing arm: holds the hub fore/aft
    spawnDrop: 26,                  // spawn this high so it settles with a bounce

    // --- SPRING / DAMPER ---------------------------------------------------
    // springStiffness * staticSag ~= sprung weight per corner, so the truck sits
    // at staticSag with ~2/3 of its travel still available for landings.
    springStiffness: 0.0075,        // LIVE  force per px of compression
    springProgressive: 2.2,         // LIVE  rate multiplier at full travel (cartoon boing)
    bumpStopStiffness: 0.05,        // extra rate once past the mechanical limit
    dampingCompression: 0.019,      // LIVE  soft going in: soaks up hits, bounces
    dampingRebound: 0.030,          // LIVE  firmer coming out: settles, no pogo
    lateralDamping: 0.010,          // kills hub wobble across the suspension axis
    armStiffness: 0.9,
    armDamping: 0.05,
    jumpPopForce: 0.09,             // spring pre-load kick on jump (legs-out look)
    jumpPopMs: 140,
    maxSuspensionForce: 1.6,        // safety clamp per corner

    // --- DRIVETRAIN --------------------------------------------------------
    // NOTE ON TORQUE: Matter multiplies computed inertia by Body._inertiaScale (4),
    // so a 37px wheel of mass 26 has I ~= 71,000, not the ~18,000 the textbook
    // formula gives. Torques here are sized for the real number.
    driveTorque: 3.2,               // LIVE  per wheel, all four driven
    airDriveTorque: 1.4,            // wheels still spin up in the air (looks alive)
    // The spin cap, not power, is what sets top speed: 0.50 * 37px * 60 ~= 1100 px/s
    // (~60mph). Acceleration stays punchy, it just runs out of gearing sooner.
    maxWheelSpin: 0.50,
    rollingResistance: 0.005,       // fraction of spin shed per step when coasting
    brakeStrength: 0.06,            // spin shed per step when reversing into motion
    wheelFriction: 1.0,
    wheelRestitution: 0.15,         // most of the bounce comes from the springs

    // --- HANDLING ASSISTS --------------------------------------------------
    // Air control is a RATE controller, not raw torque: hold the throttle and the
    // truck spins up to airSpinRate and no further. Raw torque integrates, so
    // holding the gas through a long jump used to guarantee a faceplant.
    airControlTorque: 6.0,          // LIVE  authority available to reach the rate
    airSpinRate: 0.09,              // rad/step ~= 0.86 flips per second
    airSpinGain: 15,                // how hard it chases the rate
    airLevelTorque: 8.0,            // hands off the controls => it flies straight
    airLevelSpinGain: 12,
    airLevelAngleGain: 1.5,
    wheelieTorque: 2.2,             // small nose-lift on the throttle
    downForceGravities: 0.25,       // planted on ramps, still lets the truck jump
    landingSpinDamping: 0.35,       // takes the edge off a flat landing

    // --- JUMP / BOOST ------------------------------------------------------
    jumpVelocity: 20.5,             // LIVE  px/step => ~305px apex, ~0.95s airtime
    jumpCooldownMs: 320,            // no mid-air stair climbing
    jumpForwardBleed: 0.06,         // shave a little speed so jumps cost something
    jumpNoseTorque: -4.8,           // slight nose-up off the jump
    boostGravities: 1.4,            // LIVE  forward thrust in gravities
    // Thrust fades out as the truck approaches this, giving boost a terminal speed.
    // Without it a full tank was worth 4 seconds of unopposed acceleration - about
    // 150mph, fast enough to hit the safety clamp during ordinary play.
    boostTopSpeed: 32,              // px/step; lands the boosted top speed near 85mph
    boostDrainPerSec: 25,           // a full tank is 4 seconds of thrust
    // Refill is deliberately slower than drain, and an empty tank locks out until
    // it has recharged to boostMinToEngage. With equal rates and no threshold,
    // holding the button gave half boost forever - it was not a resource at all.
    boostRefillPerSec: 12,
    boostMinToEngage: 30,

    // --- RECOVERY (time-escalating, never lifts the truck like a balloon) --
    rightingDelayMs: 700,           // grace period before the game helps out
    rightingTorque: 12.0,
    rightingSpin: 0.10,             // rad/step target roll rate
    rightingEscalateMs: 1200,       // time to reach full assist strength
    rightingHopGravities: 0.8,      // < 1g, so it can never cancel gravity
    stuckSpeed: 2.5,                // px/step below which we count as stuck

    // --- PRESENTATION ------------------------------------------------------
    minJumpMs: 250,                 // shorter airtime than this is a hop, not a jump
    tireSquash: 0.16,               // max vertical squash on a hard hit
    squashAttack: 0.35,
    squashDecay: 0.12,
    // Per-step velocity retained in a mud pit. This compounds 60 times a second,
    // so it is far more savage than it looks: drive thrust balances v*(1-grip),
    // which puts the equilibrium at 14mph for 0.93 and 34mph for 0.97. At 0.93 a
    // bog was a near-standstill and Mud Bog took 50 seconds to finish.
    mudGrip: 0.97
};

/** Keys the debug menu is allowed to poke at runtime. */
export const LIVE_TUNING_KEYS = [
    'gravity', 'springStiffness', 'springProgressive', 'dampingCompression',
    'dampingRebound', 'driveTorque', 'maxWheelSpin', 'jumpVelocity', 'boostGravities',
    'boostTopSpeed', 'airControlTorque'
];

export function createTuning(overrides = {}) {
    return { ...DEFAULT_TUNING, ...overrides };
}

/** Force needed to accelerate `mass` at `g` gravities under the given gravity setting. */
export function forceForGravities(mass, gravityY, g) {
    return mass * gravityY * GRAVITY_SCALE * g;
}

export function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
}
