import Matter from 'matter-js';
import { STEP_MS, clamp } from './TruckTuning.js';

/**
 * Owns the Matter world, the fixed-timestep loop and all rendering.
 *
 * Two things matter here beyond drawing:
 *
 * 1. FIXED TIMESTEP. The old loop handed rAF's raw delta straight to
 *    Engine.update, so spring behaviour changed with framerate and nothing was
 *    reproducible. Now real time goes into an accumulator and the solver only
 *    ever sees STEP_MS, with force-application hooks fired before each step.
 *
 * 2. CONTACT TAGGING. Matter keeps no per-body contact flag, so after every step
 *    we stamp the bodies that are touching something solid. That is what lets the
 *    trucks know they are actually on the ground instead of guessing from
 *    velocities (the old check thought the top of a jump arc was "grounded").
 */
export class PhysicsEngine {
    constructor() {
        this.engine = Matter.Engine.create({
            constraintIterations: 4,    // stiff trailing arms need the extra passes
            positionIterations: 8,
            velocityIterations: 5
        });
        this.world = this.engine.world;
        this.world.gravity.y = 2.6;

        this.fixedDelta = STEP_MS;
        this.accumulator = 0;
        this.maxStepsPerFrame = 5;      // beyond this we drop time rather than spiral
        this.stepCount = 0;

        this.contactStamp = 0;
        this.trucks = [];

        const headless = typeof document === 'undefined';
        this.canvas = headless
            ? { width: 1280, height: 720 }
            : document.createElement('canvas');
        this.ctx = headless ? null : this.canvas.getContext('2d');

        // Dual cameras for split screen
        this.p1Camera = { x: 0, y: 0, zoom: 0.75, smoothedSpeed: 0 };
        this.p2Camera = { x: 0, y: 0, zoom: 0.75, smoothedSpeed: 0 };

        this.bgShapes = [];
        for (let i = 0; i < 30; i++) {
            this.bgShapes.push({
                x: Math.random(),
                y: Math.random(),
                size: Math.random() * 40 + 20,
                type: Math.floor(Math.random() * 3),
                phase: Math.random() * Math.PI * 2,
                speed: Math.random() * 0.001 + 0.0005,
                hueOffset: Math.random() * 60
            });
        }
    }

    init(container) {
        if (!this.ctx) return;
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.zIndex = '1';
        container.appendChild(this.canvas);
        this.resize();
    }

    resize() {
        if (!this.ctx) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    // ------------------------------------------------------------ simulation

    addTruck(truck) {
        if (!this.trucks.includes(truck)) this.trucks.push(truck);
    }

    clearTrucks() {
        this.trucks.length = 0;
    }

    /**
     * Advance by real elapsed time, in fixed increments.
     * @returns {number} how many physics steps ran
     */
    update(dt) {
        this.accumulator += clamp(dt, 0, 250);

        let steps = 0;
        while (this.accumulator >= this.fixedDelta && steps < this.maxStepsPerFrame) {
            this.accumulator -= this.fixedDelta;
            this.stepFixed();
            steps++;
        }

        // Ran out of budget: throw the backlog away so a hitch cannot turn into a
        // slow-motion catch-up that flings every truck off the track.
        if (steps === this.maxStepsPerFrame) this.accumulator = 0;

        return steps;
    }

    /** One deterministic step. Tests drive this directly. */
    stepFixed() {
        for (const truck of this.trucks) truck.preStep(this.fixedDelta);

        Matter.Engine.update(this.engine, this.fixedDelta);

        this.tagContacts();
        this.stepCount++;
    }

    /**
     * Stamp every non-static body that is in a real (non-sensor) contact this step.
     * Sensors are skipped so coins and boost pads never read as ground.
     */
    tagContacts() {
        this.contactStamp++;
        const pairs = this.engine.pairs.list;

        for (let i = 0; i < pairs.length; i++) {
            const pair = pairs[i];
            if (!pair.isActive || pair.isSensor) continue;

            if (!pair.bodyA.isStatic) pair.bodyA.contactStamp = this.contactStamp;
            if (!pair.bodyB.isStatic) pair.bodyB.contactStamp = this.contactStamp;
        }
    }

    // --------------------------------------------------------------- cameras

    updateCameraForPlayer(camera, targetPos, speed, viewportHeight) {
        if (!targetPos) return;

        camera.smoothedSpeed += (speed - camera.smoothedSpeed) * 0.05;

        const isMobile = this.canvas.width < 768;
        const baseZoom = isMobile ? 0.5 : 0.75;

        const transitionSpeed = 30;
        const maxSpeedLimit = 68;   // roughly the truck's top speed, so the zoom-out
                                    // still reaches its full range at full chat
        let speedFactor;

        if (camera.smoothedSpeed <= transitionSpeed) {
            const t = camera.smoothedSpeed / transitionSpeed;
            speedFactor = (t * t) * 0.12;
        } else {
            const t = Math.min(1.0, (camera.smoothedSpeed - transitionSpeed) / (maxSpeedLimit - transitionSpeed));
            speedFactor = 0.12 + (t * 0.28);
        }

        const targetZoom = Math.max(0.45, baseZoom * (1 - speedFactor));
        camera.zoom += (targetZoom - camera.zoom) * 0.05;

        const screenOffset = isMobile ? 0.35 : 0.3;
        const targetX = targetPos.x - (this.canvas.width * screenOffset / camera.zoom);
        const targetY = targetPos.y - (viewportHeight * 0.58 / camera.zoom);

        camera.x += (targetX - camera.x) * 0.12;
        camera.y += (targetY - camera.y) * 0.09;
    }

    updateCameras(truck1Pos, truck1Speed, truck2Pos, truck2Speed) {
        const viewportHeight = this.canvas.height / 2;
        this.updateCameraForPlayer(this.p1Camera, truck1Pos, truck1Speed, viewportHeight);

        if (truck2Pos) {
            this.updateCameraForPlayer(this.p2Camera, truck2Pos, truck2Speed, viewportHeight);
        } else {
            this.updateCameraForPlayer(this.p2Camera, truck1Pos, truck1Speed, viewportHeight);
        }
    }

    // ------------------------------------------------------------- rendering

    /**
     * @param {object} track where the gantries go. startY/finishY are the ground
     *   heights at those points - hardcoding them left the start gantry hanging
     *   130px in the air and the finish flags buried.
     */
    renderSplitScreen(pulse = 0, track = {}) {
        if (!this.ctx) return;

        const marks = {
            startX: 0,
            finishX: 30000,
            startY: 250,
            finishY: 240,
            ...track
        };

        const width = this.canvas.width;
        const height = this.canvas.height;
        const halfHeight = height / 2;

        this.ctx.clearRect(0, 0, width, height);
        this.renderViewport(0, 0, width, halfHeight, this.p1Camera, pulse, marks);
        this.renderViewport(0, halfHeight, width, halfHeight, this.p2Camera, pulse, marks);

        // CENTER DIVIDER BAR
        this.ctx.save();
        this.ctx.fillStyle = '#0d1117';
        this.ctx.fillRect(0, halfHeight - 4, width, 8);

        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = '#58a6ff';
        this.ctx.strokeStyle = '#58a6ff';
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.moveTo(0, halfHeight);
        this.ctx.lineTo(width, halfHeight);
        this.ctx.stroke();

        this.ctx.shadowBlur = 0;
        this.ctx.font = '900 14px Outfit, sans-serif';
        this.ctx.textAlign = 'left';
        this.ctx.fillStyle = '#58a6ff';
        this.ctx.fillText('PLAYER 1 (TOP)', 20, halfHeight - 10);
        this.ctx.fillStyle = '#ff7b72';
        this.ctx.fillText('PLAYER 2 (BOTTOM)', 20, halfHeight + 20);
        this.ctx.restore();
    }

    renderViewport(vx, vy, vwidth, vheight, camera, pulse, marks) {
        const ctx = this.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.rect(vx, vy, vwidth, vheight);
        ctx.clip();

        this.drawBackground(vx, vy, vwidth, vheight, pulse);

        ctx.save();
        ctx.translate(vx, vy);
        ctx.scale(camera.zoom, camera.zoom);
        ctx.translate(-camera.x, -camera.y);

        // World-space rectangle this viewport can see, padded for big bodies.
        const pad = 300;
        const view = {
            minX: camera.x - pad,
            maxX: camera.x + vwidth / camera.zoom + pad,
            minY: camera.y - pad,
            maxY: camera.y + vheight / camera.zoom + pad
        };

        this.drawTrackBanners(marks, view);
        this.drawWorldBodies(view);
        for (const truck of this.trucks) this.drawTruck(truck, view);

        ctx.restore();
        ctx.restore();
    }

    drawBackground(vx, vy, vwidth, vheight, pulse) {
        const ctx = this.ctx;
        const bgGradient = ctx.createLinearGradient(0, vy, 0, vy + vheight);
        // The pulse is auto-ranged now, so it really does swing 0..1 on every kick.
        // Keep the response modest - this should read as rhythm, not as a strobe.
        const pulseAmt = Math.floor(pulse * 20);

        bgGradient.addColorStop(0, `rgb(${Math.min(255, 13 + pulseAmt)}, ${Math.min(255, 17 + Math.floor(pulseAmt * 0.5))}, ${Math.min(255, 23 + pulseAmt)})`);
        bgGradient.addColorStop(1, `rgb(${Math.min(255, 22 + pulseAmt)}, ${Math.min(255, 27 + Math.floor(pulseAmt * 0.5))}, ${Math.min(255, 34 + pulseAmt)})`);

        ctx.fillStyle = bgGradient;
        ctx.fillRect(vx, vy, vwidth, vheight);

        const time = performance.now();
        const baseHue = (time * 0.02) % 360;

        for (const shape of this.bgShapes) {
            ctx.save();
            const floatY = Math.sin(time * shape.speed + shape.phase) * 50;
            const floatX = Math.cos(time * shape.speed + shape.phase) * 50;

            const x = ((shape.x * vwidth) + floatX) % (vwidth + 200) - 100;
            const y = vy + (((shape.y * vheight) + floatY) % (vheight + 200) - 100);

            ctx.translate(x < -100 ? x + vwidth + 200 : x, y < vy - 100 ? y + vheight + 200 : y);
            ctx.rotate((time * shape.speed * 2) + shape.phase);

            const currSize = shape.size * (1 + pulse * 0.85);
            ctx.globalAlpha = 0.4;
            ctx.fillStyle = `hsla(${baseHue + shape.hueOffset}, 70%, 50%, 0.3)`;

            ctx.beginPath();
            if (shape.type === 0) {
                ctx.arc(0, 0, currSize / 2, 0, Math.PI * 2);
            } else if (shape.type === 1) {
                ctx.rect(-currSize / 2, -currSize / 2, currSize, currSize);
            } else {
                ctx.moveTo(0, -currSize / 2);
                ctx.lineTo(currSize / 2, currSize / 2);
                ctx.lineTo(-currSize / 2, currSize / 2);
                ctx.closePath();
            }
            ctx.fill();
            ctx.restore();
        }
    }

    /** Terrain, coins, boost pads, mud. Trucks draw themselves, in their own order. */
    drawWorldBodies(view) {
        const ctx = this.ctx;
        const bodies = Matter.Composite.allBodies(this.world);

        for (const body of bodies) {
            if (body.isTruckPart) continue;
            if (body.render && body.render.visible === false) continue;

            const bounds = body.bounds;
            if (bounds.max.x < view.minX || bounds.min.x > view.maxX) continue;
            if (bounds.max.y < view.minY || bounds.min.y > view.maxY) continue;

            ctx.beginPath();
            if (body.circleRadius) {
                ctx.arc(body.position.x, body.position.y, body.circleRadius, 0, Math.PI * 2);
            } else {
                const vertices = body.vertices;
                ctx.moveTo(vertices[0].x, vertices[0].y);
                for (let j = 1; j < vertices.length; j++) ctx.lineTo(vertices[j].x, vertices[j].y);
                ctx.closePath();
            }

            if (body.label === 'boost_pad') {
                this.drawBoostPad(body);
            } else if (body.label === 'mud_pit') {
                ctx.fillStyle = '#3e2723';
                ctx.fill();
            } else {
                ctx.fillStyle = body.render?.fillStyle || '#8b949e';
                ctx.fill();
            }

            if (body.render?.strokeStyle) {
                ctx.lineWidth = body.render.lineWidth || 2;
                ctx.strokeStyle = body.render.strokeStyle;
                ctx.stroke();
            }
        }
    }

    drawBoostPad(body) {
        const ctx = this.ctx;
        const t = performance.now();

        ctx.shadowBlur = 20 + Math.sin(t * 0.005) * 10;
        ctx.shadowColor = '#ffaa00';
        ctx.fillStyle = body.render?.fillStyle || '#ff9800';
        ctx.fill();
        ctx.shadowBlur = 0;

        for (let p = 0; p < 8; p++) {
            const px = body.position.x + Math.sin(t * 0.002 + p * 1.5) * 40;
            const yOffset = (t * 0.05 + p * 15) % 60;
            const py = body.position.y + 10 - yOffset;
            const alpha = Math.max(0, 1 - (yOffset / 60));

            ctx.beginPath();
            ctx.arc(px, py, 2 + Math.sin(t * 0.01 + p) * 1.5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 200, 0, ${alpha})`;
            ctx.fill();
        }
    }

    // ----------------------------------------------------------------- truck

    /**
     * Draw order is the whole trick: exhaust, arms, tyres, shocks, then bodywork.
     * The arms sit behind the tyres (they only show in the inboard gap when the
     * suspension articulates), the coilovers sit in FRONT of them so the springs
     * are actually visible, and the bodywork covers every top mount.
     */
    drawTruck(truck, view) {
        const state = truck.getRenderState();
        const bounds = state.bounds;
        if (bounds.max.x < view.minX - 200 || bounds.min.x > view.maxX + 200) return;

        const ctx = this.ctx;

        if (state.boosting) this.drawExhaust(state);
        for (const wheel of state.wheels) this.drawSuspensionArm(wheel);
        for (const wheel of state.wheels) this.drawWheel(wheel, state.rimColor);
        for (const wheel of state.wheels) this.drawShock(wheel, state.accentColor);

        // Bodywork
        const image = state.bodyImage;
        ctx.save();
        ctx.translate(state.chassis.x, state.chassis.y);
        ctx.rotate(state.chassis.angle);
        if (image && image.complete && image.naturalWidth > 0) {
            ctx.drawImage(image, -image.width / 2, -image.height / 2, image.width, image.height);
        } else {
            this.drawFallbackBody(state);
        }
        ctx.restore();

        // Driver
        const driverImage = state.driverImage;
        if (driverImage && driverImage.complete && driverImage.naturalWidth > 0) {
            ctx.save();
            ctx.translate(state.driver.x, state.driver.y);
            ctx.rotate(state.driver.angle);
            ctx.drawImage(driverImage, -driverImage.width / 2, -driverImage.height / 2,
                driverImage.width, driverImage.height);
            ctx.restore();
        }
    }

    drawFallbackBody(state) {
        const ctx = this.ctx;
        const { width, height } = state.chassis;
        ctx.fillStyle = state.accentColor;
        ctx.strokeStyle = '#0d1117';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.roundRect(-width / 2, -height / 2, width, height, 10);
        ctx.fill();
        ctx.stroke();
    }

    /** The A-arm from its chassis pivot out to the hub: shows articulation. */
    drawSuspensionArm(wheel) {
        const ctx = this.ctx;
        const dx = wheel.hub.x - wheel.armPivot.x;
        const dy = wheel.hub.y - wheel.armPivot.y;
        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length < 1) return;

        ctx.save();
        ctx.translate(wheel.armPivot.x, wheel.armPivot.y);
        ctx.rotate(Math.atan2(dy, dx));

        ctx.beginPath();
        ctx.moveTo(0, -7);
        ctx.lineTo(length, -5);
        ctx.lineTo(length, 5);
        ctx.lineTo(0, 7);
        ctx.closePath();
        ctx.fillStyle = '#30363d';
        ctx.fill();
        ctx.strokeStyle = '#161b22';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Pivot bolt
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#484f58';
        ctx.fill();
        ctx.strokeStyle = '#8b949e';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
    }

    /**
     * Coilover shock, drawn from the real mount to the real hub.
     *
     * The coil count is fixed and the pitch is whatever the current length
     * allows, so compression reads as the coils bunching up - the old version
     * spread a fixed 6 coils over a ~25px gap that never changed, which is why it
     * looked like a scribble. Colour runs hot as it approaches the bump stop.
     */
    drawShock(wheel, accentColor) {
        const ctx = this.ctx;
        const dx = wheel.hub.x - wheel.mount.x;
        const dy = wheel.hub.y - wheel.mount.y;
        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length < 6) return;

        const load = clamp(wheel.ratio, 0, 1);

        ctx.save();
        ctx.translate(wheel.mount.x, wheel.mount.y);
        ctx.rotate(Math.atan2(dy, dx));

        // Chrome piston shaft, mount to hub
        ctx.lineCap = 'round';
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#c9d1d9';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(length, 0);
        ctx.stroke();

        // Shock canister at the top
        const canLength = Math.min(length * 0.38, 24);
        ctx.fillStyle = '#30363d';
        ctx.strokeStyle = '#161b22';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-2, -7, canLength + 4, 14, 4);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(2, -3.5);
        ctx.lineTo(canLength, -3.5);
        ctx.strokeStyle = '#6e7681';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Coil spring over what is left of the shaft
        const springStart = canLength + 3;
        const springEnd = length - 7;
        const span = springEnd - springStart;

        if (span > 5) {
            const coils = 6;
            const amplitude = 7.5 + load * 3.5;      // squats fatter under load
            const heat = load * load;
            const springColor = heat > 0.02
                ? mixColor(accentColor, '#ff3b30', clamp(heat, 0, 1))
                : accentColor;

            ctx.beginPath();
            const samples = coils * 10;
            for (let i = 0; i <= samples; i++) {
                const t = i / samples;
                const x = springStart + span * t;
                const y = Math.sin(t * coils * Math.PI * 2) * amplitude;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.lineJoin = 'round';
            ctx.lineWidth = 6.5;
            ctx.strokeStyle = '#161b22';
            ctx.stroke();
            ctx.lineWidth = 4;
            ctx.strokeStyle = springColor;
            ctx.stroke();
        }

        // Top and bottom mounts
        for (const x of [0, length]) {
            ctx.beginPath();
            ctx.arc(x, 0, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#484f58';
            ctx.fill();
            ctx.strokeStyle = '#c9d1d9';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        if (wheel.bottomedOut) {
            ctx.beginPath();
            ctx.arc(length, 0, 11, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        ctx.restore();
    }

    /** Chunky monster-truck tyre. Squashes vertically on impact for weight. */
    drawWheel(wheel, rimColor) {
        const ctx = this.ctx;
        const r = wheel.radius;
        const squash = clamp(wheel.squash, 0, 0.4);

        if (wheel.grounded && squash > 0.05) this.drawDust(wheel, squash);

        ctx.save();
        ctx.translate(wheel.hub.x, wheel.hub.y);
        ctx.scale(1 + squash * 0.55, 1 - squash);   // world-vertical squash
        ctx.rotate(wheel.angle);

        // Tread lugs
        const lugs = 12;
        ctx.fillStyle = '#0b0d10';
        for (let i = 0; i < lugs; i++) {
            const a = (i / lugs) * Math.PI * 2;
            ctx.save();
            ctx.rotate(a);
            ctx.beginPath();
            ctx.moveTo(-r * 0.26, -r * 0.99);
            ctx.lineTo(r * 0.26, -r * 0.99);
            ctx.lineTo(r * 0.16, -r * 1.16);
            ctx.lineTo(-r * 0.16, -r * 1.16);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }

        // Carcass
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = '#17191c';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#0b0d10';
        ctx.stroke();

        // Sidewall ring
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.74, 0, Math.PI * 2);
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#24282e';
        ctx.stroke();

        // Rim and spokes
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = rimColor;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#0d1117';
        ctx.stroke();

        ctx.strokeStyle = 'rgba(13, 17, 23, 0.65)';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2);
            ctx.lineTo(Math.cos(a) * r * 0.44, Math.sin(a) * r * 0.44);
            ctx.stroke();
        }

        // Hub cap
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.17, 0, Math.PI * 2);
        ctx.fillStyle = '#e6edf3';
        ctx.fill();

        // Gloss
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.87, Math.PI * 1.15, Math.PI * 1.55);
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.stroke();

        ctx.restore();
    }

    drawDust(wheel, squash) {
        const ctx = this.ctx;
        const contactY = wheel.hub.y + wheel.radius * (1 - squash);
        const alpha = clamp(squash * 3, 0, 0.5);

        for (let i = 0; i < 3; i++) {
            const spread = (i - 1) * wheel.radius * 0.85;
            ctx.beginPath();
            ctx.arc(wheel.hub.x + spread, contactY - 4, wheel.radius * (0.3 + squash), 0, Math.PI * 2);
            ctx.fillStyle = `rgba(190, 180, 160, ${alpha * (1 - Math.abs(i - 1) * 0.4)})`;
            ctx.fill();
        }
    }

    drawExhaust(state) {
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(state.chassis.x, state.chassis.y);
        ctx.rotate(state.chassis.angle);

        const back = -state.chassis.width / 2;
        const flare = 60 + Math.random() * 60;

        ctx.beginPath();
        ctx.moveTo(back, -8);
        ctx.lineTo(back - flare, 4);
        ctx.lineTo(back, 16);
        ctx.closePath();
        ctx.fillStyle = Math.random() > 0.5 ? '#ffaa00' : '#ff4400';
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(back, -3);
        ctx.lineTo(back - flare * 0.55, 4);
        ctx.lineTo(back, 11);
        ctx.closePath();
        ctx.fillStyle = '#fff8e1';
        ctx.fill();
        ctx.restore();
    }

    // -------------------------------------------------------------- track art

    /** Start and finish gantries, planted on the ground rather than near it. */
    drawTrackBanners(marks, view) {
        const ctx = this.ctx;
        const { startX, startY, finishX, finishY } = marks;

        if (view.minX < startX + 400) {
            ctx.save();
            ctx.translate(startX, startY);

            // Post rises from the surface; banner sits on top of it.
            ctx.fillStyle = '#2ea043';
            ctx.fillRect(-20, -200, 40, 200);

            ctx.fillStyle = '#1f6feb';
            ctx.fillRect(-150, -260, 300, 60);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 4;
            ctx.strokeRect(-150, -260, 300, 60);

            ctx.font = '900 32px Outfit, sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.fillText('START LINE', 0, -218);

            for (let c = -100; c <= 100; c += 20) {
                ctx.fillStyle = ((c / 20) % 2 === 0) ? '#ffffff' : '#000000';
                ctx.fillRect(c, -10, 20, 20);
            }
            ctx.restore();
        }

        if (view.maxX < finishX - 400 || view.minX > finishX + 400) return;

        ctx.save();

        for (let yPost = finishY - 300; yPost < finishY; yPost += 20) {
            ctx.fillStyle = ((yPost / 20) % 2 === 0) ? '#ffffff' : '#000000';
            ctx.fillRect(finishX - 25, yPost, 50, 20);
        }

        ctx.fillStyle = '#ff9800';
        ctx.fillRect(finishX - 200, finishY - 360, 400, 80);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 5;
        ctx.strokeRect(finishX - 200, finishY - 360, 400, 80);

        for (let bx = finishX - 190; bx < finishX + 190; bx += 20) {
            for (let by = finishY - 350; by < finishY - 330; by += 20) {
                ctx.fillStyle = (((bx + by) / 20) % 2 === 0) ? '#ffffff' : '#000000';
                ctx.fillRect(bx, by, 20, 20);
            }
        }

        ctx.font = '900 36px Outfit, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#000000';
        ctx.fillText('FINISH LINE', finishX, finishY - 290);
        ctx.shadowBlur = 0;

        for (let c = finishX - 120; c <= finishX + 120; c += 20) {
            ctx.fillStyle = ((c / 20) % 2 === 0) ? '#ffffff' : '#000000';
            ctx.fillRect(c, finishY - 10, 20, 20);
        }
        ctx.restore();
    }
}

/** Blend two #rrggbb colours. Used for the spring heating up near the bump stop. */
function mixColor(from, to, amount) {
    const parse = (hex) => {
        const value = hex.replace('#', '');
        const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value;
        return [
            parseInt(full.slice(0, 2), 16),
            parseInt(full.slice(2, 4), 16),
            parseInt(full.slice(4, 6), 16)
        ];
    };

    try {
        const a = parse(from);
        const b = parse(to);
        const channel = (i) => Math.round(a[i] + (b[i] - a[i]) * amount);
        return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
    } catch {
        return to;
    }
}
