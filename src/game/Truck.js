import Matter from 'matter-js';
import { CharacterGraphics } from './CharacterGraphics.js';

export class Truck {
    constructor(world, config, startPos, physicsConfig = null) {
        this.world = world;
        this.physicsConfig = physicsConfig || {
            friction: 8.3,
            density: 0.05,
            accelForce: 9.5,
            maxAngularVel: 23.0,
            jumpForce: 25.0,
            suspensionStiffness: 0.15,
            suspensionDamping: 0.05,
            boostForce: 0.2
        };

        // Colors based on config
        const chassisColor = CharacterGraphics.getTruckColors(config.truckStyle)[0] || '#ff0000';

        // Group prevents truck parts from colliding with each other
        const group = Matter.Body.nextGroup(true);

        // Chassis
        const width = 160;
        const height = 60;

        // Generate SVG Image for Truck
        let svgString = CharacterGraphics.generateTruckSVG(config.truckStyle, chassisColor);
        // Hide the SVG tires since we have physical tires
        svgString = svgString.replace(/<circle cx="125" cy="250"[\s\S]*?fill="#333" \/>/g, '');
        svgString = svgString.replace(/<circle cx="325" cy="250"[\s\S]*?fill="#333" \/>/g, '');

        const truckImage = new Image();
        truckImage.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
        truckImage.width = 280;
        truckImage.height = 168;

        this.chassis = Matter.Bodies.rectangle(startPos.x, startPos.y - 100, width, height, {
            collisionFilter: { group: group },
            friction: 0.5,
            density: 0.015, // Increased density for more weight
            render: {
                image: truckImage,
                imageOffsetX: 0,
                imageOffsetY: -35
            },
            label: 'chassis'
        });

        // Wheels
        const wheelY = startPos.y - 40;
        const wheelRadius = 35;

        // Use a hexagon or decagon instead of a perfect circle to simulate large tire knobs
        // A polygon will physically catch on the terrain edges, giving massive friction
        const wheelSides = 24; // 24-sided polygon creates noticeable "knobs"

        // Symmetrical offsets for PERFECTLY centered chassis based on viewBox scale
        // viewBox width 500 mapped to 280 img width => 0.56 scale.
        // SVG wheel distance from center is 100. 100 * 0.56 = 56.
        const wheelOffsetX = 56;

        this.wheelA = Matter.Bodies.polygon(startPos.x - wheelOffsetX, wheelY, wheelSides, wheelRadius, {
            collisionFilter: { group: group },
            friction: this.physicsConfig.friction, // Extremely high friction
            restitution: 0.1, // Minimal bounce
            density: this.physicsConfig.density * 0.8, // Slightly lighter wheels so body has more mass authority
            render: { fillStyle: '#21262d', strokeStyle: '#8b949e', lineWidth: 4 }
        });

        this.wheelB = Matter.Bodies.polygon(startPos.x + wheelOffsetX, wheelY, wheelSides, wheelRadius, {
            collisionFilter: { group: group },
            friction: this.physicsConfig.friction,
            restitution: 0.1,
            density: this.physicsConfig.density * 0.8,
            render: { fillStyle: '#21262d', strokeStyle: '#8b949e', lineWidth: 4 }
        });

        // Vertical Shocks
        this.shockA = Matter.Constraint.create({
            bodyA: this.chassis,
            pointA: { x: -wheelOffsetX, y: -10 }, // Mount high up on chassis
            bodyB: this.wheelA,
            stiffness: this.physicsConfig.suspensionStiffness,
            damping: this.physicsConfig.suspensionDamping,
            length: 80, // Distance to allow wheels to hang
            label: 'shock',
            render: { strokeStyle: '#ffaa00', lineWidth: 4 }
        });

        this.shockB = Matter.Constraint.create({
            bodyA: this.chassis,
            pointA: { x: wheelOffsetX, y: -10 },
            bodyB: this.wheelB,
            stiffness: this.physicsConfig.suspensionStiffness,
            damping: this.physicsConfig.suspensionDamping,
            length: 80,
            label: 'shock',
            render: { strokeStyle: '#ffaa00', lineWidth: 4 }
        });

        // Horizontal tracking properties used in update()
        this.wheelOffsetX = wheelOffsetX;

        // Driver head
        const driverColor = config.driverStyle === 'gabby' ? '#4e342e' :
            config.driverStyle === 'daniel_tiger' ? '#ff9800' :
                config.driverStyle === 'nerd' ? '#ffdcb6' :
                    config.driverStyle === 'barbie' ? '#ffe082' : '#ffca28';

        const driverSvgString = CharacterGraphics.generateDriverSVG(config.driverStyle);
        const driverImage = new Image();
        driverImage.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(driverSvgString);
        driverImage.width = 60;
        driverImage.height = 60;

        this.driver = Matter.Bodies.circle(startPos.x, startPos.y - 150, 15, {
            collisionFilter: { group: group },
            render: {
                image: driverImage,
                imageOffsetX: 0,
                imageOffsetY: 0
            }
        });

        const seat = Matter.Constraint.create({
            bodyA: this.chassis,
            pointA: { x: 0, y: -height / 2 },
            bodyB: this.driver,
            stiffness: 0.8,
            length: 5
        });

        this.composite = Matter.Composite.create();
        Matter.Composite.add(this.composite, [
            this.chassis, this.wheelA, this.wheelB, this.driver,
            this.shockA, this.shockB, seat
        ]);

        Matter.World.add(this.world, this.composite);

        // Tracking
        this.lastJumpStart = 0;
        this.jumpDistance = 0;
        this.isAirborne = false;
        this.speed = 0;
        this.boostLevel = 100; // 0 to 100
        this.isBoosting = false;
    }

    getPosition() {
        return this.chassis.position;
    }

    getSpeed() {
        return Math.floor(this.speed);
    }

    getJumpMetrics() {
        return {
            current: Math.floor(this.jumpDistance)
        };
    }

    getBoostPercent() {
        return this.boostLevel;
    }

    updatePhysicsConfig(config) {
        this.physicsConfig = config;

        // Update live physical bodies
        Matter.Body.setDensity(this.wheelA, config.density);
        Matter.Body.setDensity(this.wheelB, config.density);
        this.wheelA.friction = config.friction;
        this.wheelB.friction = config.friction;

        // Update live springs
        this.shockA.stiffness = config.suspensionStiffness;
        this.shockA.damping = config.suspensionDamping;
        this.shockB.stiffness = config.suspensionStiffness;
        this.shockB.damping = config.suspensionDamping;
    }

    accelerate(dir) {
        // Apply torque to wheels for acceleration
        const maxAngularVelocity = this.physicsConfig.maxAngularVel;
        const force = this.physicsConfig.accelForce * dir;

        if (dir > 0 && this.wheelB.angularVelocity < maxAngularVelocity) {
            this.wheelB.torque = force;
            this.wheelA.torque = force;
        } else if (dir < 0 && this.wheelB.angularVelocity > -maxAngularVelocity) {
            this.wheelB.torque = force;
            this.wheelA.torque = force;
        }
    }

    jump() {
        if (!this.isAirborne) {
            // Strong upward velocity for jump
            Matter.Body.setVelocity(this.chassis, {
                x: this.chassis.velocity.x,
                y: -this.physicsConfig.jumpForce
            });

            // Add slight backward rotation for flair
            Matter.Body.setAngularVelocity(this.chassis, -0.15);
        }
    }

    boost() {
        if (this.boostLevel > 0) {
            this.isBoosting = true;

            // Calculate variable boost force
            let multiplier = 0;
            if (this.boostLevel >= 50) {
                multiplier = 1.2;
            } else {
                multiplier = (this.boostLevel / 50) * 1.2;
            }

            // Apply massive forward thrust to chassis
            const forceMagnitude = this.physicsConfig.boostForce * multiplier;
            const angle = this.chassis.angle;

            Matter.Body.applyForce(this.chassis, this.chassis.position, {
                x: Math.cos(angle) * forceMagnitude,
                y: Math.sin(angle) * forceMagnitude
            });

            // Dampen angular velocity to prevent flipping backwards from the sudden acceleration
            Matter.Body.setAngularVelocity(this.chassis, this.chassis.angularVelocity * 0.9);
        }
    }

    update(dt = 16) {
        // Enforce Stiff Horizontal Suspension mathematically
        const applyHorizontalSpring = (wheel, targetLocalX) => {
            if (!wheel || !this.chassis) return;

            // Direct math to avoid any Matter.Vector method issues
            const cosA = Math.cos(this.chassis.angle);
            const sinA = Math.sin(this.chassis.angle);

            const dx = wheel.position.x - this.chassis.position.x;
            const dy = wheel.position.y - this.chassis.position.y;

            // Current local X position of the wheel relative to chassis center
            const currentLocalX = dx * cosA + dy * sinA;
            const errorX = currentLocalX - targetLocalX;

            const angVel = this.chassis.angularVelocity;
            // Rotational velocity of the chassis at the wheel's location
            const rotVelWorldX = -angVel * dy;
            const rotVelWorldY = angVel * dx;
            const rotVelLocalX = rotVelWorldX * cosA + rotVelWorldY * sinA;

            const relVelX = wheel.velocity.x - this.chassis.velocity.x;
            const relVelY = wheel.velocity.y - this.chassis.velocity.y;
            const currentLocalVelX = relVelX * cosA + relVelY * sinA;

            const velocityErrorX = currentLocalVelX - rotVelLocalX;

            // Tuning values (Extremely small because Matter.js forces are tiny)
            // A typical force in Matter.js is 0.001 to 0.05
            const kX = 0.002;
            const dampingX = 0.004;

            let forceMag = -(kX * errorX) - (dampingX * velocityErrorX);

            // Multiply by mass to scale for the truck, but CAP IT to prevent explosions!
            let fX = forceMag * this.chassis.mass;

            const maxF = 2.0; // Hard clamp for physics safety
            if (fX > maxF) fX = maxF;
            if (fX < -maxF) fX = -maxF;

            // Apply the force vector in World space
            const forceX = cosA * fX;
            const forceY = sinA * fX;

            Matter.Body.applyForce(wheel, wheel.position, { x: forceX, y: forceY });
            Matter.Body.applyForce(this.chassis, wheel.position, { x: -forceX, y: -forceY });

            // SAFETY SNAP: If the wheel gets completely ripped out of place (usually above the chassis)
            // due to extreme forces, snap it back to its ideal resting position.
            const currentLocalY = -dx * sinA + dy * cosA;
            const isFlippedAboveChassis = currentLocalY < 0;
            const isTooFarHorizontal = Math.abs(errorX) > 100;

            if (isFlippedAboveChassis || isTooFarHorizontal) {
                // Calculate ideal world position for the wheel
                const idealWorldX = this.chassis.position.x + targetLocalX * cosA - 40 * sinA;
                const idealWorldY = this.chassis.position.y + targetLocalX * sinA + 40 * cosA;

                Matter.Body.setPosition(wheel, { x: idealWorldX, y: idealWorldY });
                Matter.Body.setVelocity(wheel, { ...this.chassis.velocity });
                Matter.Body.setAngularVelocity(wheel, this.chassis.angularVelocity);
            }
        };

        applyHorizontalSpring(this.wheelA, -this.wheelOffsetX);
        applyHorizontalSpring(this.wheelB, this.wheelOffsetX);

        // Handle boost drain/refill
        const ratePerSecond = 20.0;
        if (this.isBoosting) {
            this.boostLevel -= (ratePerSecond * dt / 1000);
            if (this.boostLevel < 0) this.boostLevel = 0;
        } else {
            this.boostLevel += (ratePerSecond * dt / 1000);
            if (this.boostLevel > 100) this.boostLevel = 100;
        }

        // Pass info to physics engine for visual rendering
        this.chassis.isBoosting = this.isBoosting && this.boostLevel > 0;

        // Reset flag for next frame
        this.isBoosting = false;

        // Calculate speed (magnitude of velocity)
        this.speed = Math.sqrt(
            this.chassis.velocity.x * this.chassis.velocity.x +
            this.chassis.velocity.y * this.chassis.velocity.y
        ) * 10;

        // Check if grounded
        // Simplified check: if vertical velocity is near zero and wheels are touching ground
        const prevAirborne = this.isAirborne;
        this.isAirborne = Math.abs(this.chassis.velocity.y) > 0.5;

        if (!prevAirborne && this.isAirborne) {
            // Takeoff
            this.lastJumpStart = this.chassis.position.x;
        }

        if (this.isAirborne) {
            // Update jump distance while in air
            this.jumpDistance = Math.max(0, this.chassis.position.x - this.lastJumpStart) / 10;
        } else if (prevAirborne && !this.isAirborne) {
            // Landed
            // Could trigger a minimal dust particle effect here
        }

        // Auto-righting logic (assist to keep the truck from fully flipping)
        if (this.chassis.angle > Math.PI / 3) {
            this.chassis.torque = -3;
        } else if (this.chassis.angle < -Math.PI / 3) {
            this.chassis.torque = 3;
        }
    }
}
