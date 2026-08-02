import Matter from 'matter-js';

/** Truck speed (px/step) above which a crate is properly destroyed rather than nudged. */
const SMASH_SPEED = 3;

/** How long a smashed crate is left to tumble before it is swept up. */
const DEBRIS_LIFETIME_MS = 1400;

/** Crates further behind the last player than this are gone. */
const DEBRIS_TRAIL = 2500;

/**
 * Everything the course does TO a truck: boost pads, springboards, mud, coins
 * and crates.
 *
 * This lives apart from GameManager so it can be driven headlessly. Course
 * obstacles are the part of the game most likely to trap a player, and the only
 * way to know a course is completable is to have a bot drive it with the real
 * hazard behaviour attached - which means that behaviour cannot be tangled up
 * with score panels and audio.
 *
 * Callbacks report what happened; this class never touches UI or sound itself.
 */
export class CourseHazards {
    constructor(physics, callbacks = {}) {
        this.physics = physics;
        this.callbacks = callbacks;
        this.trucks = [];
        this.now = 0;

        Matter.Events.on(physics.engine, 'collisionStart', (event) => this.onCollisionStart(event));
        Matter.Events.on(physics.engine, 'collisionActive', (event) => this.onCollisionActive(event));
    }

    /** @param {string} id an opaque label handed back to the callbacks, e.g. 'p1' */
    addTruck(truck, id) {
        this.trucks.push({ truck, id });
    }

    reset() {
        this.trucks = [];
    }

    owns(entry, body) {
        const { truck } = entry;
        return body === truck.chassis || body === truck.wheelA || body === truck.wheelB;
    }

    /** Returns the non-truck body of a pair, if the other half belongs to `entry`. */
    otherBody(entry, pair) {
        if (this.owns(entry, pair.bodyA)) return pair.bodyB;
        if (this.owns(entry, pair.bodyB)) return pair.bodyA;
        return null;
    }

    onCollisionStart(event) {
        for (const pair of event.pairs) {
            for (const entry of this.trucks) {
                const other = this.otherBody(entry, pair);
                if (!other) continue;

                if (other.label === 'boost_pad') this.boost(entry);
                else if (other.label === 'spring_pad') this.spring(entry);
                else if (other.label === 'coin') this.collectCoin(entry, other);
                else if (other.label === 'crate') this.smashCrate(entry, other);
            }
        }
    }

    onCollisionActive(event) {
        for (const pair of event.pairs) {
            for (const entry of this.trucks) {
                const other = this.otherBody(entry, pair);
                // Flag only; the truck applies the drag once per frame, so three
                // overlapping contacts cannot triple the penalty.
                if (other && other.label === 'mud_pit') entry.truck.mudTouch = true;
            }
        }
    }

    // ------------------------------------------------------------- reactions

    boost({ truck, id }) {
        if (truck.lastBoostPadHit && this.now - truck.lastBoostPadHit < 1000) return;
        truck.lastBoostPadHit = this.now;

        // Launch the whole vehicle, not just the chassis: pulling the body out
        // from under its own wheels flipped the truck off every pad.
        for (const part of truck.parts) {
            Matter.Body.setVelocity(part, {
                x: part.velocity.x + 6,
                y: Math.min(part.velocity.y, 0) - 24
            });
        }
        Matter.Body.setAngularVelocity(truck.chassis, -0.06);
        this.callbacks.onBoost?.(truck, id);
    }

    /** Springboard: height rather than speed, and no spin so you land flat. */
    spring({ truck, id }) {
        if (truck.lastSpringHit && this.now - truck.lastSpringHit < 600) return;
        truck.lastSpringHit = this.now;

        for (const part of truck.parts) {
            Matter.Body.setVelocity(part, {
                x: part.velocity.x,
                y: Math.min(part.velocity.y, 0) - 27
            });
        }
        Matter.Body.setAngularVelocity(truck.chassis, truck.chassis.angularVelocity * 0.3);
        this.callbacks.onSpring?.(truck, id);
    }

    collectCoin({ truck, id }, coin) {
        // A coin overlaps the chassis AND both wheels, which is three pairs in the
        // same event. Claiming it once is the difference between a 79-coin track
        // and a scoreboard that reads 83.
        if (coin.claimed) return;
        coin.claimed = true;
        Matter.World.remove(this.physics.world, coin);
        this.callbacks.onCoin?.(truck, id);
    }

    /**
     * Crates burst apart rather than being shoved along.
     *
     * Pushed crates accumulate: a full-throttle bot ploughed a heap of a dozen
     * into a wall, climbed it nose-up and stopped dead for the rest of the race.
     * Bursting them means a stack can never become something a player cannot get
     * past, and it is the more satisfying answer anyway.
     */
    smashCrate({ truck, id }, crate) {
        if (crate.smashedAt) return;

        const direction = Math.sign(truck.chassis.velocity.x) || 1;
        const punch = Math.min(1, truck.speed / 12);

        // Below walking pace a crate is only nudged, so you can potter through a
        // stack without it exploding in your face.
        if (truck.speed < SMASH_SPEED) return;
        crate.smashedAt = this.now;

        Matter.Body.setVelocity(crate, {
            x: crate.velocity.x + direction * (5 + punch * 12),
            y: crate.velocity.y - (4 + punch * 10)
        });
        Matter.Body.setAngularVelocity(crate, direction * (0.15 + punch * 0.3));
        this.callbacks.onSmash?.(truck, id);
    }

    // --------------------------------------------------------------- upkeep

    /**
     * Sweep up debris. Loose dynamic bodies are the one thing on a course that
     * can grow without bound, so smashed crates are removed once they have had
     * their moment, along with anything that has fallen off or been left behind.
     */
    update(dt) {
        this.now += dt;
        if (this.trucks.length === 0) return;

        const trailing = Math.min(...this.trucks.map(e => e.truck.getPosition().x));

        for (const body of Matter.Composite.allBodies(this.physics.world)) {
            if (body.label !== 'crate') continue;

            const spent = body.smashedAt && this.now - body.smashedAt > DEBRIS_LIFETIME_MS;
            const fallen = body.position.y > 3000;
            const behind = body.position.x < trailing - DEBRIS_TRAIL;

            if (spent || fallen || behind) Matter.World.remove(this.physics.world, body);
        }
    }
}
