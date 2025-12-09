import React, { useRef, useEffect, useCallback } from 'react';
import { useControls } from 'leva';

// Simple noise function for organic animation
function createNoise() {
    const permutation = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
    }
    const p = [...permutation, ...permutation];

    function fade(t: number) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    function lerp(a: number, b: number, t: number) {
        return a + t * (b - a);
    }

    function grad(hash: number, x: number, y: number) {
        const h = hash & 3;
        const u = h < 2 ? x : y;
        const v = h < 2 ? y : x;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    return function noise2D(x: number, y: number): number {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        x -= Math.floor(x);
        y -= Math.floor(y);
        const u = fade(x);
        const v = fade(y);
        const A = p[X] + Y;
        const B = p[X + 1] + Y;
        return lerp(
            lerp(grad(p[A], x, y), grad(p[B], x - 1, y), u),
            lerp(grad(p[A + 1], x, y - 1), grad(p[B + 1], x - 1, y - 1), u),
            v
        );
    };
}

const noise = createNoise();

// Fractal Brownian Motion for richer noise
function fbm(x: number, y: number, octaves: number = 4): number {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    for (let i = 0; i < octaves; i++) {
        value += amplitude * noise(x * frequency, y * frequency);
        amplitude *= 0.5;
        frequency *= 2;
    }
    return value;
}

interface CurvePoint {
    x: number;
    y: number;
}

// Generate a flowing whiplash curve using noise-based control points
function generateWhiplashCurve(
    startX: number,
    startY: number,
    time: number,
    curveIndex: number,
    params: {
        curvature: number;
        noiseScale: number;
        length: number;
    }
): CurvePoint[] {
    const points: CurvePoint[] = [];
    const segments = 60;
    const { curvature, noiseScale, length } = params;

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const baseX = startX + t * length;

        // Domain warping for organic flow
        const warpX = fbm(baseX * noiseScale * 0.3 + time * 0.1, curveIndex * 3.7, 3) * curvature;
        const warpY = fbm(baseX * noiseScale * 0.3 + 5.2, curveIndex * 3.7 + time * 0.08, 3) * curvature;

        // Main S-curve motion with noise
        const sineWave = Math.sin(t * Math.PI * 2 + curveIndex * 0.7 + time * 0.15) * curvature * 0.5;
        const noiseOffset = fbm(
            baseX * noiseScale + time * 0.05,
            startY * noiseScale + curveIndex * 2.3,
            4
        ) * curvature;

        points.push({
            x: baseX + warpX * 0.3,
            y: startY + sineWave + noiseOffset + warpY * 0.5
        });
    }

    return points;
}

// Calculate normal vector at a point (perpendicular to curve direction)
function getNormal(points: CurvePoint[], index: number): { nx: number; ny: number } {
    let dx: number, dy: number;

    if (index === 0) {
        dx = points[1].x - points[0].x;
        dy = points[1].y - points[0].y;
    } else if (index === points.length - 1) {
        dx = points[index].x - points[index - 1].x;
        dy = points[index].y - points[index - 1].y;
    } else {
        // Average of adjacent segments for smoother normals
        dx = points[index + 1].x - points[index - 1].x;
        dy = points[index + 1].y - points[index - 1].y;
    }

    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    // Perpendicular: rotate 90 degrees
    return { nx: -dy / len, ny: dx / len };
}

// Draw a curve with variable thickness as a filled shape (smooth edges)
function drawTaperedCurve(
    ctx: CanvasRenderingContext2D,
    points: CurvePoint[],
    baseThickness: number,
    time: number,
    curveIndex: number
) {
    if (points.length < 3) return;

    // Calculate thickness at each point
    const thicknesses: number[] = points.map((_, i) => {
        const t = i / (points.length - 1);
        // Taper at ends, swell in middle
        const taperEnds = Math.sin(t * Math.PI);
        const noiseThickness = (noise(t * 3 + curveIndex, time * 0.2) + 1) * 0.5;
        return baseThickness * (0.15 + 0.85 * taperEnds) * (0.6 + 0.4 * noiseThickness);
    });

    // Build the outline: go forward along one edge, then backward along the other
    const leftEdge: CurvePoint[] = [];
    const rightEdge: CurvePoint[] = [];

    for (let i = 0; i < points.length; i++) {
        const { nx, ny } = getNormal(points, i);
        const halfThick = thicknesses[i] / 2;

        leftEdge.push({
            x: points[i].x + nx * halfThick,
            y: points[i].y + ny * halfThick
        });
        rightEdge.push({
            x: points[i].x - nx * halfThick,
            y: points[i].y - ny * halfThick
        });
    }

    // Draw as a filled shape using smooth curves
    ctx.beginPath();

    // Left edge (forward)
    ctx.moveTo(leftEdge[0].x, leftEdge[0].y);
    for (let i = 1; i < leftEdge.length - 1; i++) {
        const xc = (leftEdge[i].x + leftEdge[i + 1].x) / 2;
        const yc = (leftEdge[i].y + leftEdge[i + 1].y) / 2;
        ctx.quadraticCurveTo(leftEdge[i].x, leftEdge[i].y, xc, yc);
    }
    // Connect to last point
    const lastLeft = leftEdge[leftEdge.length - 1];
    ctx.lineTo(lastLeft.x, lastLeft.y);

    // Connect to right edge at the end (rounded cap)
    const lastRight = rightEdge[rightEdge.length - 1];
    ctx.quadraticCurveTo(
        points[points.length - 1].x + (lastLeft.x - points[points.length - 1].x) * 0.5 + (lastRight.x - points[points.length - 1].x) * 0.5,
        points[points.length - 1].y + (lastLeft.y - points[points.length - 1].y) * 0.5 + (lastRight.y - points[points.length - 1].y) * 0.5,
        lastRight.x, lastRight.y
    );

    // Right edge (backward)
    for (let i = rightEdge.length - 2; i > 0; i--) {
        const xc = (rightEdge[i].x + rightEdge[i - 1].x) / 2;
        const yc = (rightEdge[i].y + rightEdge[i - 1].y) / 2;
        ctx.quadraticCurveTo(rightEdge[i].x, rightEdge[i].y, xc, yc);
    }
    ctx.lineTo(rightEdge[0].x, rightEdge[0].y);

    // Connect back to start (rounded cap)
    ctx.quadraticCurveTo(
        points[0].x,
        points[0].y,
        leftEdge[0].x, leftEdge[0].y
    );

    ctx.closePath();
    ctx.fill();
}

// Smooth a set of points using Catmull-Rom to Bezier conversion
function smoothCurve(ctx: CanvasRenderingContext2D, points: CurvePoint[]) {
    if (points.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    if (points.length === 2) {
        ctx.lineTo(points[1].x, points[1].y);
    } else {
        // Use quadratic curves for smoothing
        for (let i = 1; i < points.length - 1; i++) {
            const xc = (points[i].x + points[i + 1].x) / 2;
            const yc = (points[i].y + points[i + 1].y) / 2;
            ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
        }
        // Last point
        const last = points[points.length - 1];
        const secondLast = points[points.length - 2];
        ctx.quadraticCurveTo(secondLast.x, secondLast.y, last.x, last.y);
    }

    ctx.stroke();
}

export const ArtNouveauBackground: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number>(0);
    const timeRef = useRef<number>(0);

    const {
        speed,
        bundles,
        strandsPerBundle,
        thickness,
        curvature,
        bundleSpread,
        coherence,
        invert
    } = useControls({
        speed: { value: 0.08, min: 0, max: 0.5, step: 0.005 },
        bundles: { value: 4, min: 1, max: 8, step: 1 },
        strandsPerBundle: { value: 5, min: 2, max: 12, step: 1 },
        thickness: { value: 12, min: 2, max: 40, step: 1 },
        curvature: { value: 200, min: 50, max: 500, step: 10 },
        bundleSpread: { value: 30, min: 5, max: 100, step: 5 },
        coherence: { value: 0.85, min: 0, max: 1, step: 0.05 },
        invert: { value: false }
    });

    const draw = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
        // Clear with background color
        ctx.fillStyle = invert ? '#000000' : '#ffffff';
        ctx.fillRect(0, 0, width, height);

        // Set fill color for curves
        ctx.fillStyle = invert ? '#ffffff' : '#000000';

        const time = timeRef.current;
        const segments = 80;

        // Generate bundles of curves that flow together
        for (let b = 0; b < bundles; b++) {
            // Each bundle has a "leader" path that others follow
            const bundleSeed = b * 7.3;
            const bundlePhase = b * Math.PI * 0.5;

            // Drifting anchor point - moves slowly around the canvas edges
            const anchorDriftX = fbm(bundleSeed + 0.5, time * 0.08, 2);
            const anchorDriftY = fbm(bundleSeed + 10.3, time * 0.06, 2);

            // Anchor can be on any edge, drifting slowly
            const edgePosition = (b / bundles + anchorDriftX * 0.3) % 1;
            let bundleStartX: number, bundleStartY: number;
            let bundleAngle: number; // Direction the bundle flows

            // Distribute bundles around edges with drift
            const edge = b % 4;
            if (edge === 0) { // Left edge
                bundleStartX = -width * 0.1 + anchorDriftX * width * 0.1;
                bundleStartY = height * (0.1 + edgePosition * 0.8) + anchorDriftY * height * 0.2;
                bundleAngle = (anchorDriftY * 0.4 - 0.2) * Math.PI; // Mostly rightward, slight variation
            } else if (edge === 1) { // Top edge
                bundleStartX = width * (0.1 + edgePosition * 0.8) + anchorDriftX * width * 0.2;
                bundleStartY = -height * 0.1 + anchorDriftY * height * 0.1;
                bundleAngle = Math.PI * 0.5 + (anchorDriftX * 0.4 - 0.2) * Math.PI; // Mostly downward
            } else if (edge === 2) { // Right edge
                bundleStartX = width * 1.1 + anchorDriftX * width * 0.1;
                bundleStartY = height * (0.1 + edgePosition * 0.8) + anchorDriftY * height * 0.2;
                bundleAngle = Math.PI + (anchorDriftY * 0.4 - 0.2) * Math.PI; // Mostly leftward
            } else { // Bottom edge
                bundleStartX = width * (0.1 + edgePosition * 0.8) + anchorDriftX * width * 0.2;
                bundleStartY = height * 1.1 + anchorDriftY * height * 0.1;
                bundleAngle = -Math.PI * 0.5 + (anchorDriftX * 0.4 - 0.2) * Math.PI; // Mostly upward
            }

            // Slowly rotating bundle direction
            bundleAngle += fbm(bundleSeed + 20, time * 0.05, 2) * 0.3;

            const curveLength = Math.max(width, height) * 1.2;

            // Generate the leader curve for this bundle
            const leaderPoints: CurvePoint[] = [];
            for (let i = 0; i <= segments; i++) {
                const t = i / segments;

                // Base position along the bundle's direction
                const baseX = bundleStartX + Math.cos(bundleAngle) * t * curveLength;
                const baseY = bundleStartY + Math.sin(bundleAngle) * t * curveLength;

                // Gentle, long-wavelength undulation perpendicular to direction
                const perpAngle = bundleAngle + Math.PI * 0.5;
                const wave1 = Math.sin(t * Math.PI * 2 + bundlePhase + time * 0.3) * curvature * 0.4;
                const wave2 = Math.sin(t * Math.PI * 1.2 + bundleSeed + time * 0.2) * curvature * 0.3;

                // Very subtle noise for organic feel (not chaotic)
                const gentleNoise = fbm(t * 2 + bundleSeed, time * 0.15, 2) * curvature * 0.15;

                const waveOffset = wave1 + wave2 + gentleNoise;

                leaderPoints.push({
                    x: baseX + Math.cos(perpAngle) * waveOffset,
                    y: baseY + Math.sin(perpAngle) * waveOffset
                });
            }

            // Perpendicular direction for strand spreading
            const perpAngle = bundleAngle + Math.PI * 0.5;

            // Draw strands that follow the leader
            for (let s = 0; s < strandsPerBundle; s++) {
                const strandOffset = (s - (strandsPerBundle - 1) / 2) * bundleSpread;
                const strandSeed = bundleSeed + s * 3.7;
                const strandPhaseOffset = s * 0.15; // Slight phase difference for organic feel

                const strandPoints: CurvePoint[] = [];
                for (let i = 0; i <= segments; i++) {
                    const t = i / segments;
                    const leader = leaderPoints[i];

                    // Individual strand variation (reduced by coherence)
                    const individualWave = Math.sin(t * Math.PI * 2.5 + strandSeed + time * 0.25 + strandPhaseOffset)
                        * bundleSpread * 0.3 * (1 - coherence);
                    const individualNoise = fbm(t * 3 + strandSeed, time * 0.1 + s, 2)
                        * bundleSpread * 0.4 * (1 - coherence);

                    // Convergence/divergence: strands spread apart then come together
                    const convergeFactor = Math.sin(t * Math.PI * 1.5 + time * 0.15 + bundlePhase) * 0.5 + 0.5;
                    const spreadAmount = strandOffset * (0.3 + convergeFactor * 0.7);

                    // Apply offset perpendicular to bundle direction
                    const totalOffset = spreadAmount + individualWave + individualNoise;

                    strandPoints.push({
                        x: leader.x + Math.cos(perpAngle) * totalOffset,
                        y: leader.y + Math.sin(perpAngle) * totalOffset
                    });
                }

                // Vary thickness by strand position (outer strands thinner)
                const distFromCenter = Math.abs(s - (strandsPerBundle - 1) / 2) / (strandsPerBundle / 2);
                const strandThickness = thickness * (1 - distFromCenter * 0.6);

                drawTaperedCurve(ctx, strandPoints, strandThickness, time, b * 100 + s);
            }
        }
    }, [invert, bundles, strandsPerBundle, thickness, curvature, bundleSpread, coherence]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const resize = () => {
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            ctx.scale(dpr, dpr);
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;
        };

        resize();
        window.addEventListener('resize', resize);

        const animate = () => {
            timeRef.current += 0.016 * speed;
            const rect = canvas.getBoundingClientRect();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            const dpr = window.devicePixelRatio || 1;
            ctx.scale(dpr, dpr);
            draw(ctx, rect.width, rect.height);
            animationRef.current = requestAnimationFrame(animate);
        };

        animate();

        return () => {
            window.removeEventListener('resize', resize);
            cancelAnimationFrame(animationRef.current);
        };
    }, [draw, speed]);

    return (
        <canvas
            ref={canvasRef}
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%'
            }}
        />
    );
};
