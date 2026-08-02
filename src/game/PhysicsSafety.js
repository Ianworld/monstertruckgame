import Matter from 'matter-js';

const { Body, Vector } = Matter;

/**
 * Guard rails for the truck simulation.
 *
 * A spring/damper rig driven by forces can, in principle, blow up: a bad tuning
 * value, a tunnelling collision or a pile-up against a wall can hand the solver a
 * huge number, and one NaN is enough to poison every body it touches. Rather than
 * hope, we check the same invariants every step:
 *
 *   - every position, velocity and angle is finite
 *   - nothing is moving faster than the world can plausibly resolve
 *   - each hub is still within reach of its own suspension
 *   - the truck is inside the world
 *
 * inspectTruck() is the pure check (used by the tests to assert nothing drifts
 * over a long run) and enforceTruckSafety() is the same check plus the smallest
 * repair that puts the truck back in a legal state. Repairs are counted, not
 * hidden: truck.safetyRepairs climbing during play is a real bug worth chasing.
 */

export const SAFETY_LIMITS = {
    maxSpeed: 45,           // px/step. one step of travel stays under a wheel radius
    maxWheelSpin: 1.4,      // rad/step
    maxChassisSpin: 0.6,    // rad/step
    maxHubStretch: 55,      // px past the suspension's own mechanical limit
    bounds: { minX: -4000, maxX: 60000, minY: -30000, maxY: 8000 }
};

const isFiniteVector = (v) => !!v && Number.isFinite(v.x) && Number.isFinite(v.y);

function bodyIsFinite(body) {
    return isFiniteVector(body.position)
        && isFiniteVector(body.velocity)
        && isFiniteVector(body.positionPrev)
        && Number.isFinite(body.angle)
        && Number.isFinite(body.angularVelocity);
}

function speedOf(body) {
    return Math.hypot(body.velocity.x, body.velocity.y);
}

/** How far the hub has strayed past the travel its suspension allows. */
export function hubStretch(unit) {
    const t = unit.tuning;
    const offset = Vector.sub(unit.wheel.position, unit.anchorWorld);
    const distance = Math.hypot(offset.x, offset.y);
    const longest = t.restLength + t.maxExtension;
    const shortest = Math.max(4, t.restLength - t.maxCompression);
    if (distance > longest) return distance - longest;
    if (distance < shortest) return shortest - distance;
    return 0;
}

/**
 * Invariant check. Reads the truck and refreshes suspension measurements, but never
 * changes a body - so tests can call it as often as they like.
 * @returns {Array<{code: string, part: string, value: number}>} empty when healthy
 */
export function inspectTruck(truck, limits = SAFETY_LIMITS) {
    const violations = [];
    const report = (code, part, value) => violations.push({ code, part, value });

    for (const [name, body] of Object.entries(truck.namedParts)) {
        if (!bodyIsFinite(body)) {
            report('non-finite', name, NaN);
            continue;
        }

        const speed = speedOf(body);
        if (speed > limits.maxSpeed) report('speed', name, speed);

        const spinCap = body === truck.chassis ? limits.maxChassisSpin : limits.maxWheelSpin;
        if (Math.abs(body.angularVelocity) > spinCap) {
            report('spin', name, body.angularVelocity);
        }

        const { bounds } = limits;
        const { x, y } = body.position;
        if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) {
            report('out-of-bounds', name, x < bounds.minX || x > bounds.maxX ? x : y);
        }
    }

    truck.suspension.forEach((unit, index) => {
        if (!bodyIsFinite(unit.wheel) || !bodyIsFinite(unit.chassis)) return;
        unit.measure();
        const stretch = hubStretch(unit);
        if (stretch > limits.maxHubStretch) {
            report('hub-detached', index === 0 ? 'wheelA' : 'wheelB', stretch);
        }
    });

    return violations;
}

/**
 * Put one body at `position`, upright and still, even if its current state is
 * garbage. Matter's setters work on deltas (`position - body.position`), and
 * NaN minus anything is still NaN, so a poisoned body has to be rebuilt from the
 * pristine vertices captured when the truck was built.
 */
export function placeBody(body, position) {
    const recoverable = bodyIsFinite(body);

    if (recoverable) {
        Body.setAngle(body, 0);
        Body.setPosition(body, position);
    } else {
        body.position.x = position.x;
        body.position.y = position.y;
        body.positionPrev.x = position.x;
        body.positionPrev.y = position.y;
        body.angle = 0;
        body.anglePrev = 0;
        body.angularVelocity = 0;
        body.angularSpeed = 0;
        body.velocity.x = 0;
        body.velocity.y = 0;
        body.speed = 0;
        body.force.x = 0;
        body.force.y = 0;
        body.torque = 0;

        // Rebuilds vertices, axes and bounds around body.position. Mass survives:
        // setVertices recomputes it from density * area, and Body.setMass keeps
        // density in step with any mass we set by hand.
        Body.setVertices(body, body.localVertices.map(v => ({
            x: v.x + position.x,
            y: v.y + position.y
        })));
    }

    Body.setVelocity(body, { x: 0, y: 0 });
    Body.setAngularVelocity(body, 0);
}

/** Drop the whole truck back into a known-good layout around `position`. */
export function repairTruck(truck, position) {
    const anchor = isFiniteVector(position) ? position : truck.spawnChassisPosition;
    const t = truck.tuning;

    placeBody(truck.chassis, { x: anchor.x, y: anchor.y });

    for (const unit of truck.suspension) {
        placeBody(unit.wheel, {
            x: anchor.x + unit.anchorLocal.x,
            y: anchor.y + unit.anchorLocal.y + (t.restLength - t.staticSag)
        });
        unit.measure();
    }

    placeBody(truck.driver, { x: anchor.x, y: anchor.y - t.chassisHeight });

    truck.safetyRepairs++;
    truck.lastRepairAt = truck.simTime;
}

/**
 * Check and correct. Returns the violations that were found this step.
 * Repairs are deliberately minimal: clamp what can be clamped, and only
 * teleport when the state is unusable.
 */
export function enforceTruckSafety(truck, limits = SAFETY_LIMITS) {
    const violations = inspectTruck(truck, limits);
    truck.safetyViolations = violations;

    if (violations.length === 0) {
        // Remember a state we know is good, to fall back to later.
        if (truck.grounded) {
            truck.lastSafePosition = { x: truck.chassis.position.x, y: truck.chassis.position.y };
        }
        return violations;
    }

    const fatal = violations.some(v => v.code === 'non-finite' || v.code === 'out-of-bounds');
    if (fatal) {
        repairTruck(truck, truck.lastSafePosition);
        return violations;
    }

    for (const violation of violations) {
        const body = truck.namedParts[violation.part];
        if (!body) continue;

        if (violation.code === 'speed') {
            const speed = speedOf(body);
            const scale = limits.maxSpeed / speed;
            Body.setVelocity(body, { x: body.velocity.x * scale, y: body.velocity.y * scale });
        } else if (violation.code === 'spin') {
            const cap = body === truck.chassis ? limits.maxChassisSpin : limits.maxWheelSpin;
            Body.setAngularVelocity(body, Math.sign(body.angularVelocity) * cap);
        } else if (violation.code === 'hub-detached') {
            const unit = truck.suspension.find(u => u.wheel === body);
            if (unit) {
                Body.setPosition(body, unit.restHubWorld());
                Body.setVelocity(body, { ...truck.chassis.velocity });
                truck.safetyRepairs++;
            }
        }
    }

    truck.safetyViolations = violations;
    return violations;
}
