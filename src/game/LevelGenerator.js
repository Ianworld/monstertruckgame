import Matter from 'matter-js';

export const GROUND_Y = 250;
export const APRON_START = -800;
export const APRON_END = 1400;

/**
 * Builds a course out of terrain and obstacles.
 *
 * Courses are written against the cursor API below (see Courses.js): each terrain
 * call extends the track from wherever the last one finished and moves the cursor,
 * and each obstacle call decorates the section that was just built. That keeps a
 * course readable as a description of a ride:
 *
 *     track.hill(1400, 160).coins();
 *     track.ramp(700, -260).boost(0.5);
 *     track.dip(1000, 180);
 *
 * Everything placed on the track is positioned against `groundYAt()`, a polyline of
 * the real drivable surface recorded as segments are built - never against whatever
 * the terrain height happened to be when the last section ended.
 *
 * Pass `world = null` for a dry run: the surface and markers are still computed but
 * no physics bodies are made, which is how the menu draws course previews.
 */
export class LevelGenerator {
    constructor(world) {
        this.world = world;
        this.dryRun = !world;

        this.startX = 0;
        this.finishX = 20000;
        this.trackBodies = [];
        this.surface = [];
        this.markers = [];        // {type, x, y} for previews and tests

        this.cursor = { x: APRON_START, y: GROUND_Y };
        this.sectionStart = APRON_START;
        this.baseHue = 120;
        this.hueSpread = 45;
        this.hueStep = 6;
        this.stripIndex = 0;
    }

    // ------------------------------------------------------------------ build

    /** Lay out a whole course, including the start apron and run-off. */
    build(course) {
        this.trackBodies = [];
        this.surface = [];
        this.markers = [];
        this.cursor = { x: APRON_START, y: GROUND_Y };
        this.baseHue = course.palette?.hue ?? 120;
        this.hueSpread = course.palette?.spread ?? 45;
        this.hueStep = course.palette?.step ?? 6;
        this.stripIndex = 0;

        // Every course starts on the same flat apron. The trucks spawn here and
        // settle during the countdown, so a course cannot forget to provide it.
        this.addSegment(APRON_START, GROUND_Y, APRON_END, GROUND_Y, this.baseHue, '#2ea043');
        this.cursor = { x: APRON_END, y: GROUND_Y };
        this.sectionStart = APRON_END;

        course.build(this);

        // Level out, then a generous run-off so nobody has to brake to win.
        this.flat(400);
        this.finishX = Math.round(this.cursor.x);
        this.flat(4000);

        this.addWall(this.cursor.x + 200);
        this.addWall(APRON_START - 100);

        return this;
    }

    // -------------------------------------------------------- cursor terrain

    /** Flat run. */
    flat(length) {
        return this.section(() => {
            this.strip(this.cursor.x + length, this.cursor.y);
        });
    }

    /** Straight incline. Negative `drop` climbs. */
    slope(length, drop) {
        return this.section(() => {
            this.strip(this.cursor.x + length, this.cursor.y + drop);
        });
    }

    /** Smooth up-and-over. `height` is how far it rises before coming back down. */
    hill(length, height, steps = 10) {
        return this.section(() => {
            const startX = this.cursor.x;
            const startY = this.cursor.y;
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                // A full sine period: up, over, and back to the starting height.
                this.strip(startX + length * t, startY - Math.sin(t * Math.PI) * height);
            }
        });
    }

    /**
     * A scoop out of the track. Drive down through it, or carry enough speed to
     * fly it - either way you come out the far side, which is why these are dips
     * and not holes. Nothing on any course can drop a player into the void.
     */
    dip(length, depth, steps = 10) {
        return this.section(() => {
            const startX = this.cursor.x;
            const startY = this.cursor.y;
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                this.strip(startX + length * t, startY + Math.sin(t * Math.PI) * depth);
            }
        });
    }

    /**
     * Washboard bumps. The suspension eats these; they are here to be felt.
     *
     * Two things keep them fun rather than fatal. The wavelength has to be well
     * clear of the 116px wheelbase - at 230px the wheels sat in neighbouring
     * troughs and the chassis grounded out on the crest between them, which
     * stopped a full-throttle truck dead. And eight samples per bump keeps them
     * curved; at four the sine samples only its peaks and zeros, so you get a
     * triangle wave with 46-degree faces.
     */
    whoops(count, height = 24, spacing = 400) {
        return this.section(() => {
            const startX = this.cursor.x;
            const startY = this.cursor.y;
            const steps = count * 8;
            const length = count * spacing;
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                this.strip(startX + length * t, startY - Math.sin(t * count * Math.PI * 2) * height);
            }
        });
    }

    /** Straight launch ramp. Follow it with a drop and you have a jump. */
    ramp(length, rise) {
        return this.slope(length, -Math.abs(rise));
    }

    /** Slick going. Same shape as flat ground, almost no grip. */
    ice(length, drop = 0) {
        return this.section(() => {
            this.strip(this.cursor.x + length, this.cursor.y + drop, {
                friction: 0.02,
                color: '#a5d8f3',
                stroke: '#7fb8d9'
            });
        });
    }

    // ------------------------------------------------------------- obstacles
    // These decorate the section just built. `t` is a fraction along it.

    boost(t = 0.5) {
        const x = this.pointInSection(t);
        this.addSensor(x, this.groundYAt(x) - 16, 90, 20, 'boost_pad', {
            fillStyle: '#ff9800', strokeStyle: '#ffffff', lineWidth: 3
        });
        return this;
    }

    /** Trampoline pad: straight up, for height rather than speed. */
    spring(t = 0.5) {
        const x = this.pointInSection(t);
        this.addSensor(x, this.groundYAt(x) - 14, 110, 22, 'spring_pad', {
            fillStyle: '#22d3a6', strokeStyle: '#ffffff', lineWidth: 3
        });
        return this;
    }

    mud(from = 0.1, to = 0.9) {
        const startX = this.pointInSection(from);
        const endX = this.pointInSection(to);
        const centreX = (startX + endX) / 2;
        this.addSensor(centreX, this.groundYAt(centreX) - 15, endX - startX, 30, 'mud_pit', {
            fillStyle: '#4e342e', strokeStyle: '#3e2723', lineWidth: 2
        });
        return this;
    }

    /**
     * A stack of crates to smash. Light enough that a monster truck sends them
     * flying rather than being stopped by them - that is the whole point of them.
     */
    crates(columns = 3, rows = 2, t = 0.5) {
        const size = 46;
        const baseX = this.pointInSection(t) - (columns * size) / 2;

        for (let column = 0; column < columns; column++) {
            for (let row = 0; row < rows; row++) {
                const x = baseX + column * (size + 2) + size / 2;
                const y = this.groundYAt(x) - size / 2 - row * (size + 1) - 2;
                this.addCrate(x, y, size);
            }
        }
        return this;
    }

    /** Low roof. You can drive it flat out, but you cannot jump inside it. */
    tunnel(length, clearance = 230) {
        return this.section(() => {
            const startX = this.cursor.x;
            this.strip(startX + length, this.cursor.y);

            const midX = startX + length / 2;
            const roofY = this.groundYAt(midX) - clearance;
            // Labelled so it is never mistaken for drivable ground - it is solid
            // and static like the track, but it is above you, not under you.
            this.addStatic(midX, roofY - 40, length, 80, {
                fillStyle: '#30363d', strokeStyle: '#8b949e', lineWidth: 3
            }, 'tunnel_roof');
            this.markers.push({ type: 'tunnel', x: midX, y: roofY });
        });
    }

    /** A run of coins following the terrain of the section just built. */
    coins(height = 90, wobble = 28) {
        const spacing = 120;
        const from = this.sectionStart;
        const to = this.cursor.x;
        const count = Math.floor((to - from) / spacing);

        for (let i = 0; i < count; i++) {
            const x = from + i * spacing + spacing / 2;
            const y = this.groundYAt(x) - height + Math.sin(i * 0.5) * wobble;
            this.addSensor(x, y, 32, 32, 'coin', {
                fillStyle: '#ffd700', strokeStyle: '#d4af37', lineWidth: 3
            }, true);
        }
        return this;
    }

    // ------------------------------------------------------------- internals

    /** Run a terrain builder, remembering where the section started. */
    section(build) {
        this.sectionStart = this.cursor.x;
        build();
        return this;
    }

    /** Absolute x at fraction `t` through the section just built. */
    pointInSection(t) {
        return this.sectionStart + (this.cursor.x - this.sectionStart) * t;
    }

    /** Extend the track from the cursor to (x, y) and move the cursor there. */
    strip(x, y, options = {}) {
        this.addSegment(this.cursor.x, this.cursor.y, x, y, this.nextHue(), options.color, options);
        this.cursor = { x, y };
    }

    /**
     * Colour for the next block: a gentle sweep back and forth WITHIN the course's
     * palette band, rather than a hue that keeps incrementing.
     *
     * Adding a fixed step each block runs the whole spectrum every ~50 segments,
     * so Scrapyard's purple had turned cyan by 3,000px and no course kept the look
     * its preview promised.
     */
    nextHue() {
        this.stripIndex++;
        const wave = Math.sin((this.stripIndex * this.hueStep * Math.PI) / 180);
        return (this.baseHue + wave * this.hueSpread + 360) % 360;
    }

    /**
     * One block of track. Its top face runs from (x1,y1) to (x2,y2) - including
     * when those differ, which is the whole point: an axis-aligned version would
     * silently flatten sloped arguments to their average.
     */
    addSegment(x1, y1, x2, y2, hue = 120, customColor = null, options = {}) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);

        this.recordSurface(x1, y1, x2, y2);
        if (this.dryRun) return;

        // Offset the centre PERPENDICULAR to the slope, not straight down in world
        // space. Sinking it by 150 in world y leaves the top face of a rotated
        // block somewhere else entirely.
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        const centreX = midX - 150 * Math.sin(angle);
        const centreY = midY + 150 * Math.cos(angle);

        const fill = customColor || `hsl(${hue}, 70%, 50%)`;
        const stroke = options.stroke || (customColor ? '#ffffff' : `hsl(${hue}, 80%, 40%)`);

        // Overlap neighbours slightly. Butt-jointed blocks leave a notch at every
        // convex joint, and a 37px tyre dropping into one is a free faceplant.
        const segment = Matter.Bodies.rectangle(centreX, centreY, length + 12, 300, {
            isStatic: true,
            angle,
            friction: options.friction ?? 0.9,
            restitution: 0,
            render: { fillStyle: fill, strokeStyle: stroke, lineWidth: 4 }
        });

        this.trackBodies.push(segment);
        Matter.World.add(this.world, segment);
    }

    addSensor(x, y, width, height, label, render, isCircle = false) {
        this.markers.push({ type: label, x, y });
        if (this.dryRun) return;

        const body = isCircle
            ? Matter.Bodies.circle(x, y, width / 2, { isStatic: true, isSensor: true, label, render })
            : Matter.Bodies.rectangle(x, y, width, height, {
                isStatic: true,
                isSensor: true,
                angle: this.groundAngleAt(x),
                label,
                render
            });

        this.trackBodies.push(body);
        Matter.World.add(this.world, body);
    }

    addStatic(x, y, width, height, render, label = 'scenery') {
        if (this.dryRun) return;
        const body = Matter.Bodies.rectangle(x, y, width, height, {
            isStatic: true, friction: 0.6, label, render
        });
        this.trackBodies.push(body);
        Matter.World.add(this.world, body);
    }

    addCrate(x, y, size) {
        this.markers.push({ type: 'crate', x, y });
        if (this.dryRun) return;

        const crate = Matter.Bodies.rectangle(x, y, size, size, {
            // Light: about 3% of the chassis, so the truck scatters them.
            density: 0.0008,
            friction: 0.4,
            frictionAir: 0.02,
            restitution: 0.15,
            label: 'crate',
            render: { fillStyle: '#a1734b', strokeStyle: '#5d4037', lineWidth: 3 }
        });
        this.trackBodies.push(crate);
        Matter.World.add(this.world, crate);
    }

    addWall(x) {
        if (this.dryRun) return;
        const wall = Matter.Bodies.rectangle(x, this.groundYAt(x) - 500, 100, 1000, {
            isStatic: true,
            render: { fillStyle: '#ff4444' }
        });
        this.trackBodies.push(wall);
        Matter.World.add(this.world, wall);
    }

    // -------------------------------------------------------- surface queries

    recordSurface(x1, y1, x2, y2) {
        const last = this.surface[this.surface.length - 1];
        if (!last || last.x < x1) this.surface.push({ x: x1, y: y1 });
        this.surface.push({ x: x2, y: y2 });
    }

    /** Height of the track surface at `x`, interpolated between segment ends. */
    groundYAt(x) {
        const points = this.surface;
        if (points.length === 0) return GROUND_Y;
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
}
