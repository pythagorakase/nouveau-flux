// Noise Engine - Perlin noise with FBM and domain warping for psychedelic effects

export class NoiseEngine {
    private perm: Uint8Array;
    private perm12: Uint8Array;

    constructor(seed?: number) {
        // Initialize permutation table
        this.perm = new Uint8Array(512);
        this.perm12 = new Uint8Array(512);

        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
            p[i] = i;
        }

        // Shuffle using seed (simple LCG)
        let s = seed ?? Math.floor(Math.random() * 2147483647);
        for (let i = 255; i > 0; i--) {
            s = (s * 1103515245 + 12345) & 0x7fffffff;
            const j = s % (i + 1);
            [p[i], p[j]] = [p[j], p[i]];
        }

        // Double the permutation table
        for (let i = 0; i < 512; i++) {
            this.perm[i] = p[i & 255];
            this.perm12[i] = this.perm[i] % 12;
        }
    }

    // Fade function for smooth interpolation
    private fade(t: number): number {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    // Linear interpolation
    private lerp(a: number, b: number, t: number): number {
        return a + t * (b - a);
    }

    // 2D gradient
    private grad2D(hash: number, x: number, y: number): number {
        const h = hash & 3;
        const u = h < 2 ? x : y;
        const v = h < 2 ? y : x;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    // 3D gradient vectors
    private static grad3 = [
        1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
        1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
        0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
    ];

    // 2D Perlin noise
    noise2D(x: number, y: number): number {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;

        x -= Math.floor(x);
        y -= Math.floor(y);

        const u = this.fade(x);
        const v = this.fade(y);

        const A = this.perm[X] + Y;
        const B = this.perm[X + 1] + Y;

        return this.lerp(
            this.lerp(
                this.grad2D(this.perm[A], x, y),
                this.grad2D(this.perm[B], x - 1, y),
                u
            ),
            this.lerp(
                this.grad2D(this.perm[A + 1], x, y - 1),
                this.grad2D(this.perm[B + 1], x - 1, y - 1),
                u
            ),
            v
        );
    }

    // 3D Perlin noise (for time dimension)
    noise3D(x: number, y: number, z: number): number {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const Z = Math.floor(z) & 255;

        x -= Math.floor(x);
        y -= Math.floor(y);
        z -= Math.floor(z);

        const u = this.fade(x);
        const v = this.fade(y);
        const w = this.fade(z);

        const A = this.perm[X] + Y;
        const AA = this.perm[A] + Z;
        const AB = this.perm[A + 1] + Z;
        const B = this.perm[X + 1] + Y;
        const BA = this.perm[B] + Z;
        const BB = this.perm[B + 1] + Z;

        const grad3 = NoiseEngine.grad3;
        const dot = (gi: number, x: number, y: number, z: number) => {
            const i = gi * 3;
            return grad3[i] * x + grad3[i + 1] * y + grad3[i + 2] * z;
        };

        return this.lerp(
            this.lerp(
                this.lerp(
                    dot(this.perm12[AA], x, y, z),
                    dot(this.perm12[BA], x - 1, y, z),
                    u
                ),
                this.lerp(
                    dot(this.perm12[AB], x, y - 1, z),
                    dot(this.perm12[BB], x - 1, y - 1, z),
                    u
                ),
                v
            ),
            this.lerp(
                this.lerp(
                    dot(this.perm12[AA + 1], x, y, z - 1),
                    dot(this.perm12[BA + 1], x - 1, y, z - 1),
                    u
                ),
                this.lerp(
                    dot(this.perm12[AB + 1], x, y - 1, z - 1),
                    dot(this.perm12[BB + 1], x - 1, y - 1, z - 1),
                    u
                ),
                v
            ),
            w
        );
    }

    // Fractal Brownian Motion
    fbm(
        x: number,
        y: number,
        time: number,
        octaves: number = 4,
        persistence: number = 0.5,
        lacunarity: number = 2
    ): number {
        let value = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            value += amplitude * this.noise3D(
                x * frequency,
                y * frequency,
                time
            );
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= lacunarity;
        }

        return value / maxValue;
    }

    // Domain-warped FBM for psychedelic "flowing" effect
    // This is the key to organic, melting movement
    warpedFbm(
        x: number,
        y: number,
        time: number,
        octaves: number = 4,
        persistence: number = 0.5,
        lacunarity: number = 2,
        warpStrength: number = 15
    ): { dx: number; dy: number } {
        // First layer of warping - distort the input coordinates
        const warpX = this.fbm(x + 100, y, time * 0.7, 2, 0.5, 2);
        const warpY = this.fbm(x, y + 100, time * 0.6, 2, 0.5, 2);

        // Apply warped coordinates
        const wx = x + warpX * warpStrength * 0.01;
        const wy = y + warpY * warpStrength * 0.01;

        // Second layer of warping for extra organic feel
        const warp2X = this.fbm(wx + 50, wy + 30, time * 0.5, 2, 0.5, 2);
        const warp2Y = this.fbm(wx + 30, wy + 50, time * 0.4, 2, 0.5, 2);

        const wwx = wx + warp2X * warpStrength * 0.005;
        const wwy = wy + warp2Y * warpStrength * 0.005;

        // Final displacement using fully warped coordinates
        const dx = this.fbm(wwx, wwy, time, octaves, persistence, lacunarity);
        const dy = this.fbm(wwx + 50, wwy + 50, time + 1000, octaves, persistence, lacunarity);

        return { dx, dy };
    }

    // Layered noise for rich psychedelic effect
    // Combines slow breathing, medium drift, and subtle shimmer
    psychedelicDisplacement(
        x: number,
        y: number,
        time: number,
        params: {
            noiseScale: number;
            octaves: number;
            persistence: number;
            lacunarity: number;
            warpStrength: number;
            breathingAmount: number;
        }
    ): { dx: number; dy: number } {
        const { noiseScale, octaves, persistence, lacunarity, warpStrength, breathingAmount } = params;

        // Layer 1: Slow, large undulations (breathing)
        const breathing = this.fbm(
            x * noiseScale * 0.3,
            y * noiseScale * 0.3,
            time * 0.2,
            2,
            0.5,
            2
        ) * breathingAmount;

        // Layer 2: Medium drift with domain warping (the psychedelic flow)
        const warped = this.warpedFbm(
            x * noiseScale,
            y * noiseScale,
            time,
            octaves,
            persistence,
            lacunarity,
            warpStrength
        );

        // Layer 3: Subtle high-frequency shimmer
        const shimmerX = this.noise3D(
            x * noiseScale * 3,
            y * noiseScale * 3,
            time * 2
        ) * 0.15;
        const shimmerY = this.noise3D(
            x * noiseScale * 3 + 100,
            y * noiseScale * 3,
            time * 2.3
        ) * 0.15;

        // Combine all layers
        return {
            dx: breathing * 0.5 + warped.dx + shimmerX,
            dy: breathing * 0.3 + warped.dy + shimmerY
        };
    }
}

// Singleton instance for convenience
let defaultEngine: NoiseEngine | null = null;

export function getNoiseEngine(seed?: number): NoiseEngine {
    if (!defaultEngine) {
        defaultEngine = new NoiseEngine(seed ?? 12345);
    }
    return defaultEngine;
}
