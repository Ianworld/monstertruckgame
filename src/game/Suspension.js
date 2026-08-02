import Matter from 'matter-js';
import { clamp } from './TruckTuning.js';

const { Body, Vector } = Matter;

/**
 * One corner of suspension: a spring/damper worked out by hand every step
 * rather than leaned on a Matter constraint.
 *
 * Why by hand:
 *   - a Matter constraint is a distance spring in every direction, so wheels
 *     wander fore/aft and there is no travel limit, no progressive rate and no
 *     separate compression/rebound damping. That is what made the old truck feel
 *     like it was on bungee cords.
 *   - the force is applied at the chassis ANCHOR, not the centre of mass, so
 *     squat, dive and body roll fall out of the maths for free.
 *   - measure() gives the renderer exact geometry, so the shocks can never
 *     again be drawn somewhere the physics isn't.
 *
 * Travel runs along the chassis's own "down" axis, so the suspension stays
 * square to the truck when it pitches. A separate trailing-arm constraint (owned
 * by Truck) holds the hub fore/aft; this unit only cares about the axis.
 */
export class SuspensionUnit {
    /**
     * @param {object} opts
     * @param {Matter.Body} opts.chassis
     * @param {Matter.Body} opts.wheel
     * @param {number} opts.side -1 for the rear corner, +1 for the front
     * @param {object} opts.tuning shared tuning table (mutated live by the debug menu)
     */
    constructor({ chassis, wheel, side, tuning }) {
        this.chassis = chassis;
        this.wheel = wheel;
        this.side = side;
        this.tuning = tuning;

        this.anchorLocal = { x: side * tuning.wheelBase, y: tuning.anchorY };

        // Where the shock is DRAWN from: up inside the bodywork and angled inboard,
        // like a real coilover. The top disappears behind the bodywork (which is
        // where it bolts on) and the rest runs down through the wheel arch to the
        // hub. The physics still hangs off anchorLocal, directly above the wheel.
        this.mountLocal = { x: side * (tuning.wheelBase - 28), y: tuning.anchorY - 4 };

        // Physics pivot for the trailing arm: far inboard, so the hub swings on a
        // near-vertical arc. The drawn arm is shorter (a plausible A-arm) because a
        // 62px bar reaching across the truck looks like a mistake.
        this.armPivotLocal = {
            x: side * (tuning.wheelBase - tuning.armLength),
            y: tuning.anchorY + (tuning.restLength - tuning.staticSag)
        };
        this.armVisualLocal = {
            x: side * (tuning.wheelBase - 34),
            y: tuning.anchorY + (tuning.restLength - tuning.staticSag)
        };

        // Measured state, refreshed by measure() every step.
        this.axis = { x: 0, y: 1 };          // chassis down, world space
        this.forward = { x: 1, y: 0 };       // chassis forward, world space
        this.anchorWorld = { x: 0, y: 0 };
        this.length = tuning.restLength;     // anchor -> hub along the axis
        this.compression = 0;                // px, positive = compressed
        this.lateral = 0;                    // px off the axis (arm slop)
        this.axisSpeed = 0;                  // px/step, positive = extending
        this.lateralSpeed = 0;
        this.appliedForce = 0;
        this.popTimer = 0;                   // jump pre-load countdown, ms
        this.squash = 0;                     // tyre deformation, 0..1
        this.bottomedOut = false;
    }

    /** Fraction of usable up-travel in use: 0 at rest length, 1 at the bump stop. */
    get compressionRatio() {
        return clamp(this.compression / this.tuning.maxCompression, -1.5, 1.5);
    }

    get mountWorld() {
        return Vector.add(this.chassis.position, Vector.rotate(this.mountLocal, this.chassis.angle));
    }

    get armVisualWorld() {
        return Vector.add(this.chassis.position, Vector.rotate(this.armVisualLocal, this.chassis.angle));
    }

    /** Hub position this corner would have with the spring at rest, in world space. */
    restHubWorld() {
        const anchor = Vector.add(
            this.chassis.position,
            Vector.rotate(this.anchorLocal, this.chassis.angle)
        );
        const down = { x: -Math.sin(this.chassis.angle), y: Math.cos(this.chassis.angle) };
        const length = this.tuning.restLength - this.tuning.staticSag;
        return Vector.add(anchor, Vector.mult(down, length));
    }

    /** Read the current geometry and relative velocity. Pure - no forces applied. */
    measure() {
        const angle = this.chassis.angle;
        const sin = Math.sin(angle);
        const cos = Math.cos(angle);

        this.axis = { x: -sin, y: cos };        // chassis down
        this.forward = { x: cos, y: sin };      // chassis forward

        const arm = Vector.rotate(this.anchorLocal, angle);
        this.anchorWorld = Vector.add(this.chassis.position, arm);

        const offset = Vector.sub(this.wheel.position, this.anchorWorld);
        this.length = Vector.dot(offset, this.axis);
        this.lateral = Vector.dot(offset, this.forward);
        this.compression = this.tuning.restLength - this.length;

        // Velocity of the chassis AT the anchor point (v + omega x r), so a
        // pitching chassis winds its own shocks up the way it should.
        const anchorVel = {
            x: this.chassis.velocity.x - this.chassis.angularVelocity * arm.y,
            y: this.chassis.velocity.y + this.chassis.angularVelocity * arm.x
        };
        const relVel = Vector.sub(this.wheel.velocity, anchorVel);
        this.axisSpeed = Vector.dot(relVel, this.axis);
        this.lateralSpeed = Vector.dot(relVel, this.forward);

        return this;
    }

    /** Spring force for a given compression, ignoring damping. Exposed for tests. */
    springForce(compression) {
        const t = this.tuning;
        const ratio = clamp(compression / t.maxCompression, -1.5, 1.5);
        // Progressive rate: soft and floaty over small stuff, firm near the stop.
        let force = t.springStiffness * compression * (1 + t.springProgressive * ratio * ratio);

        if (compression > t.maxCompression) {
            force += t.bumpStopStiffness * (compression - t.maxCompression);
        } else if (compression < -t.maxExtension) {
            force += t.bumpStopStiffness * (compression + t.maxExtension);
        }
        return force;
    }

    /** Fires the "crouch and pop" spring kick used by the jump. */
    pop() {
        this.popTimer = this.tuning.jumpPopMs;
    }

    /**
     * Apply this step's spring, damper and bump-stop forces.
     * Positive force pushes the wheel DOWN the axis and the chassis UP at the anchor.
     */
    applyForces(dt) {
        const t = this.tuning;
        this.measure();

        let force = this.springForce(this.compression);

        // Asymmetric damping: let it collapse into a hit, control the rebound.
        const damping = this.axisSpeed < 0 ? t.dampingCompression : t.dampingRebound;
        force -= damping * this.axisSpeed;

        if (this.popTimer > 0) {
            this.popTimer = Math.max(0, this.popTimer - dt);
            force += t.jumpPopForce;
        }

        force = clamp(force, -t.maxSuspensionForce, t.maxSuspensionForce);
        this.appliedForce = force;
        this.bottomedOut = this.compression > t.maxCompression;

        const push = Vector.mult(this.axis, force);
        Body.applyForce(this.wheel, this.wheel.position, push);
        Body.applyForce(this.chassis, this.anchorWorld, Vector.neg(push));

        // Damp sideways hub motion so the trailing arm has an easy job.
        const lateralForce = clamp(
            -t.lateralDamping * this.lateralSpeed,
            -t.maxSuspensionForce,
            t.maxSuspensionForce
        );
        const slide = Vector.mult(this.forward, lateralForce);
        Body.applyForce(this.wheel, this.wheel.position, slide);
        Body.applyForce(this.chassis, this.anchorWorld, Vector.neg(slide));

        return force;
    }

    /** Tyre squash for the renderer: driven by impact speed, then eased away. */
    updateSquash(grounded) {
        const t = this.tuning;
        let target = 0;
        if (grounded) {
            const impact = clamp(-this.axisSpeed / 22, 0, 1);
            const load = clamp(this.compressionRatio, 0, 1);
            target = t.tireSquash * clamp(impact * 0.75 + load * 0.45, 0, 1);
        }
        const rate = target > this.squash ? t.squashAttack : t.squashDecay;
        this.squash += (target - this.squash) * rate;
        if (this.squash < 0.001) this.squash = 0;
        return this.squash;
    }

    /** Everything the renderer needs. Derived from live bodies, so it cannot drift. */
    getRenderState(grounded) {
        return {
            side: this.side,
            hub: { x: this.wheel.position.x, y: this.wheel.position.y },
            mount: this.mountWorld,
            anchor: this.anchorWorld,
            armPivot: this.armVisualWorld,
            angle: this.wheel.angle,
            radius: this.tuning.wheelRadius,
            compression: this.compression,
            ratio: clamp(this.compressionRatio, -1, 1),
            bottomedOut: this.bottomedOut,
            squash: this.squash,
            grounded
        };
    }
}
