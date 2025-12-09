// Frame Animator - core animation class that runs outside React

import { ParsedPath } from './pathParser';
import { NoiseEngine } from './noiseEngine';

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
    speed: number;
    intensity: number;
    noiseScale: number;
    octaves: number;
    persistence: number;
    lacunarity: number;
    warpStrength: number;
    breathingAmount: number;
    falloffRadius: number;
}

export const DEFAULT_PARAMS: AnimationParams = {
    speed: 0.3,
    intensity: 3,
    noiseScale: 0.01,
    octaves: 4,
    persistence: 0.5,
    lacunarity: 2,
    warpStrength: 15,
    breathingAmount: 0.5,
    falloffRadius: 25,
};

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

    // Parameters (updated via setParams)
    private params: AnimationParams = { ...DEFAULT_PARAMS };

    // SVG viewBox for coordinate scaling
    private viewBox: { width: number; height: number };

    // Transform offset from SVG
    private transformOffset: { tx: number; ty: number } = { tx: 0, ty: 0 };

    // Fill style
    private fillColor: string = '#000000';
    private gradientConfig: GradientConfig | null = null;

    constructor(
        canvas: HTMLCanvasElement,
        parsedPath: ParsedPath,
        influence: Float32Array,
        viewBox: { width: number; height: number },
        transformOffset: { tx: number; ty: number } = { tx: 0, ty: 0 }
    ) {
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2d context');

        this.ctx = ctx;
        this.width = canvas.width;
        this.height = canvas.height;
        this.parsedPath = parsedPath;
        this.viewBox = viewBox;
        this.transformOffset = transformOffset;

        // Clone the coordinates for base reference
        this.baseCoords = new Float32Array(parsedPath.coords);
        this.animatedCoords = new Float32Array(parsedPath.coords.length);
        this.influence = influence;

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
        const dt = Math.min((timestamp - this.lastTimestamp) / 1000, 0.033); // Cap at ~30fps equivalent
        this.lastTimestamp = timestamp;
        this.time += dt * this.params.speed;

        // Update all point positions
        this.updatePoints();

        // Clear and draw
        this.draw();

        // Schedule next frame
        this.rafId = requestAnimationFrame(this.animate);
    };

    private updatePoints(): void {
        const numPoints = this.baseCoords.length / 2;
        const { intensity, noiseScale, octaves, persistence, lacunarity, warpStrength, breathingAmount } = this.params;

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

            // Get psychedelic displacement from noise engine
            const displacement = this.noise.psychedelicDisplacement(
                baseX,
                baseY,
                this.time,
                {
                    noiseScale,
                    octaves,
                    persistence,
                    lacunarity,
                    warpStrength,
                    breathingAmount
                }
            );

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
            const length = Math.max(vbW, vbH);

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
}
