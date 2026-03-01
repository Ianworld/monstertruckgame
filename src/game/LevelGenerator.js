import Matter from 'matter-js';

export class LevelGenerator {
    constructor(world) {
        this.world = world;
        this.chunks = [];
        this.chunkWidth = 1000;
        this.lastX = -500;
        this.lastY = 300;

        this.groundColor = '#1f6feb';
    }

    generateInitial() {
        // Flat start area
        this.addPlatform(-500, 300, 2000, 100, '#2ea043'); // Green starting area
        this.lastX = 1500;
        this.lastY = 300;

        for (let i = 0; i < 3; i++) {
            this.generateChunk();
        }
    }

    update(playerX) {
        // Generate new chunks ahead
        if (this.lastX - playerX < this.chunkWidth * 2) {
            this.generateChunk();
        }

        // Remove old chunks behind
        if (this.chunks.length > 6) {
            const oldChunk = this.chunks.shift();
            Matter.World.remove(this.world, oldChunk);
        }
    }

    generateChunk() {
        const bodies = [];
        const segmentCount = 10;
        const segmentWidth = this.chunkWidth / segmentCount;

        let cx = this.lastX;
        let cy = this.lastY;

        // Determine chunk type for variety
        const type = Math.random();

        for (let i = 0; i < segmentCount; i++) {
            let nextX = cx + segmentWidth;
            let nextY = cy;

            if (type < 0.3) {
                // Hilly
                nextY += (Math.random() - 0.5) * 200;
            } else if (type < 0.6) {
                // Ramp up
                nextY -= Math.random() * 100;
            } else if (type < 0.8) {
                // Drop
                nextY += Math.random() * 150;
            } else {
                // Flat
                nextY = cy;
            }

            // Generate a trapezoid segment
            const width = Math.sqrt(Math.pow(nextX - cx, 2) + Math.pow(nextY - cy, 2));
            const angle = Math.atan2(nextY - cy, nextX - cx);
            const midX = cx + (nextX - cx) / 2;
            const midY = cy + (nextY - cy) / 2;

            const segment = Matter.Bodies.rectangle(midX, midY + 150, width, 300, {
                isStatic: true,
                angle: angle,
                friction: 0.8,
                render: {
                    fillStyle: this.groundColor,
                    strokeStyle: '#388bfd',
                    lineWidth: 4
                }
            });

            bodies.push(segment);

            cx = nextX;
            cy = nextY;
        }

        this.lastX = cx;
        this.lastY = cy;

        this.chunks.push(bodies);
        Matter.World.add(this.world, bodies);
    }

    addPlatform(x, y, width, height, color) {
        const platform = Matter.Bodies.rectangle(x + width / 2, y + height / 2, width, height, {
            isStatic: true,
            friction: 0.8,
            render: {
                fillStyle: color || this.groundColor,
                lineWidth: 0
            }
        });
        this.chunks.push([platform]);
        Matter.World.add(this.world, platform);
    }
}
