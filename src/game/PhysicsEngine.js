import Matter from 'matter-js';

export class PhysicsEngine {
    constructor() {
        this.engine = Matter.Engine.create();
        this.world = this.engine.world;

        // Set slightly heavier gravity for fun, bouncy physics
        this.world.gravity.y = 1.5;

        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');

        this.camera = { x: 0, y: 0, zoom: 1 };
        this.smoothedSpeed = 0; // Low-pass filter for zoom scaling

        // Background particles/shapes
        this.bgShapes = [];
        for (let i = 0; i < 30; i++) {
            this.bgShapes.push({
                x: Math.random(), // 0-1 relative to screen width
                y: Math.random(), // 0-1 relative to screen height
                size: Math.random() * 40 + 20,
                type: Math.floor(Math.random() * 3), // 0: circle, 1: square, 2: triangle
                phase: Math.random() * Math.PI * 2,
                speed: Math.random() * 0.001 + 0.0005,
                hueOffset: Math.random() * 60
            });
        }
    }

    init(container) {
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.zIndex = '1';
        container.appendChild(this.canvas);
        this.resize();
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    update(dt) {
        Matter.Engine.update(this.engine, dt);
    }

    updateCamera(targetPosArray, maxSpeed = 0) {
        if (!Array.isArray(targetPosArray)) {
            targetPosArray = [targetPosArray];
        }

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        targetPosArray.forEach(pos => {
            if (pos.x < minX) minX = pos.x;
            if (pos.x > maxX) maxX = pos.x;
            if (pos.y < minY) minY = pos.y;
            if (pos.y > maxY) maxY = pos.y;
        });

        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;

        const dist = Math.abs(maxX - minX);
        const maxDistAllowed = this.canvas.width * 0.5;

        // Base zoom level depending on screen width (mobile screens need to view more initially)
        const isMobile = this.canvas.width < 768;
        const isLandscape = this.canvas.width > this.canvas.height;

        let baseZoom = isMobile ? 0.45 : 1.0;

        if (isMobile && isLandscape) {
            baseZoom = 0.35; // Zoom out more for landscape mobile
        }

        // Apply a low-pass filter to the speed to prevent sudden camera shaking/jitters
        this.smoothedSpeed += (maxSpeed - this.smoothedSpeed) * 0.05;

        // Dynamically adjust zoom out based on truck speed
        // Non-linear ramp up to 35mph, then linear up to 100mph, max 50% zoom reduction
        let speedFactor = 0;
        const transitionSpeed = 35;
        const maxSpeedLimit = 100;

        if (this.smoothedSpeed <= transitionSpeed) {
            // Quadratic ramp: 0 to transitionSpeed maps to a small portion of the 50% reduction
            // For example, at 35mph, let's say it reduces zoom by 15%
            const t = this.smoothedSpeed / transitionSpeed;
            speedFactor = (t * t) * 0.15; // 0 to 0.15 reduction
        } else {
            // Linear from 35mph to 100mph, mapping the remaining 0.15 to 0.50 reduction
            const t = Math.min(1.0, (this.smoothedSpeed - transitionSpeed) / (maxSpeedLimit - transitionSpeed));
            speedFactor = 0.15 + (t * 0.35); // 0.15 to 0.50 reduction
        }

        const speedZoomModifier = 1.0 - speedFactor;
        baseZoom *= speedZoomModifier;

        let targetZoom = baseZoom;
        if (dist > maxDistAllowed) {
            targetZoom = maxDistAllowed / dist * baseZoom;
        }
        targetZoom = Math.max(0.1, Math.min(baseZoom, targetZoom));

        this.camera.zoom += (targetZoom - this.camera.zoom) * 0.05;

        // Keep truck midpoint roughly at 1/3 of the screen width factoring in zoom
        // On mobile, keep it a bit closer to center
        const screenOffset = isMobile ? 0.4 : 0.3;
        const targetX = midX - (this.canvas.width * screenOffset / this.camera.zoom);
        const targetY = midY - (this.canvas.height * 0.6 / this.camera.zoom);

        // Smooth camera follow
        this.camera.x += (targetX - this.camera.x) * 0.1;
        this.camera.y += (targetY - this.camera.y) * 0.05;
    }

    render(pulse = 0) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw background gradient with pulse effect
        const bgGradient = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);

        const pulseAmt = Math.floor(pulse * 30);
        const r1 = Math.min(255, 13 + pulseAmt);
        const g1 = Math.min(255, 17 + Math.floor(pulseAmt * 0.5));
        const b1 = Math.min(255, 23 + pulseAmt);
        bgGradient.addColorStop(0, `rgb(${r1}, ${g1}, ${b1})`);

        const r2 = Math.min(255, 22 + pulseAmt);
        const g2 = Math.min(255, 27 + Math.floor(pulseAmt * 0.5));
        const b2 = Math.min(255, 34 + pulseAmt);
        bgGradient.addColorStop(1, `rgb(${r2}, ${g2}, ${b2})`);

        this.ctx.fillStyle = bgGradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // --- DRAW BACKGROUND DECORATIONS ---
        const time = performance.now();
        const baseHue = (time * 0.02) % 360; // Slowly change color over time

        for (let shape of this.bgShapes) {
            this.ctx.save();
            // Move slowly over time based on phase & speed
            const floatY = Math.sin(time * shape.speed + shape.phase) * 50;
            const floatX = Math.cos(time * shape.speed + shape.phase) * 50;

            // Allow wrapping around screen slightly past edges
            const x = ((shape.x * this.canvas.width) + floatX) % (this.canvas.width + 200) - 100;
            const y = ((shape.y * this.canvas.height) + floatY) % (this.canvas.height + 200) - 100;

            // Adjust to positive modulo properly
            const wrappedX = x < -100 ? x + this.canvas.width + 200 : x;
            const wrappedY = y < -100 ? y + this.canvas.height + 200 : y;

            this.ctx.translate(wrappedX, wrappedY);

            // Rotate shape
            this.ctx.rotate((time * shape.speed * 2) + shape.phase);

            // Pulse size with the music beat
            const currSize = shape.size * (1 + pulse * 1.5);

            this.ctx.globalAlpha = 0.5; // Allow for vivid but slightly transparent colors
            this.ctx.fillStyle = `hsla(${baseHue + shape.hueOffset}, 70%, 50%, 0.3)`;

            this.ctx.beginPath();
            if (shape.type === 0) {
                // Circle
                this.ctx.arc(0, 0, currSize / 2, 0, Math.PI * 2);
            } else if (shape.type === 1) {
                // Square
                this.ctx.rect(-currSize / 2, -currSize / 2, currSize, currSize);
            } else {
                // Triangle
                this.ctx.moveTo(0, -currSize / 2);
                this.ctx.lineTo(currSize / 2, currSize / 2);
                this.ctx.lineTo(-currSize / 2, currSize / 2);
                this.ctx.closePath();
            }
            this.ctx.fill();
            this.ctx.restore();
        }
        // -----------------------------------

        this.ctx.save();
        this.ctx.scale(this.camera.zoom, this.camera.zoom);
        this.ctx.translate(-this.camera.x, -this.camera.y);

        // Basic rendering of all bodies
        const bodies = Matter.Composite.allBodies(this.world);

        for (let body of bodies) {
            if (body.render && body.render.visible === false) {
                continue;
            }
            this.ctx.beginPath();

            // Note: Since bodies are now polygons (not pure circles), we draw their physical vertices
            const isWheel = body.label === 'Circle Body' || (body.vertices && body.vertices.length > 10 && body.area < 5000);

            if (body.label === 'Circle Body') {
                this.ctx.arc(body.position.x, body.position.y, body.circleRadius, 0, 2 * Math.PI);
            } else {
                const vertices = body.vertices;
                this.ctx.moveTo(vertices[0].x, vertices[0].y);
                for (let j = 1; j < vertices.length; j++) {
                    this.ctx.lineTo(vertices[j].x, vertices[j].y);
                }
                this.ctx.lineTo(vertices[0].x, vertices[0].y);
            }

            // Stylized vector art colors
            if (body.render?.image) {
                this.ctx.save();
                this.ctx.translate(body.position.x, body.position.y);
                this.ctx.rotate(body.angle);
                const img = body.render.image;
                const offX = body.render.imageOffsetX || 0;
                const offY = body.render.imageOffsetY || 0;

                // Draw rocket booster flame
                if (body.isBoosting) {
                    // Outer flame
                    this.ctx.beginPath();
                    this.ctx.moveTo(-80, 10);
                    this.ctx.lineTo(-160 - Math.random() * 50, 20); // Flickering tip
                    this.ctx.lineTo(-80, 30);
                    this.ctx.fillStyle = Math.random() > 0.5 ? '#ffaa00' : '#ff4400';
                    this.ctx.fill();

                    // Inner hot flame
                    this.ctx.beginPath();
                    this.ctx.moveTo(-80, 15);
                    this.ctx.lineTo(-120 - Math.random() * 20, 20);
                    this.ctx.lineTo(-80, 25);
                    this.ctx.fillStyle = '#ffffff';
                    this.ctx.fill();
                }

                this.ctx.drawImage(img, -img.width / 2 + offX, -img.height / 2 + offY, img.width, img.height);
                this.ctx.restore();
            } else {
                if (body.label === 'boost_pad') {
                    const time = performance.now();
                    // Make the pad pulse and glow
                    this.ctx.shadowBlur = 20 + Math.sin(time * 0.005) * 10;
                    this.ctx.shadowColor = '#ffaa00';
                    this.ctx.fillStyle = body.render?.fillStyle || '#ff9800';
                    this.ctx.fill();
                    this.ctx.shadowBlur = 0; // Reset shadow for other objects

                    // Draw floating glowing particles above it
                    for (let p = 0; p < 8; p++) {
                        // Spread particles horizontally
                        const pX = body.position.x + Math.sin(time * 0.002 + p * 1.5) * 40;
                        // Move particles upward and loop them
                        const yOffset = (time * 0.05 + p * 15) % 60;
                        const pY = body.position.y + 10 - yOffset;

                        // Fade out as they go higher
                        const alpha = Math.max(0, 1 - (yOffset / 60));
                        const size = 2 + Math.sin(time * 0.01 + p) * 1.5;

                        this.ctx.beginPath();
                        this.ctx.arc(pX, pY, size, 0, Math.PI * 2);
                        this.ctx.fillStyle = `rgba(255, 200, 0, ${alpha})`;
                        this.ctx.fill();
                    }
                } else {
                    this.ctx.fillStyle = body.render?.fillStyle || '#8b949e';
                    this.ctx.fill();
                }

                if (body.render?.strokeStyle) {
                    this.ctx.lineWidth = body.render?.lineWidth || 2;
                    this.ctx.strokeStyle = body.render?.strokeStyle;
                    this.ctx.stroke();
                }
            }

            // Draw angle indicator for wheels to show rotation
            if (isWheel) {
                // Approximate radius based on area if it's a polygon
                const radius = body.circleRadius || Math.sqrt(body.area / Math.PI);
                this.ctx.moveTo(body.position.x, body.position.y);
                this.ctx.lineTo(
                    body.position.x + Math.cos(body.angle) * radius,
                    body.position.y + Math.sin(body.angle) * radius
                );
                this.ctx.strokeStyle = '#ffffff';
                this.ctx.stroke();
            }
        }

        // Draw Constraints (Shocks and Arms)
        const constraints = Matter.Composite.allConstraints(this.world);
        for (let constraint of constraints) {
            if (!constraint.render || constraint.label === 'seat') continue;
            if (constraint.render.visible === false) continue;

            const getPos = (body, point) => {
                if (!body) return point;
                return Matter.Vector.add(body.position, Matter.Vector.rotate(point || { x: 0, y: 0 }, body.angle));
            };

            const p1 = getPos(constraint.bodyA, constraint.pointA);
            const p2 = getPos(constraint.bodyB, constraint.pointB);

            this.ctx.beginPath();

            if (constraint.label === 'shock') {
                // Draw as a coil spring
                // Instead of drawing straight from point A to point B (which tilts the spring as the wheel moves horizontally),
                // we want the spring to always face "down" relative to the chassis, extending exactly as far as the wheel currently is along that axis.

                // Get strictly downward vector relative to chassis
                const chassisAngle = constraint.bodyA.angle;
                // Add PI/2 to rotate 90 degrees (so it points "down" relative to chassis)
                const springAngle = chassisAngle + Math.PI / 2;

                // calculate strictly the projection of the wheel's local position onto this "down" vector
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;

                // Dot product of (dx, dy) and the downward vector (cos(springAngle), sin(springAngle))
                const projDist = dx * Math.cos(springAngle) + dy * Math.sin(springAngle);

                // Use absolute value in case math flips, but it should be positive since wheels are below
                const dist = Math.abs(projDist);

                const coils = 5;
                const width = 16;
                const endLen = 10;

                this.ctx.save();
                this.ctx.translate(p1.x, p1.y);
                this.ctx.rotate(springAngle);

                this.ctx.moveTo(0, 0);
                this.ctx.lineTo(endLen, 0);

                const coilLen = dist - endLen * 2;
                if (coilLen > 0) {
                    const step = coilLen / coils;
                    for (let i = 0; i < coils; i++) {
                        const x = endLen + i * step;
                        const nextX = endLen + (i + 1) * step;
                        this.ctx.lineTo(x + step * 0.25, -width / 2);
                        this.ctx.lineTo(x + step * 0.75, width / 2);
                        this.ctx.lineTo(nextX, 0);
                    }
                } else {
                    this.ctx.lineTo(dist - endLen, 0);
                }

                this.ctx.lineTo(dist, 0);
                this.ctx.restore();

            } else {
                // Normal solid line for arms
                this.ctx.moveTo(p1.x, p1.y);
                this.ctx.lineTo(p2.x, p2.y);
            }

            this.ctx.lineWidth = constraint.render.lineWidth || 2;
            this.ctx.strokeStyle = constraint.render.strokeStyle || '#ffffff';
            this.ctx.stroke();
        }

        this.ctx.restore();
    }
}
