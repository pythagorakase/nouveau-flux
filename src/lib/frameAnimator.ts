// Frame Animator - core animation class that runs outside React

import { ParsedPath } from './pathParser';
import { NoiseEngine } from './noiseEngine';
import {
    EldritchFocusEngine,
    EldritchFocusParams,
    DEFAULT_ELDRITCH_FOCUS_PARAMS,
    DEFAULT_LOOP_PERIOD,
    MotionWeights,
} from './eldritchFocusEngine';

export type MotionType = 'psychedelic' | 'eldritch' | 'vegetal';

export type { MotionWeights, EldritchFocusParams };

export interface GradientStop {
    offset: number; // 0-1
    color: string;
}

export interface GradientConfig {
    type: 'linear' | 'radial';
    stops: GradientStop[];
    angle?: number; // For linear: degrees (0 = left-to-right)
    cx?: number;    // For radial: center x (0-1)
    cy?: number;    // For radial: center y (0-1)
}

export interface AnimationParams {
    motionType: MotionType;
    speed: number;
    intensity: number;
    noiseScale: number;
    octaves: number;
    persistence: number;
    lacunarity: number;
    // Psychedelic-specific
    warpStrength: number;
    breathingAmount: number;
    // Eldritch focus-based parameters (new system)
    eldritchFocus: EldritchFocusParams;
    // Legacy eldritch params (kept for backwards compat, unused in new system)
    writheSpeed: number;
    writheIntensity: number;
    coilTightness: number;
    eldritchOriginX: number;
    eldritchOriginY: number;
    tensionAmount: number;
    shiverIntensity: number;
    tremorIntensity: number;
    pulseIntensity: number;
    // Vegetal/Wind-specific
    windSpeed: number;        // How fast gusts travel
    windStrength: number;     // Max displacement amount
    windAngle: number;        // Wind direction in degrees
    gustScale: number;        // Size of gust patterns
    flutterIntensity: number; // High-freq leaf tremor
    // Shared
    falloffRadius: number;
    loopPeriod: number;       // 0 = no loop, >0 = seconds per seamless loop
}

export const DEFAULT_PARAMS: AnimationParams = {
    motionType: 'psychedelic',
    speed: 0.3,
    intensity: 3,
    noiseScale: 0.01,
    octaves: 4,
    persistence: 0.5,
    lacunarity: 2,
    // Psychedelic defaults
    warpStrength: 15,
    breathingAmount: 0.5,
    // Eldritch focus-based defaults (new system)
    eldritchFocus: { ...DEFAULT_ELDRITCH_FOCUS_PARAMS },
    // Legacy eldritch defaults (unused in new system)
    writheSpeed: 1.0,
    writheIntensity: 0.8,
    coilTightness: 0.5,
    eldritchOriginX: 0,
    eldritchOriginY: 0,
    tensionAmount: 0.5,
    shiverIntensity: 0.3,
    tremorIntensity: 0.5,
    pulseIntensity: 0.5,
    // Vegetal/Wind defaults
    windSpeed: 0.5,
    windStrength: 2.0,
    windAngle: 45,           // Diagonal wind
    gustScale: 0.02,
    flutterIntensity: 0.4,
    // Shared
    falloffRadius: 25,
    loopPeriod: 0,
};

// Maximum delta time to prevent large jumps after tab becomes active
const MAX_DELTA_TIME = 1 / 30; // ~33ms, equivalent to 30fps

export class FrameAnimator {
    // Pre-allocated buffers
    private baseCoords: Float32Array;
    private animatedCoords: Float32Array;
    private influence: Float32Array;

    // Parsed path structure
    private parsedPath: ParsedPath;

    // Canvas context
    private ctx: CanvasRenderingContext2D;
    private width: number;
    private height: number;

    // Animation state
    private time: number = 0;
    private rafId: number = 0;
    private running: boolean = false;
    private lastTimestamp: number = 0;

    // Noise engine
    private noise: NoiseEngine;

    // Eldritch focus engine (for new focus-based eldritch mode)
    private eldritchEngine: EldritchFocusEngine | null = null;

    // Parameters (updated via setParams)
    private params: AnimationParams = { ...DEFAULT_PARAMS };

    // SVG viewBox for coordinate scaling
    private viewBox: { width: number; height: number };

    // Transform offset from SVG
    private transformOffset: { tx: number; ty: number } = { tx: 0, ty: 0 };

    // Margin offset for centering path in extended canvas
    private marginOffset: { x: number; y: number } = { x: 0, y: 0 };

    // Fill style
    private fillColor: string = '#000000';
    private gradientConfig: GradientConfig | null = null;

    constructor(
        canvas: HTMLCanvasElement,
        parsedPath: ParsedPath,
        viewBox: { width: number; height: number },
        options?: {
            offsetX?: number;      // Margin offset in viewBox coords
            offsetY?: number;
            transformOffset?: { tx: number; ty: number };
        }
    ) {
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2d context');

        this.ctx = ctx;
        this.width = canvas.width;
        this.height = canvas.height;
        this.parsedPath = parsedPath;
        this.viewBox = viewBox;
        this.transformOffset = options?.transformOffset ?? { tx: 0, ty: 0 };
        this.marginOffset = {
            x: options?.offsetX ?? 0,
            y: options?.offsetY ?? 0,
        };

        // Clone the coordinates for base reference
        this.baseCoords = new Float32Array(parsedPath.coords);
        this.animatedCoords = new Float32Array(parsedPath.coords.length);
        this.influence = new Float32Array(parsedPath.coords.length / 2);

        this.noise = new NoiseEngine(12345);
    }

    setParams(params: Partial<AnimationParams>): void {
        this.params = { ...this.params, ...params };
    }

    setFillColor(color: string): void {
        this.fillColor = color;
        this.gradientConfig = null; // Clear gradient when setting solid color
    }

    setGradient(config: GradientConfig): void {
        this.gradientConfig = config;
    }

    setInfluence(influence: Float32Array): void {
        this.influence = influence;
        // Initialize or update eldritch engine with new influence
        if (this.eldritchEngine) {
            this.eldritchEngine.setAnchorInfluence(influence);
        } else {
            this.eldritchEngine = new EldritchFocusEngine(this.parsedPath, influence);
        }
    }

    setLoopPeriod(seconds: number): void {
        this.params.loopPeriod = Math.max(0, seconds);
    }

    getLoopPeriod(): number {
        return this.params.loopPeriod;
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        this.lastTimestamp = performance.now();
        this.rafId = requestAnimationFrame(this.animate);
    }

    stop(): void {
        this.running = false;
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = 0;
        }
    }

    resize(width: number, height: number): void {
        this.width = width;
        this.height = height;
    }

    private animate = (timestamp: number): void => {
        if (!this.running) return;

        // Calculate delta time
        const dt = Math.min((timestamp - this.lastTimestamp) / 1000, MAX_DELTA_TIME);
        this.lastTimestamp = timestamp;
        const loopPeriod = this.params.loopPeriod;
        const delta = dt * this.params.speed;
        if (loopPeriod > 0) {
            this.time = (this.time + delta) % loopPeriod;
        } else {
            this.time += delta;
        }

        // Update all point positions
        this.updatePoints();

        // Clear and draw
        this.draw();

        // Schedule next frame
        this.rafId = requestAnimationFrame(this.animate);
    };

    private updatePoints(): void {
        const numPoints = this.baseCoords.length / 2;
        const {
            motionType,
            intensity,
            noiseScale,
            octaves,
            persistence,
            lacunarity,
            warpStrength,
            breathingAmount,
            eldritchFocus,
            windSpeed,
            windStrength,
            windAngle,
            gustScale,
            flutterIntensity,
            loopPeriod,
        } = this.params;

        // Convert wind angle from degrees to radians
        const windAngleRad = (windAngle * Math.PI) / 180;

        // For eldritch mode, use the focus-based engine
        if (motionType === 'eldritch' && this.eldritchEngine) {
            const displacements = this.eldritchEngine.calculateDisplacements(
                this.time,
                eldritchFocus,
                loopPeriod > 0 ? loopPeriod : DEFAULT_LOOP_PERIOD
            );

            for (let i = 0; i < numPoints; i++) {
                const weight = this.influence[i];
                const baseX = this.baseCoords[i * 2];
                const baseY = this.baseCoords[i * 2 + 1];

                // Apply displacement scaled by weight and intensity
                this.animatedCoords[i * 2] = baseX + displacements[i * 2] * weight * intensity;
                this.animatedCoords[i * 2 + 1] = baseY + displacements[i * 2 + 1] * weight * intensity;
            }
            return;
        }

        // Non-eldritch modes: process point by point
        for (let i = 0; i < numPoints; i++) {
            const weight = this.influence[i];

            // Skip pinned points (near anchors)
            if (weight < 0.001) {
                this.animatedCoords[i * 2] = this.baseCoords[i * 2];
                this.animatedCoords[i * 2 + 1] = this.baseCoords[i * 2 + 1];
                continue;
            }

            const baseX = this.baseCoords[i * 2];
            const baseY = this.baseCoords[i * 2 + 1];

            // Get displacement based on motion type
            let displacement: { dx: number; dy: number };

            if (motionType === 'vegetal') {
                displacement = this.noise.vegetalDisplacement(
                    baseX,
                    baseY,
                    this.time,
                    {
                        windSpeed,
                        windStrength,
                        windAngle: windAngleRad,
                        gustScale,
                        flutterIntensity,
                    }
                );
            } else {
                // Default: psychedelic
                displacement = this.noise.psychedelicDisplacement(
                    baseX,
                    baseY,
                    this.time,
                    {
                        noiseScale,
                        octaves,
                        persistence,
                        lacunarity,
                        warpStrength,
                        breathingAmount,
                    },
                    loopPeriod
                );
            }

            // Apply displacement scaled by weight and intensity
            this.animatedCoords[i * 2] = baseX + displacement.dx * weight * intensity;
            this.animatedCoords[i * 2 + 1] = baseY + displacement.dy * weight * intensity;
        }
    }

    private createGradient(): CanvasGradient | null {
        if (!this.gradientConfig) return null;

        const ctx = this.ctx;
        const { type, stops, angle = 0, cx = 0.5, cy = 0.5 } = this.gradientConfig;
        const vbW = this.viewBox.width;
        const vbH = this.viewBox.height;

        let gradient: CanvasGradient;

        if (type === 'linear') {
            // Convert angle to gradient line coordinates
            // 0° = left-to-right, 90° = top-to-bottom, etc.
            const rad = (angle * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);

            // Calculate start and end points in viewBox coordinates
            const centerX = vbW / 2;
            const centerY = vbH / 2;
            // Use diagonal length for full coverage at any angle
            const length = Math.sqrt(vbW * vbW + vbH * vbH);

            const x0 = centerX - cos * length / 2;
            const y0 = centerY - sin * length / 2;
            const x1 = centerX + cos * length / 2;
            const y1 = centerY + sin * length / 2;

            gradient = ctx.createLinearGradient(x0, y0, x1, y1);
        } else {
            // Radial gradient
            const centerX = cx * vbW;
            const centerY = cy * vbH;
            const radius = Math.max(vbW, vbH) / 2;

            gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
        }

        // Add color stops
        for (const stop of stops) {
            gradient.addColorStop(stop.offset, stop.color);
        }

        return gradient;
    }

    private draw(): void {
        const ctx = this.ctx;
        const scaleX = this.width / this.viewBox.width;
        const scaleY = this.height / this.viewBox.height;

        // Clear canvas
        ctx.clearRect(0, 0, this.width, this.height);

        // Build and draw path
        ctx.save();
        ctx.scale(scaleX, scaleY);

        // Apply margin offset to center the path in the extended canvas
        ctx.translate(this.marginOffset.x, this.marginOffset.y);

        // Create Path2D from animated coordinates (transform already applied during parsing)
        const path = this.buildPath();

        // Use gradient if configured, otherwise solid color
        const gradient = this.createGradient();
        ctx.fillStyle = gradient || this.fillColor;
        ctx.fill(path);

        ctx.restore();
    }

    private buildPath(): Path2D {
        const path = new Path2D();
        const coords = this.animatedCoords;
        const commands = this.parsedPath.commands;
        let coordIdx = 0;

        for (let i = 0; i < commands.length; i++) {
            const cmd = commands[i];

            switch (cmd) {
                case 0: // M
                    path.moveTo(coords[coordIdx], coords[coordIdx + 1]);
                    coordIdx += 2;
                    break;
                case 1: // L
                    path.lineTo(coords[coordIdx], coords[coordIdx + 1]);
                    coordIdx += 2;
                    break;
                case 2: // C
                    path.bezierCurveTo(
                        coords[coordIdx], coords[coordIdx + 1],
                        coords[coordIdx + 2], coords[coordIdx + 3],
                        coords[coordIdx + 4], coords[coordIdx + 5]
                    );
                    coordIdx += 6;
                    break;
                case 5: // Z
                    path.closePath();
                    break;
            }
        }

        return path;
    }

    // Debug: draw anchor points
    drawAnchors(anchors: { x: number; y: number }[], transformOffset: { tx: number; ty: number }): void {
        const ctx = this.ctx;
        const scaleX = this.width / this.viewBox.width;
        const scaleY = this.height / this.viewBox.height;

        ctx.save();
        ctx.scale(scaleX, scaleY);

        ctx.fillStyle = '#ff0000';
        for (const anchor of anchors) {
            const x = anchor.x - transformOffset.tx;
            const y = anchor.y - transformOffset.ty;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    // Get current time for external sync
    getTime(): number {
        return this.time;
    }

    // Reset animation
    reset(): void {
        this.time = 0;
    }

    // Render at a specific time (for GIF export)
    renderAtTime(time: number): void {
        const loopPeriod = this.params.loopPeriod;
        this.time = loopPeriod > 0 ? time % loopPeriod : time;
        this.updatePoints();
        this.draw();
    }

    // Get the canvas element (for GIF export)
    getCanvas(): HTMLCanvasElement {
        return this.ctx.canvas;
    }
}
