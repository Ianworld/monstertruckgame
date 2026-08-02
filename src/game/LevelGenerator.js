import Matter from 'matter-js';

export class LevelGenerator {
    constructor(world) {
        this.world = world;
        this.finishX = 30000; // Fixed finish line position (takes ~60 seconds)
        this.startX = 0;
        this.currentHue = 0;
        this.trackBodies = [];

        // Polyline of the drivable top surface, recorded as segments are built.
        // Everything placed on the track (coins, boost pads, mud) is positioned
        // relative to this rather than to whatever the terrain height happened to
        // be at the end of the last segment.
        this.surface = [];
    }

    generateFixedTrack() {
        this.trackBodies = [];
        this.surface = [];
        this.currentHue = 120; // Start green

        // 1. FLAT STARTING AREA (-800 to 1200)
        this.addSegment(-800, 250, 1200, 250, 120, '#2ea043');

        let cx = 1200;
        let cy = 250;

        // Helper for adding smooth terrain segments
        const addHill = (length, heightDelta, hueShift = 5) => {
            const steps = 6;
            const stepWidth = length / steps;
            for (let i = 0; i < steps; i++) {
                const nextX = cx + stepWidth;
                // Sinusoidal curve for smooth natural hills
                const factor = Math.sin(((i + 1) / steps) * Math.PI - Math.PI / 2);
                const prevFactor = Math.sin((i / steps) * Math.PI - Math.PI / 2);
                const nextY = cy + (factor - prevFactor) * heightDelta;

                this.currentHue = (this.currentHue + hueShift) % 360;
                this.addSlopeSegment(cx, cy, nextX, nextY, this.currentHue);

                cx = nextX;
                cy = nextY;
            }
        };

        // Pickups take a HEIGHT ABOVE THE TRACK, not an absolute y, and are always
        // spawned after the terrain they sit on has been built.

        // --- SECTION 1: ROLLING HILLS & COIN RUN (1,200 to 7,000) ---
        addHill(1500, -120); // Uphill
        addHill(1500, 150);  // Downhill
        this.spawnCoins(cx - 2000, cx, 90);

        addHill(1400, -180); // Bigger hill
        this.spawnBoostPad(cx - 100);
        addHill(1400, 200);  // Drop
        this.spawnCoins(cx - 1400, cx, 100);

        // --- SECTION 2: SPEED RAMPS & BOOST CANYONS (7,000 to 14,000) ---
        // Big Ramp
        const rampX = cx + 800;
        const rampY = cy - 300;
        this.addSlopeSegment(cx, cy, rampX, rampY, 200);
        this.spawnBoostPad((cx + rampX) / 2);
        cx = rampX;
        cy = rampY;

        // Valley, with coins riding the descent
        addHill(1200, 350);
        this.spawnCoins(cx - 1000, cx, 110);

        // Catch ramp up
        addHill(2000, -300);
        this.spawnBoostPad(cx - 400);

        // Flat fast section
        const flatEnd = cx + 1800;
        this.addSlopeSegment(cx, cy, flatEnd, cy, 240);
        this.spawnCoins(cx, flatEnd, 85);
        cx = flatEnd;

        // --- SECTION 3: MUD PITS & ROUGH TERRAIN (14,000 to 21,000) ---
        addHill(1500, -150);
        addHill(1500, 150);

        // Mud Pit Section
        const mudStartX = cx;
        const mudEndX = cx + 1600;
        this.addSlopeSegment(mudStartX, cy, mudEndX, cy, 30);
        this.spawnMudPit(mudStartX + 200, 1200, 30);
        cx = mudEndX;

        // Bounce hills after mud
        addHill(1200, -200);
        this.spawnBoostPad(cx - 100);
        addHill(1200, 200);
        this.spawnCoins(cx - 2000, cx, 95);

        // --- SECTION 4: MEGA BOOST FLYWAY (21,000 to 27,000) ---
        // Steep launcher ramp
        const launchX = cx + 1000;
        const launchY = cy - 400;
        this.addSlopeSegment(cx, cy, launchX, launchY, 50);
        this.spawnBoostPad((cx + launchX) / 2);
        cx = launchX;
        cy = launchY;

        // Mega drop. Coins sit high here, so they reward a jump on the way down.
        addHill(2200, 400);
        this.spawnCoins(cx - 1800, cx - 200, 130);

        // Recovery stretch
        const stretchX = cx + 1800;
        this.addSlopeSegment(cx, cy, stretchX, cy, 180);
        this.spawnBoostPad(cx + 400);
        cx = stretchX;

        // --- SECTION 5: FINAL FINISH LINE JUMP (27,000 to 30,000) ---
        // Final Ramp up to Finish
        const finalRampX = 29500;
        const finalRampY = cy - 250;
        this.addSlopeSegment(cx, cy, finalRampX, finalRampY, 300);
        this.spawnBoostPad((cx + finalRampX) / 2);

        // Finish Line Platform at 30,000
        this.addSegment(finalRampX, finalRampY, 30000, 240, 120, '#2ea043');

        // RUN-OFF PLATFORM & END SAFETY WALL (30,000 to 34,000)
        this.addSegment(30000, 240, 34000, 240, 120, '#2ea043');

        // End Safety Wall
        const wall = Matter.Bodies.rectangle(33800, 0, 100, 1000, {
            isStatic: true,
            render: { fillStyle: '#ff4444' }
        });
        this.trackBodies.push(wall);
        Matter.World.add(this.world, wall);

        // Start Safety Wall (Left barrier at -800)
        const startWall = Matter.Bodies.rectangle(-800, 0, 100, 1000, {
            isStatic: true,
            render: { fillStyle: '#ff4444' }
        });
        this.trackBodies.push(startWall);
        Matter.World.add(this.world, startWall);
    }

    /**
     * One block of track. Its top face runs from (x1,y1) to (x2,y2) - including
     * when those differ, which is the whole point: the old axis-aligned version
     * silently flattened sloped arguments to their average, leaving a 42px wall
     * across the track at the finish line.
     */
    addSegment(x1, y1, x2, y2, hue = 120, customColor = null) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;

        // Offset the centre PERPENDICULAR to the slope, not straight down in world
        // space. Sinking it by 150 in world y leaves the top face of a rotated
        // block somewhere else entirely - on the steepest ramp here that moved the
        // real driving surface 56px sideways and tore a 110px notch in the crest.
        const centreX = midX - 150 * Math.sin(angle);
        const centreY = midY + 150 * Math.cos(angle);

        const blockColor = customColor || `hsl(${hue}, 70%, 50%)`;
        const blockStroke = customColor ? '#ffffff' : `hsl(${hue}, 80%, 40%)`;

        // Overlap the neighbouring segments slightly. Butt-jointed blocks leave a
        // notch at every convex joint, and a 37px tyre dropping into one is a free
        // faceplant.
        const segment = Matter.Bodies.rectangle(centreX, centreY, length + 12, 300, {
            isStatic: true,
            angle: angle,
            friction: 0.9,
            restitution: 0,
            render: {
                fillStyle: blockColor,
                strokeStyle: blockStroke,
                lineWidth: 4
            }
        });

        this.trackBodies.push(segment);
        Matter.World.add(this.world, segment);

        this.recordSurface(x1, y1, x2, y2);
    }

    /** Reads better at the call site when the segment is deliberately on a slope. */
    addSlopeSegment(x1, y1, x2, y2, hue = 120) {
        this.addSegment(x1, y1, x2, y2, hue);
    }

    // ------------------------------------------------------- surface queries

    /** Append a stretch of drivable surface. Segments are built left to right. */
    recordSurface(x1, y1, x2, y2) {
        const last = this.surface[this.surface.length - 1];
        if (!last || last.x < x1) this.surface.push({ x: x1, y: y1 });
        this.surface.push({ x: x2, y: y2 });
    }

    /** Height of the track surface at `x`, interpolated between segment ends. */
    groundYAt(x) {
        const points = this.surface;
        if (points.length === 0) return 250;
        if (x <= points[0].x) return points[0].y;
        if (x >= points[points.length - 1].x) return points[points.length - 1].y;

        let low = 0;
        let high = points.length - 1;
        while (high - low > 1) {
            const mid = (low + high) >> 1;
            if (points[mid].x <= x) low = mid;
            else high = mid;
        }

        const a = points[low];
        const b = points[high];
        const span = b.x - a.x;
        return span <= 0 ? b.y : a.y + (b.y - a.y) * ((x - a.x) / span);
    }

    /** Slope of the track surface at `x`, in radians. Flat ground is 0. */
    groundAngleAt(x) {
        const step = 30;
        return Math.atan2(this.groundYAt(x + step) - this.groundYAt(x - step), step * 2);
    }

    // ------------------------------------------------------------- placement

    /**
     * Boost pad laid ON the track, following its slope. Both position and angle
     * used to be passed in by hand, which left two of the seven pads buried.
     */
    spawnBoostPad(x, height = 16) {
        const boostPad = Matter.Bodies.rectangle(x, this.groundYAt(x) - height, 90, 20, {
            isStatic: true,
            isSensor: true,
            angle: this.groundAngleAt(x),
            label: 'boost_pad',
            render: {
                fillStyle: '#ff9800',
                strokeStyle: '#ffffff',
                lineWidth: 3
            }
        });
        this.trackBodies.push(boostPad);
        Matter.World.add(this.world, boostPad);
    }

    spawnMudPit(x, width = 800, height = 30) {
        const centreX = x + width / 2;
        const mudPit = Matter.Bodies.rectangle(centreX, this.groundYAt(centreX) - height / 2, width, height, {
            isStatic: true,
            isSensor: true,
            angle: this.groundAngleAt(centreX),
            label: 'mud_pit',
            render: {
                fillStyle: '#4e342e',
                strokeStyle: '#3e2723',
                lineWidth: 2
            }
        });
        this.trackBodies.push(mudPit);
        Matter.World.add(this.world, mudPit);
    }

    /**
     * A run of coins that follows the terrain.
     *
     * @param {number} height how far above the track surface to float them. The
     *   truck's silhouette covers roughly 0-120px, so anything under ~120 is
     *   collected by driving and anything above needs a hop.
     * @param {number} wobble amplitude of the gentle wave along the run
     */
    spawnCoins(startX, endX, height = 90, wobble = 28) {
        const spacing = 120;
        const count = Math.floor((endX - startX) / spacing);

        for (let i = 0; i < count; i++) {
            const cx = startX + i * spacing + spacing / 2;
            const cy = this.groundYAt(cx) - height + Math.sin(i * 0.5) * wobble;

            const coin = Matter.Bodies.circle(cx, cy, 16, {
                isStatic: true,
                isSensor: true,
                label: 'coin',
                render: {
                    fillStyle: '#ffd700',
                    strokeStyle: '#d4af37',
                    lineWidth: 3
                }
            });
            this.trackBodies.push(coin);
            Matter.World.add(this.world, coin);
        }
    }
}
