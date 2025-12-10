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

    // 4D gradient vectors (32 gradients for 4D noise)
    private static grad4 = [
        [0, 1, 1, 1], [0, 1, 1, -1], [0, 1, -1, 1], [0, 1, -1, -1],
        [0, -1, 1, 1], [0, -1, 1, -1], [0, -1, -1, 1], [0, -1, -1, -1],
        [1, 0, 1, 1], [1, 0, 1, -1], [1, 0, -1, 1], [1, 0, -1, -1],
        [-1, 0, 1, 1], [-1, 0, 1, -1], [-1, 0, -1, 1], [-1, 0, -1, -1],
        [1, 1, 0, 1], [1, 1, 0, -1], [1, -1, 0, 1], [1, -1, 0, -1],
        [-1, 1, 0, 1], [-1, 1, 0, -1], [-1, -1, 0, 1], [-1, -1, 0, -1],
        [1, 1, 1, 0], [1, 1, -1, 0], [1, -1, 1, 0], [1, -1, -1, 0],
        [-1, 1, 1, 0], [-1, 1, -1, 0], [-1, -1, 1, 0], [-1, -1, -1, 0],
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

    // 4D Perlin noise (for seamless looping via circular time path)
    noise4D(x: number, y: number, z: number, w: number): number {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const Z = Math.floor(z) & 255;
        const W = Math.floor(w) & 255;

        x -= Math.floor(x);
        y -= Math.floor(y);
        z -= Math.floor(z);
        w -= Math.floor(w);

        const fx = this.fade(x);
        const fy = this.fade(y);
        const fz = this.fade(z);
        const fw = this.fade(w);

        // Hash coordinates of the 16 corners of the hypercube
        const grad4 = NoiseEngine.grad4;
        const dot4 = (hash: number, dx: number, dy: number, dz: number, dw: number) => {
            const g = grad4[hash & 31];
            return g[0] * dx + g[1] * dy + g[2] * dz + g[3] * dw;
        };

        const A = this.perm[X] + Y;
        const AA = this.perm[A] + Z;
        const AB = this.perm[A + 1] + Z;
        const B = this.perm[X + 1] + Y;
        const BA = this.perm[B] + Z;
        const BB = this.perm[B + 1] + Z;

        const AAA = this.perm[AA] + W;
        const AAB = this.perm[AA + 1] + W;
        const ABA = this.perm[AB] + W;
        const ABB = this.perm[AB + 1] + W;
        const BAA = this.perm[BA] + W;
        const BAB = this.perm[BA + 1] + W;
        const BBA = this.perm[BB] + W;
        const BBB = this.perm[BB + 1] + W;

        // Interpolate along w
        const lerp = this.lerp.bind(this);
        return lerp(
            lerp(
                lerp(
                    lerp(dot4(this.perm[AAA], x, y, z, w), dot4(this.perm[BAA], x - 1, y, z, w), fx),
                    lerp(dot4(this.perm[ABA], x, y - 1, z, w), dot4(this.perm[BBA], x - 1, y - 1, z, w), fx),
                    fy
                ),
                lerp(
                    lerp(dot4(this.perm[AAB], x, y, z - 1, w), dot4(this.perm[BAB], x - 1, y, z - 1, w), fx),
                    lerp(dot4(this.perm[ABB], x, y - 1, z - 1, w), dot4(this.perm[BBB], x - 1, y - 1, z - 1, w), fx),
                    fy
                ),
                fz
            ),
            lerp(
                lerp(
                    lerp(dot4(this.perm[AAA + 1], x, y, z, w - 1), dot4(this.perm[BAA + 1], x - 1, y, z, w - 1), fx),
                    lerp(dot4(this.perm[ABA + 1], x, y - 1, z, w - 1), dot4(this.perm[BBA + 1], x - 1, y - 1, z, w - 1), fx),
                    fy
                ),
                lerp(
                    lerp(dot4(this.perm[AAB + 1], x, y, z - 1, w - 1), dot4(this.perm[BAB + 1], x - 1, y, z - 1, w - 1), fx),
                    lerp(dot4(this.perm[ABB + 1], x, y - 1, z - 1, w - 1), dot4(this.perm[BBB + 1], x - 1, y - 1, z - 1, w - 1), fx),
                    fy
                ),
                fz
            ),
            fw
        );
    }

    // Looping noise: converts linear time to circular 4D path for seamless loops
    // When time reaches loopPeriod, we're back at the start
    loopingNoise3D(
        x: number,
        y: number,
        time: number,
        loopPeriod: number,
        radius: number = 1.0
    ): number {
        const angle = (time / loopPeriod) * Math.PI * 2;
        const tz = Math.cos(angle) * radius;
        const tw = Math.sin(angle) * radius;
        return this.noise4D(x, y, tz, tw);
    }

    // Looping FBM - fractal brownian motion that loops seamlessly
    fbmLooping(
        x: number,
        y: number,
        time: number,
        loopPeriod: number,
        octaves: number = 4,
        persistence: number = 0.5,
        lacunarity: number = 2
    ): number {
        let value = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            value += amplitude * this.loopingNoise3D(
                x * frequency,
                y * frequency,
                time,
                loopPeriod,
                1.0 // radius
            );
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= lacunarity;
        }

        return value / maxValue;
    }

    // Ridged noise - creates sharp creases instead of smooth hills
    // Used for tense, muscular movement (tendons, struggling flesh)
    ridgedNoise3D(x: number, y: number, z: number): number {
        const n = this.noise3D(x, y, z);
        return 1.0 - Math.abs(n);  // Sharp ridges at zero-crossings
    }

    // Ridged FBM - fractal version of ridged noise for organic detail
    ridgedFbm(
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
            const n = this.noise3D(x * frequency, y * frequency, time);
            // Ridge transformation: sharp peaks instead of smooth hills
            value += amplitude * (1.0 - Math.abs(n));
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= lacunarity;
        }

        return value / maxValue;
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

    // Eldritch tentacle displacement - writhing, directional, coiling motion
    // Creates organic tentacle-like movement with wave propagation
    // Enhanced with tension (ridged noise) and shiver (high-freq tremor) for disturbing effect
    eldritchDisplacement(
        x: number,
        y: number,
        time: number,
        params: {
            noiseScale: number;
            octaves: number;
            persistence: number;
            lacunarity: number;
            writheSpeed: number;
            writheIntensity: number;
            coilTightness: number;
            originX?: number;
            originY?: number;
            tensionAmount?: number;    // 0-1: how ridged/tense the motion is
            shiverIntensity?: number;  // 0-1: high-frequency tremor strength
            tremorIntensity?: number;  // 0-1: medium-frequency "living flesh" quiver
            pulseIntensity?: number;   // 0-1: slow breathing undertone
        }
    ): { dx: number; dy: number } {
        const {
            noiseScale, octaves, persistence, lacunarity,
            writheSpeed, writheIntensity, coilTightness,
            originX = 0, originY = 0,
            tensionAmount = 0,
            shiverIntensity = 0,
            tremorIntensity = 0.5,
            pulseIntensity = 0.5
        } = params;

        // Use position relative to origin to create wave propagation direction
        // Points further from origin have phase delay - creates "traveling wave"
        const relX = x - originX;
        const relY = y - originY;
        const distFromOrigin = Math.sqrt(relX * relX + relY * relY);
        const angle = Math.atan2(relY, relX);

        // TimeWarp: Spatially distort time to break synchronization
        // Different parts of the image experience "time" at different speeds
        // This creates the chaotic "tangle of tentacles" effect where some parts
        // snap quickly while others linger - like they're struggling independently
        const timeWarp = this.noise3D(x * 0.01, y * 0.01, time * 0.2);
        const strugglingTime = time + timeWarp * 2.0;

        // Layer 1: Primary writhing wave - blend between smooth and ridged based on tension
        const phaseOffset = distFromOrigin * noiseScale * 3;

        // Smooth writhe using warped time for desync
        const smoothWritheBase = Math.sin(strugglingTime * writheSpeed * 4 - phaseOffset);

        // Ridged writhe - creates snapping tendon motion
        // Use ridged noise to modulate a faster sine for asymmetric snap-and-creep
        const ridgedMod = this.ridgedNoise3D(
            x * noiseScale * 2,
            y * noiseScale * 2,
            strugglingTime * writheSpeed * 2
        );
        // Asymmetric timing: fast snap (sin^3 sharpens peaks), slow creep
        const sharpSin = Math.sin(strugglingTime * writheSpeed * 5 - phaseOffset);
        const ridgedWritheBase = sharpSin * sharpSin * sharpSin * ridgedMod;

        // Blend between smooth and ridged based on tension
        const writheBase = smoothWritheBase * (1 - tensionAmount) + ridgedWritheBase * 2 * tensionAmount;

        // Modulate writhe amplitude with noise for organic irregularity
        // Use ridged FBM when tense for more angular modulation
        const smoothMod = this.fbm(x * noiseScale * 2, y * noiseScale * 2, time * 0.5, 2, 0.6, 2);
        const ridgedModulation = this.ridgedFbm(x * noiseScale * 2, y * noiseScale * 2, time * 0.5, 2, 0.6, 2);
        const writheModulation = smoothMod * (1 - tensionAmount) + ridgedModulation * tensionAmount;
        const writhe = writheBase * (0.5 + writheModulation * 0.5) * writheIntensity;

        // Layer 2: Coiling rotation - spiral motion around local axis
        // Creates the "corkscrew" tentacle movement
        const coilPhase = strugglingTime * writheSpeed * 2.5 - phaseOffset * 0.7;
        const coilNoise = this.noise3D(x * noiseScale, y * noiseScale, time * 0.8);
        const coilRidged = this.ridgedNoise3D(x * noiseScale, y * noiseScale, time * 0.8);
        const coilRadius = (coilNoise * (1 - tensionAmount) + coilRidged * tensionAmount) * coilTightness;

        const coilDx = Math.cos(coilPhase + angle) * coilRadius;
        const coilDy = Math.sin(coilPhase + angle) * coilRadius;

        // Layer 3: Secondary undulation - faster, smaller tremors
        // Gives the "living flesh" quiver effect
        let tremorDx = 0;
        let tremorDy = 0;
        if (tremorIntensity > 0) {
            const tremor = this.fbm(
                x * noiseScale * 4,
                y * noiseScale * 4,
                time * writheSpeed * 3,
                octaves,
                persistence,
                lacunarity
            );
            tremorDx = tremor * tremorIntensity;
            tremorDy = this.fbm(
                x * noiseScale * 4 + 100,
                y * noiseScale * 4,
                time * writheSpeed * 3.2,
                octaves,
                persistence,
                lacunarity
            ) * tremorIntensity;
        }

        // Layer 4: High-frequency shiver - the unsettling "alive" tremor
        // Independent of writheSpeed so it can be isolated
        let shiverDx = 0;
        let shiverDy = 0;
        if (shiverIntensity > 0) {
            const shiverScale = noiseScale * 10;  // Very fine detail
            const shiverTime = time * 8;  // Fast, independent of writhe
            shiverDx = this.noise3D(x * shiverScale, y * shiverScale, shiverTime) * shiverIntensity * 1.5;
            shiverDy = this.noise3D(x * shiverScale + 50, y * shiverScale, shiverTime * 1.1) * shiverIntensity * 1.5;
        }

        // Layer 5: Slow pulsing "breathing" undertone
        const pulse = Math.sin(time * writheSpeed * 0.5) * 0.2 * pulseIntensity;

        // Combine: writhe applies perpendicular to position angle,
        // coil adds spiral, tremor adds organic noise, shiver adds disturbing quiver
        const perpAngle = angle + Math.PI / 2;
        const writheDx = Math.cos(perpAngle) * writhe;
        const writheDy = Math.sin(perpAngle) * writhe;

        return {
            dx: writheDx + coilDx + tremorDx + shiverDx + pulse,
            dy: writheDy + coilDy + tremorDy + shiverDy + pulse * 0.7
        };
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

    // Vegetal/Wind displacement - external force pushing objects directionally
    // Unlike psychedelic (warps space) or eldritch (internal writhing),
    // wind is an external vector field that pushes things in a direction
    vegetalDisplacement(
        x: number,
        y: number,
        time: number,
        params: {
            windSpeed: number;       // How fast gusts travel across the scene
            windStrength: number;    // Max displacement amount
            windAngle: number;       // Wind direction in radians
            gustScale: number;       // Size of gust patterns
            flutterIntensity: number; // High-freq leaf tremor
        }
    ): { dx: number; dy: number } {
        const { windSpeed, windStrength, windAngle, gustScale, flutterIntensity } = params;

        // Wind direction vector
        const windDirX = Math.cos(windAngle);
        const windDirY = Math.sin(windAngle);

        // Layer 1: Traveling gust wave
        // Move the noise sampling position over time to simulate wind passing through
        // This creates the "wave of wind" effect across the scene
        const gustOffsetX = time * windSpeed;
        const gustOffsetY = time * windSpeed * 0.3; // Slight diagonal movement

        const gustIntensity = this.fbm(
            x * gustScale + gustOffsetX,
            y * gustScale + gustOffsetY,
            time * 0.15,  // Slow evolution of the overall pattern
            3,
            0.5,
            2
        );

        // Layer 2: Secondary slower gust for variation
        const gustSlow = this.fbm(
            x * gustScale * 0.5 + gustOffsetX * 0.5,
            y * gustScale * 0.5 + gustOffsetY * 0.5,
            time * 0.08,
            2,
            0.6,
            2
        );

        // Combine gusts: main gust + slower undertone
        // RECTIFIED: Shift noise from [-1, 1] to [0, 1] so wind only pushes, never pulls backward
        // This creates natural "push and relax" behavior instead of vibration
        const rawGust = gustIntensity * 0.7 + gustSlow * 0.3;
        const rectifiedGust = Math.pow((rawGust + 1) / 2, 2); // Cubic for punchy gusts, long calm

        // Layer 3: Flutter - high-frequency chaos for leaf tremor
        // Use noise, NOT sin*cos, for organic randomness
        let flutterDx = 0;
        let flutterDy = 0;
        if (flutterIntensity > 0) {
            const flutterScale = gustScale * 6;
            const flutterTime = time * 4;
            flutterDx = this.noise3D(x * flutterScale, y * flutterScale, flutterTime) * flutterIntensity * 0.3;
            flutterDy = this.noise3D(x * flutterScale + 77, y * flutterScale, flutterTime * 1.2) * flutterIntensity * 0.3;
        }

        // Layer 4: Spring-back effect
        // When gust intensity drops, add slight overshoot recovery
        // This creates the natural "bounce back" when wind dies down
        const gustDerivative = this.fbm(
            x * gustScale + gustOffsetX + 0.1,
            y * gustScale + gustOffsetY,
            time * 0.15,
            2,
            0.5,
            2
        ) - gustIntensity;
        // Rectify the spring-back too - only resist recovery, don't push backward
        const springBack = Math.max(0, -gustDerivative * 0.2);

        // Final displacement: wind direction scaled by rectified gust intensity + flutter
        const finalStrength = (rectifiedGust + springBack) * windStrength;

        return {
            dx: windDirX * finalStrength + flutterDx,
            dy: windDirY * finalStrength + flutterDy
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
