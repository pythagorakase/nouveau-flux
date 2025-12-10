// Eldritch Focus Engine - focus-based "struggling tentacles" animation
// Creates localized bursts of motion that propagate along the path,
// with most of the frame resting at any given time.

import { ParsedPath } from './pathParser';
import { NoiseEngine } from './noiseEngine';

// --- Constants ---

// Default loop period when none specified (seconds)
export const DEFAULT_LOOP_PERIOD = 10;

// How many points to check around a focus position when avoiding anchors
const ANCHOR_CHECK_RADIUS = 5;

// Points with anchor influence below this threshold are considered "pinned"
const ANCHOR_INFLUENCE_THRESHOLD = 0.3;

// Minimum arc length to prevent division by zero with degenerate paths
const MIN_ARC_LENGTH = 0.001;

export type MotionStyle = 'whip' | 'quiver' | 'strain' | 'thrash';

export interface MotionWeights {
    whip: number;
    quiver: number;
    strain: number;
    thrash: number;
}

export interface EldritchFocusParams {
    // Focus behavior
    minFoci: number;           // Minimum simultaneous foci (1-2)
    maxFoci: number;           // Maximum simultaneous foci (1-3)
    focusDurationMin: number;  // Min duration of a focus burst (seconds)
    focusDurationMax: number;  // Max duration of a focus burst
    restDurationMin: number;   // Min rest between global activity waves
    restDurationMax: number;   // Max rest duration

    // Motion weights (relative odds, will be normalized)
    motionWeights: MotionWeights;

    // Propagation
    propagationSpeed: number;  // How fast motion travels along path
    propagationDecay: number;  // How quickly motion fades with distance

    // Intensity
    baseIntensity: number;     // Overall motion strength multiplier

    // Subtle background motion (so resting areas aren't frozen)
    restingDrift: number;      // 0-1, subtle motion in resting areas
}

export const DEFAULT_ELDRITCH_FOCUS_PARAMS: EldritchFocusParams = {
    minFoci: 1,
    maxFoci: 2,
    focusDurationMin: 0.8,
    focusDurationMax: 2.0,
    restDurationMin: 0.3,
    restDurationMax: 1.0,
    motionWeights: {
        whip: 1.0,
        quiver: 1.0,
        strain: 1.0,
        thrash: 0.5,  // Thrash is more dramatic, less frequent by default
    },
    propagationSpeed: 2.0,
    propagationDecay: 0.15,
    baseIntensity: 1.0,
    restingDrift: 0.05,
};

interface Focus {
    // Position along path (0-1 parametric)
    pathT: number;

    // Timing
    startTime: number;
    rampDuration: number;
    sustainDuration: number;
    decayDuration: number;

    // Motion characteristics
    motionStyle: MotionStyle;
    direction: number;      // Primary direction for whip/strain (-1 to 1)
    frequency: number;      // For quiver - oscillation speed
    intensity: number;      // Per-focus intensity multiplier

    // For propagation wave timing
    waveSpeed: number;      // How fast motion propagates from focus
}

interface FocusSchedule {
    foci: Focus[];
    totalDuration: number;  // Total schedule length (for looping)
    restPeriods: Array<{ start: number; end: number }>;  // Global rest windows
}

// SplitMix32 - higher quality seeded RNG than LCG
// Better distribution for visual randomness, avoids low-bit correlations
class SeededRNG {
    private state: number;

    constructor(seed: number) {
        this.state = seed >>> 0;  // Ensure unsigned 32-bit
    }

    // SplitMix32 - returns [0, 1)
    next(): number {
        this.state = (this.state + 0x9e3779b9) >>> 0;
        let z = this.state;
        z = (z ^ (z >>> 16)) >>> 0;
        z = Math.imul(z, 0x85ebca6b) >>> 0;
        z = (z ^ (z >>> 13)) >>> 0;
        z = Math.imul(z, 0xc2b2ae35) >>> 0;
        z = (z ^ (z >>> 16)) >>> 0;
        return z / 0x100000000;
    }

    // Random in range [min, max]
    range(min: number, max: number): number {
        return min + this.next() * (max - min);
    }

    // Pick from weighted options (handles zero total weight)
    weightedChoice<T>(options: T[], weights: number[]): T {
        const total = weights.reduce((a, b) => a + b, 0);
        // If all weights are zero, pick uniformly at random
        if (total <= 0) {
            return options[Math.floor(this.next() * options.length)];
        }
        let r = this.next() * total;
        for (let i = 0; i < options.length; i++) {
            r -= weights[i];
            if (r <= 0) return options[i];
        }
        return options[options.length - 1];
    }
}

export class EldritchFocusEngine {
    private parsedPath: ParsedPath;
    private noise: NoiseEngine;

    // Path arc length data for parametric positioning
    private pointArcLengths: Float32Array;  // Cumulative arc length to each point
    private totalArcLength: number;

    // Point positions for distance calculations
    private pointPositions: Float32Array;  // [x, y, x, y, ...] for endpoint of each segment

    // Whether the path is closed (ends with Z command) - affects distance wrapping
    private isClosedPath: boolean;

    // Anchor influence (to avoid placing foci near anchors)
    private anchorInfluence: Float32Array;

    // Current schedule
    private schedule: FocusSchedule | null = null;
    private scheduleSeed: number = 12345;
    private scheduleLoopPeriod: number | null = null;

    // Cache for displacement calculations
    // lastTime: Used by getScheduleInfo() to report currently active foci
    private lastTime: number = -1;
    private cachedDisplacements: Float32Array | null = null;

    constructor(parsedPath: ParsedPath, anchorInfluence: Float32Array) {
        this.parsedPath = parsedPath;
        this.anchorInfluence = anchorInfluence;
        this.noise = new NoiseEngine(54321);  // Different seed than main noise

        // Check if path is closed (has Z command)
        this.isClosedPath = parsedPath.commands.includes(5);  // 5 = Z

        // Compute arc lengths
        const { arcLengths, positions, total } = this.computeArcLengths();
        this.pointArcLengths = arcLengths;
        this.pointPositions = positions;
        // Guard against degenerate paths with zero length
        this.totalArcLength = Math.max(total, MIN_ARC_LENGTH);
    }

    private computeArcLengths(): {
        arcLengths: Float32Array;
        positions: Float32Array;
        total: number;
    } {
        const coords = this.parsedPath.coords;
        const commands = this.parsedPath.commands;
        const numPoints = coords.length / 2;

        const arcLengths = new Float32Array(numPoints);
        const positions = new Float32Array(numPoints * 2);

        let cumLength = 0;
        let prevX = 0, prevY = 0;
        let coordIdx = 0;
        let pointIdx = 0;

        for (let i = 0; i < commands.length; i++) {
            const cmd = commands[i];

            switch (cmd) {
                case 0: // M
                    prevX = coords[coordIdx];
                    prevY = coords[coordIdx + 1];
                    positions[pointIdx * 2] = prevX;
                    positions[pointIdx * 2 + 1] = prevY;
                    arcLengths[pointIdx] = cumLength;
                    pointIdx++;
                    coordIdx += 2;
                    break;

                case 1: // L
                    {
                        const x = coords[coordIdx];
                        const y = coords[coordIdx + 1];
                        const dx = x - prevX;
                        const dy = y - prevY;
                        cumLength += Math.sqrt(dx * dx + dy * dy);
                        positions[pointIdx * 2] = x;
                        positions[pointIdx * 2 + 1] = y;
                        arcLengths[pointIdx] = cumLength;
                        prevX = x;
                        prevY = y;
                        pointIdx++;
                        coordIdx += 2;
                    }
                    break;

                case 2: // C (cubic bezier - approximate arc length)
                    {
                        // Sample bezier at several points to estimate length
                        const x1 = coords[coordIdx];
                        const y1 = coords[coordIdx + 1];
                        const x2 = coords[coordIdx + 2];
                        const y2 = coords[coordIdx + 3];
                        const x3 = coords[coordIdx + 4];
                        const y3 = coords[coordIdx + 5];

                        // Track arc length at control point positions (roughly 1/3 and 2/3)
                        const startLength = cumLength;

                        // Simple chord approximation (good enough for our purposes)
                        const samples = 8;
                        let bx = prevX, by = prevY;
                        for (let t = 1; t <= samples; t++) {
                            const s = t / samples;
                            const s2 = s * s;
                            const s3 = s2 * s;
                            const mt = 1 - s;
                            const mt2 = mt * mt;
                            const mt3 = mt2 * mt;

                            const nx = mt3 * prevX + 3 * mt2 * s * x1 + 3 * mt * s2 * x2 + s3 * x3;
                            const ny = mt3 * prevY + 3 * mt2 * s * y1 + 3 * mt * s2 * y2 + s3 * y3;

                            cumLength += Math.sqrt((nx - bx) ** 2 + (ny - by) ** 2);
                            bx = nx;
                            by = ny;
                        }

                        // Interpolate arc lengths for control points
                        const segmentLength = cumLength - startLength;

                        // Store arc length for each control point and endpoint
                        positions[pointIdx * 2] = x1;
                        positions[pointIdx * 2 + 1] = y1;
                        arcLengths[pointIdx] = startLength + segmentLength * 0.33;
                        pointIdx++;

                        positions[pointIdx * 2] = x2;
                        positions[pointIdx * 2 + 1] = y2;
                        arcLengths[pointIdx] = startLength + segmentLength * 0.67;
                        pointIdx++;

                        positions[pointIdx * 2] = x3;
                        positions[pointIdx * 2 + 1] = y3;
                        arcLengths[pointIdx] = cumLength;
                        pointIdx++;

                        prevX = x3;
                        prevY = y3;
                        coordIdx += 6;
                    }
                    break;

                case 5: // Z
                    // Close path - no coordinates
                    break;
            }
        }

        return { arcLengths, positions, total: cumLength };
    }

    // Convert parametric t (0-1) to point index
    private tToPointIndex(t: number): number {
        const targetLength = t * this.totalArcLength;
        const numPoints = this.pointArcLengths.length;

        // Binary search for closest point
        let lo = 0, hi = numPoints - 1;
        while (lo < hi) {
            const mid = Math.floor((lo + hi) / 2);
            if (this.pointArcLengths[mid] < targetLength) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }

    // Convert point index to parametric t
    private pointIndexToT(idx: number): number {
        if (this.totalArcLength === 0) return 0;
        return this.pointArcLengths[idx] / this.totalArcLength;
    }

    // Get path distance between two parametric positions
    // For closed paths, considers wrap-around (shorter of two directions)
    // For open paths, uses simple linear distance
    private pathDistance(t1: number, t2: number): number {
        const d = Math.abs(t1 - t2);
        if (this.isClosedPath) {
            return Math.min(d, 1 - d);  // Wrap-around for closed paths
        }
        return d;  // Simple distance for open paths
    }

    // Generate a schedule of foci for a given loop period
    generateSchedule(loopPeriod: number, params: EldritchFocusParams, seed?: number): void {
        this.scheduleSeed = seed ?? Math.floor(Math.random() * 1000000);
        const rng = new SeededRNG(this.scheduleSeed);

        // Validate and clamp parameters to prevent invalid states
        const minFoci = Math.max(1, Math.floor(params.minFoci));
        const maxFoci = Math.max(minFoci, Math.floor(params.maxFoci));
        const focusDurationMin = Math.max(0.1, params.focusDurationMin);
        const focusDurationMax = Math.max(focusDurationMin, params.focusDurationMax);
        const restDurationMin = Math.max(0, params.restDurationMin);
        const restDurationMax = Math.max(restDurationMin, params.restDurationMax);

        const foci: Focus[] = [];
        const restPeriods: Array<{ start: number; end: number }> = [];

        let currentTime = 0;
        const motionStyles: MotionStyle[] = ['whip', 'quiver', 'strain', 'thrash'];
        const weights = [
            Math.max(0, params.motionWeights.whip),
            Math.max(0, params.motionWeights.quiver),
            Math.max(0, params.motionWeights.strain),
            Math.max(0, params.motionWeights.thrash),
        ];

        // Build schedule until we exceed loop period
        while (currentTime < loopPeriod) {
            // Decide how many foci this wave
            const numFoci = Math.floor(rng.range(minFoci, maxFoci + 0.99));

            // Generate foci for this wave
            const waveFoci: Focus[] = [];
            const usedPositions: number[] = [];

            for (let i = 0; i < numFoci; i++) {
                // Pick position avoiding anchors and other foci
                let pathT: number;
                let attempts = 0;
                do {
                    pathT = rng.next();
                    attempts++;
                } while (
                    attempts < 20 &&
                    (this.isNearAnchor(pathT) ||
                     usedPositions.some(p => this.pathDistance(p, pathT) < 0.15))
                );

                usedPositions.push(pathT);

                const style = rng.weightedChoice(motionStyles, weights);
                const duration = rng.range(focusDurationMin, focusDurationMax);

                // Timing: slight stagger between foci in same wave
                const stagger = i * rng.range(0.1, 0.3);

                const focus: Focus = {
                    pathT,
                    startTime: currentTime + stagger,
                    rampDuration: duration * 0.2,
                    sustainDuration: duration * 0.5,
                    decayDuration: duration * 0.3,
                    motionStyle: style,
                    direction: rng.range(-1, 1),
                    frequency: rng.range(8, 20),  // For quiver
                    intensity: rng.range(0.7, 1.3),
                    waveSpeed: params.propagationSpeed * rng.range(0.8, 1.2),
                };

                waveFoci.push(focus);
            }

            foci.push(...waveFoci);

            // Advance time past this wave
            const maxFocusEnd = Math.max(...waveFoci.map(f =>
                f.startTime + f.rampDuration + f.sustainDuration + f.decayDuration
            ));

            // Add rest period
            const restDuration = rng.range(restDurationMin, restDurationMax);
            restPeriods.push({
                start: maxFocusEnd,
                end: maxFocusEnd + restDuration,
            });

            currentTime = maxFocusEnd + restDuration;
        }

        // Trim schedule to fit loop period and ensure clean loop point
        // Find a good rest period to use as loop boundary
        let bestRestIdx = restPeriods.length - 1;
        for (let i = restPeriods.length - 1; i >= 0; i--) {
            if (restPeriods[i].start <= loopPeriod && restPeriods[i].end >= loopPeriod * 0.9) {
                bestRestIdx = i;
                break;
            }
        }

        // Adjust schedule to end at a rest period
        const loopEnd = restPeriods[bestRestIdx]?.end ?? loopPeriod;
        const validFoci = foci.filter(f =>
            f.startTime + f.rampDuration + f.sustainDuration + f.decayDuration <= loopEnd
        );

        this.schedule = {
            foci: validFoci,
            totalDuration: loopEnd,
            restPeriods: restPeriods.filter(r => r.end <= loopEnd),
        };
        this.scheduleLoopPeriod = loopPeriod;
    }

    // Check if a path position is near an anchor (pinned point)
    private isNearAnchor(pathT: number): boolean {
        const pointIdx = this.tToPointIndex(pathT);
        const numPoints = this.anchorInfluence.length;

        // Check nearby points within ANCHOR_CHECK_RADIUS
        for (let offset = -ANCHOR_CHECK_RADIUS; offset <= ANCHOR_CHECK_RADIUS; offset++) {
            const idx = (pointIdx + offset + numPoints) % numPoints;
            if (this.anchorInfluence[idx] < ANCHOR_INFLUENCE_THRESHOLD) {
                return true;  // This area is pinned
            }
        }
        return false;
    }

    // Get the envelope (intensity) of a focus at a given time
    private getFocusEnvelope(focus: Focus, time: number): number {
        const elapsed = time - focus.startTime;
        if (elapsed < 0) return 0;

        const { rampDuration, sustainDuration, decayDuration } = focus;
        const totalDuration = rampDuration + sustainDuration + decayDuration;

        if (elapsed > totalDuration) return 0;

        if (elapsed < rampDuration) {
            // Ramp up - smooth start
            const t = elapsed / rampDuration;
            return t * t * (3 - 2 * t);  // Smoothstep
        } else if (elapsed < rampDuration + sustainDuration) {
            // Sustain
            return 1;
        } else {
            // Decay - smooth end
            const t = (elapsed - rampDuration - sustainDuration) / decayDuration;
            return 1 - t * t * (3 - 2 * t);  // Inverse smoothstep
        }
    }

    // Get displacement for a single point from a focus
    // Accepts pointIdx directly to avoid redundant i→t→i binary search
    private getFocusDisplacement(
        focus: Focus,
        pointIdx: number,
        pointT: number,
        time: number,
        params: EldritchFocusParams
    ): { dx: number; dy: number } {
        const envelope = this.getFocusEnvelope(focus, time);
        if (envelope < 0.001) return { dx: 0, dy: 0 };

        // Distance along path from focus
        const pathDist = this.pathDistance(pointT, focus.pathT);

        // Propagation: motion arrives later at distant points
        const propagationDelay = pathDist / (focus.waveSpeed * 0.1);
        const effectiveTime = time - focus.startTime - propagationDelay;

        if (effectiveTime < 0) return { dx: 0, dy: 0 };

        // Distance falloff
        const distanceFalloff = Math.exp(-pathDist / params.propagationDecay);

        // Get point position for direction calculations (using pointIdx directly)
        const px = this.pointPositions[pointIdx * 2];
        const py = this.pointPositions[pointIdx * 2 + 1];

        // Get focus position
        const focusIdx = this.tToPointIndex(focus.pathT);
        const fx = this.pointPositions[focusIdx * 2];
        const fy = this.pointPositions[focusIdx * 2 + 1];

        // Direction from focus to point (for strain/whip)
        const toPointX = px - fx;
        const toPointY = py - fy;
        const toPointLen = Math.sqrt(toPointX * toPointX + toPointY * toPointY) || 1;
        const dirX = toPointX / toPointLen;
        const dirY = toPointY / toPointLen;

        // Perpendicular (for whip sideways motion)
        const perpX = -dirY;
        const perpY = dirX;

        let dx = 0, dy = 0;

        switch (focus.motionStyle) {
            case 'whip': {
                // Quick lateral deflection that travels down the path
                // Sharp attack, smooth release
                const whipPhase = effectiveTime * 12;
                const whipWave = Math.sin(whipPhase) * Math.exp(-effectiveTime * 3);
                dx = perpX * whipWave * focus.direction * 20;
                dy = perpY * whipWave * focus.direction * 20;
                break;
            }

            case 'quiver': {
                // High-frequency tremor, more sustained
                const quiverPhase = effectiveTime * focus.frequency * 2 * Math.PI;
                // Add noise for organic irregularity
                const noiseX = this.noise.noise3D(px * 0.1, py * 0.1, time * 5);
                const noiseY = this.noise.noise3D(px * 0.1 + 100, py * 0.1, time * 5);
                dx = (Math.sin(quiverPhase) + noiseX * 0.5) * 8;
                dy = (Math.cos(quiverPhase * 1.3) + noiseY * 0.5) * 8;
                break;
            }

            case 'strain': {
                // Slow pull away from anchor/origin, like trying to tear free
                // Builds up, holds, releases
                const strainPhase = Math.min(effectiveTime * 2, 1);
                const strainCurve = strainPhase * strainPhase * (3 - 2 * strainPhase);
                // Pull outward from focus
                dx = dirX * strainCurve * focus.direction * 15;
                dy = dirY * strainCurve * focus.direction * 15;
                break;
            }

            case 'thrash': {
                // Chaotic multi-directional burst
                const thrashSpeed = 8;
                const nx = this.noise.noise3D(px * 0.05, py * 0.05, time * thrashSpeed);
                const ny = this.noise.noise3D(px * 0.05 + 50, py * 0.05, time * thrashSpeed);
                // Add rapid direction changes
                const chaos = Math.sin(effectiveTime * 20) * Math.sin(effectiveTime * 13);
                dx = (nx + chaos * 0.3) * 25;
                dy = (ny + chaos * 0.3) * 25;
                break;
            }
        }

        // Apply envelope, distance falloff, and intensity
        const scale = envelope * distanceFalloff * focus.intensity * params.baseIntensity;
        return { dx: dx * scale, dy: dy * scale };
    }

    // Calculate displacement for all points at a given time
    calculateDisplacements(
        time: number,
        params: EldritchFocusParams,
        loopPeriod: number
    ): Float32Array {
        const numPoints = this.parsedPath.coords.length / 2;

        const targetLoopPeriod = loopPeriod > 0 ? loopPeriod : 10;

        // Generate schedule if needed
        if (
            !this.schedule ||
            this.scheduleLoopPeriod === null ||
            Math.abs(this.scheduleLoopPeriod - targetLoopPeriod) > 0.1
        ) {
            this.generateSchedule(targetLoopPeriod, params);
        }

        // Handle looping
        const effectiveTime = loopPeriod > 0
            ? time % this.schedule.totalDuration
            : time;

        // Allocate or reuse displacement buffer
        if (!this.cachedDisplacements || this.cachedDisplacements.length !== numPoints * 2) {
            this.cachedDisplacements = new Float32Array(numPoints * 2);
        }

        const displacements = this.cachedDisplacements;
        displacements.fill(0);

        // Check if we're in a global rest period
        const inRest = this.schedule.restPeriods.some(
            r => effectiveTime >= r.start && effectiveTime <= r.end
        );

        // Calculate displacement for each point
        for (let i = 0; i < numPoints; i++) {
            const pointT = this.pointIndexToT(i);
            let totalDx = 0;
            let totalDy = 0;

            // Sum contributions from all active foci
            if (!inRest) {
                for (const focus of this.schedule.foci) {
                    const { dx, dy } = this.getFocusDisplacement(
                        focus, i, pointT, effectiveTime, params
                    );
                    totalDx += dx;
                    totalDy += dy;
                }
            }

            // Add subtle resting drift (so static areas aren't frozen)
            if (params.restingDrift > 0) {
                const px = this.pointPositions[i * 2];
                const py = this.pointPositions[i * 2 + 1];
                const driftX = this.noise.noise3D(px * 0.02, py * 0.02, time * 0.3) * params.restingDrift * 5;
                const driftY = this.noise.noise3D(px * 0.02 + 100, py * 0.02, time * 0.3) * params.restingDrift * 5;
                totalDx += driftX;
                totalDy += driftY;
            }

            displacements[i * 2] = totalDx;
            displacements[i * 2 + 1] = totalDy;
        }

        this.lastTime = effectiveTime;
        return displacements;
    }

    // Update anchor influence (when anchors change)
    setAnchorInfluence(influence: Float32Array): void {
        this.anchorInfluence = influence;
    }

    // Force schedule regeneration
    regenerateSchedule(loopPeriod: number, params: EldritchFocusParams, seed?: number): void {
        this.generateSchedule(loopPeriod, params, seed);
    }

    // Get current schedule info (for debugging/UI)
    getScheduleInfo(): {
        numFoci: number;
        duration: number;
        activeFoci: number;
    } | null {
        if (!this.schedule) return null;

        const now = this.lastTime;
        const activeFoci = this.schedule.foci.filter(f => {
            const elapsed = now - f.startTime;
            const total = f.rampDuration + f.sustainDuration + f.decayDuration;
            return elapsed >= 0 && elapsed <= total;
        }).length;

        return {
            numFoci: this.schedule.foci.length,
            duration: this.schedule.totalDuration,
            activeFoci,
        };
    }
}
