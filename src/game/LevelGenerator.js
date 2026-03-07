import Matter from 'matter-js';

export class LevelGenerator {
    constructor(world) {
        this.world = world;
        this.chunks = [];
        this.chunkWidth = 1000;
        this.lastX = -500;
        this.lastY = 300;

        this.currentHue = 0; // Tracks rainbow progression
        this.groundColor = '#1f6feb'; // Default fallback
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

            // Generate shifting rainbow color for ground
            this.currentHue = (this.currentHue + 8) % 360; // Advance hue incrementally
            const blockColor = `hsl(${this.currentHue}, 70%, 50%)`;
            const blockStroke = `hsl(${this.currentHue}, 80%, 40%)`;

            const segment = Matter.Bodies.rectangle(midX, midY + 150, width, 300, {
                isStatic: true,
                angle: angle,
                friction: 0.8,
                render: {
                    fillStyle: blockColor,
                    strokeStyle: blockStroke,
                    lineWidth: 4
                }
            });

            bodies.push(segment);

            // 15% chance to spawn a boost pad on mostly flat/uphill terrain
            if (Math.random() < 0.15 && type >= 0.3) {
                const boostWidth = 80;
                const boostHeight = 20;

                // Position it on top of the segment
                const padX = midX;
                const padY = midY - boostHeight / 2 - 5; // Slightly above ground

                const boostPad = Matter.Bodies.rectangle(padX, padY, boostWidth, boostHeight, {
                    isStatic: true,
                    isSensor: true,
                    angle: angle,
                    label: 'boost_pad',
                    render: {
                        fillStyle: '#ff9800',
                        strokeStyle: '#ffffff',
                        lineWidth: 2
                    }
                });
                bodies.push(boostPad);
            } else if (Math.random() < 0.3) {
                // 30% chance to spawn a coin if no boost pad
                // Spawn it floating in the air a bit
                const coinY = midY - 60 - Math.random() * 60;
                const coin = Matter.Bodies.circle(midX, coinY, 15, {
                    isStatic: true,
                    isSensor: true,
                    label: 'coin',
                    render: {
                        fillStyle: '#ffd700', // Gold
                        strokeStyle: '#d4af37', // Darker gold outline
                        lineWidth: 3
                    }
                });
                bodies.push(coin);
            }

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
