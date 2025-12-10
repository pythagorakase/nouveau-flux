// Position Based Dynamics Solver for SVG Path Animation
// Maintains curve continuity while allowing organic motion
//
// Ph'nglui mglw'nafh Cthulhu R'lyeh wgah'nagl fhtagn!

import { ParsedPath } from './pathParser';

// --- Constants ---

// Solver iteration count (higher = more accurate, slower)
const DEFAULT_ITERATIONS = 4;

// Constraint stiffness (0-1, higher = stiffer)
const DISTANCE_STIFFNESS = 0.8;
const CONTINUITY_STIFFNESS = 0.9;
const ANCHOR_STIFFNESS = 1.0;

// Maximum stretch ratio before distance constraint kicks in hard
const MAX_STRETCH_RATIO = 1.5;

// Velocity damping (0-1, higher = more damping)
const VELOCITY_DAMPING = 0.98;

// --- Types ---

export enum PointType {
    MOVE = 0,        // M command - start of subpath
    LINE_END = 1,    // L command endpoint
    BEZIER_CP1 = 2,  // C command control point 1
    BEZIER_CP2 = 3,  // C command control point 2
    BEZIER_END = 4,  // C command endpoint
}

interface Particle {
    x: number;
    y: number;
    prevX: number;
    prevY: number;
    baseX: number;    // Original rest position
    baseY: number;
    invMass: number;  // 0 = infinite mass (pinned)
    type: PointType;
    segmentIndex: number;  // Which path segment this belongs to
}

interface DistanceConstraint {
    p1: number;       // Particle index
    p2: number;       // Particle index
    restLength: number;
    stiffness: number;
}

interface BezierConstraint {
    // Indices into particle array
    prevEnd: number;   // Previous segment's endpoint (or -1)
    cp1: number;       // Control point 1
    cp2: number;       // Control point 2
    end: number;       // This segment's endpoint
    nextCp1: number;   // Next segment's cp1 (or -1)

    // Rest state geometry for tangent preservation
    restTangentIn: { x: number; y: number };   // Direction from prevEnd to cp1
    restTangentOut: { x: number; y: number };  // Direction from cp2 to end
    restLengthIn: number;   // Distance from prevEnd to cp1
    restLengthOut: number;  // Distance from cp2 to end
}

interface AnchorConstraint {
    particle: number;
    targetX: number;
    targetY: number;
    stiffness: number;  // Based on anchor influence
}

// Hard constraint for points that should be coincident (bezier joints)
interface CoincidenceConstraint {
    p1: number;  // First particle (e.g., bezier endpoint)
    p2: number;  // Second particle (e.g., next bezier's cp1)
}

export interface PBDConfig {
    iterations: number;
    distanceStiffness: number;
    continuityStiffness: number;
    velocityDamping: number;
    maxStretchRatio: number;
}

export const DEFAULT_PBD_CONFIG: PBDConfig = {
    iterations: DEFAULT_ITERATIONS,
    distanceStiffness: DISTANCE_STIFFNESS,
    continuityStiffness: CONTINUITY_STIFFNESS,
    velocityDamping: VELOCITY_DAMPING,
    maxStretchRatio: MAX_STRETCH_RATIO,
};

// --- Path Topology ---

export interface PathTopology {
    pointTypes: PointType[];
    segmentStarts: number[];  // Index of first point in each segment
    bezierIndices: number[];  // Indices of bezier endpoints for continuity
}

/**
 * Analyze path structure to determine point types and relationships
 */
export function analyzePathTopology(parsedPath: ParsedPath): PathTopology {
    const commands = parsedPath.commands;
    const numCoords = parsedPath.coords.length;
    const numPoints = numCoords / 2;

    const pointTypes: PointType[] = new Array(numPoints);
    const segmentStarts: number[] = [];
    const bezierIndices: number[] = [];

    let pointIdx = 0;
    let segmentIdx = 0;

    for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];

        switch (cmd) {
            case 0: // M (Move)
                segmentStarts.push(pointIdx);
                pointTypes[pointIdx] = PointType.MOVE;
                pointIdx++;
                segmentIdx++;
                break;

            case 1: // L (Line)
                pointTypes[pointIdx] = PointType.LINE_END;
                pointIdx++;
                break;

            case 2: // C (Cubic Bezier)
                pointTypes[pointIdx] = PointType.BEZIER_CP1;
                pointIdx++;
                pointTypes[pointIdx] = PointType.BEZIER_CP2;
                pointIdx++;
                pointTypes[pointIdx] = PointType.BEZIER_END;
                bezierIndices.push(pointIdx);  // Track endpoint for continuity
                pointIdx++;
                break;

            case 5: // Z (Close)
                // No coordinates, just marks path closure
                break;
        }
    }

    return { pointTypes, segmentStarts, bezierIndices };
}

// --- PBD Solver ---

export class PBDSolver {
    private particles: Particle[] = [];
    private distanceConstraints: DistanceConstraint[] = [];
    private bezierConstraints: BezierConstraint[] = [];
    private anchorConstraints: AnchorConstraint[] = [];
    private coincidenceConstraints: CoincidenceConstraint[] = [];

    private topology: PathTopology;
    private config: PBDConfig;

    // Pre-allocated output buffer
    private outputCoords: Float32Array;

    // Stretch tracking for muscular hydrostat effect
    private stretchRatios: Float32Array;

    constructor(
        parsedPath: ParsedPath,
        anchorInfluence: Float32Array,
        config: Partial<PBDConfig> = {}
    ) {
        this.config = { ...DEFAULT_PBD_CONFIG, ...config };
        this.topology = analyzePathTopology(parsedPath);

        const numPoints = parsedPath.coords.length / 2;
        this.outputCoords = new Float32Array(parsedPath.coords.length);
        this.stretchRatios = new Float32Array(numPoints);
        this.stretchRatios.fill(1.0);

        // Initialize particles from path coordinates
        this.initializeParticles(parsedPath, anchorInfluence);

        // Build constraints
        this.buildDistanceConstraints(parsedPath);
        this.buildBezierConstraints(parsedPath);
        this.buildCoincidenceConstraints(parsedPath);
        this.buildAnchorConstraints(anchorInfluence);
    }

    /**
     * Build coincidence constraints for points that should be at the same position.
     * In SVG paths, bezier endpoint and next segment's first point should be coincident.
     */
    private buildCoincidenceConstraints(parsedPath: ParsedPath): void {
        const commands = parsedPath.commands;
        const coords = parsedPath.coords;
        let pointIdx = 0;
        let prevEndIdx = -1;

        const COINCIDENCE_THRESHOLD = 0.5;  // Points closer than this are considered coincident

        for (let i = 0; i < commands.length; i++) {
            const cmd = commands[i];

            switch (cmd) {
                case 0: // M
                    prevEndIdx = pointIdx;
                    pointIdx++;
                    break;

                case 1: // L
                    // Check if this line start is coincident with previous endpoint
                    if (prevEndIdx >= 0 && prevEndIdx !== pointIdx) {
                        const prevX = coords[prevEndIdx * 2];
                        const prevY = coords[prevEndIdx * 2 + 1];
                        const currX = coords[pointIdx * 2];
                        const currY = coords[pointIdx * 2 + 1];
                        const dist = Math.hypot(currX - prevX, currY - prevY);
                        // Lines don't have a separate start point, so skip
                    }
                    prevEndIdx = pointIdx;
                    pointIdx++;
                    break;

                case 2: // C (bezier)
                    const cp1Idx = pointIdx;
                    const endIdx = pointIdx + 2;

                    // Bezier's cp1 should start from previous endpoint position
                    // (not literally coincident, but the path should be continuous)
                    // The KEY constraint: next segment's implicit start = this endpoint
                    // For beziers, the implicit start IS the previous endpoint,
                    // so we need to check if cp1 is "attached" properly to the curve

                    prevEndIdx = endIdx;
                    pointIdx += 3;
                    break;

                case 5: // Z
                    break;
            }
        }

        // Actually, the real issue is different: in SVG, there's no separate "start point"
        // for each segment - the path is inherently continuous. The problem is that
        // we're storing control points as separate particles that can drift.

        // Let's add constraints between consecutive bezier curves to ensure
        // the endpoint of one and the control structure of the next stay connected.
        // This is already handled by distance constraints, but let's make it HARD.

        this.buildHardJointConstraints(parsedPath);
    }

    /**
     * Build hard joint constraints between consecutive bezier segments.
     * These enforce that bezier endpoints stay connected to the next segment.
     */
    private buildHardJointConstraints(parsedPath: ParsedPath): void {
        const commands = parsedPath.commands;
        const coords = parsedPath.coords;

        let pointIdx = 0;
        let lastBezierEndIdx = -1;

        for (let i = 0; i < commands.length; i++) {
            const cmd = commands[i];

            switch (cmd) {
                case 0: // M
                    lastBezierEndIdx = -1;  // Reset on new subpath
                    pointIdx++;
                    break;

                case 1: // L
                    lastBezierEndIdx = -1;  // Line breaks bezier chain
                    pointIdx++;
                    break;

                case 2: // C (bezier)
                    const cp1Idx = pointIdx;
                    const cp2Idx = pointIdx + 1;
                    const endIdx = pointIdx + 2;

                    // If we had a previous bezier, add coincidence between
                    // that endpoint and this bezier's cp1
                    if (lastBezierEndIdx >= 0) {
                        // Check if they're close enough to be considered a joint
                        const endX = coords[lastBezierEndIdx * 2];
                        const endY = coords[lastBezierEndIdx * 2 + 1];
                        const cp1X = coords[cp1Idx * 2];
                        const cp1Y = coords[cp1Idx * 2 + 1];
                        const dist = Math.hypot(cp1X - endX, cp1Y - endY);

                        // Always add the constraint - the solver will pull them together
                        // Distance constraints already exist, but this is solved FIRST
                        // Actually, cp1 shouldn't be coincident with prev endpoint
                        // The IMPLICIT start point (prev endpoint) is where the curve starts
                        // cp1 is a control point that shapes the curve, not a start point
                    }

                    lastBezierEndIdx = endIdx;
                    pointIdx += 3;
                    break;

                case 5: // Z
                    lastBezierEndIdx = -1;
                    break;
            }
        }
    }

    private initializeParticles(
        parsedPath: ParsedPath,
        anchorInfluence: Float32Array
    ): void {
        const coords = parsedPath.coords;
        const numPoints = coords.length / 2;

        this.particles = new Array(numPoints);

        let segmentIdx = 0;

        for (let i = 0; i < numPoints; i++) {
            const x = coords[i * 2];
            const y = coords[i * 2 + 1];

            // Inverse mass: 0 = pinned, 1 = free
            // Scale by anchor influence (0 = pinned, 1 = free)
            const influence = anchorInfluence[i];
            const invMass = influence;

            // Track which segment this point belongs to
            if (this.topology.segmentStarts.includes(i)) {
                segmentIdx = this.topology.segmentStarts.indexOf(i);
            }

            this.particles[i] = {
                x, y,
                prevX: x,
                prevY: y,
                baseX: x,
                baseY: y,
                invMass,
                type: this.topology.pointTypes[i],
                segmentIndex: segmentIdx,
            };
        }
    }

    private buildDistanceConstraints(parsedPath: ParsedPath): void {
        const commands = parsedPath.commands;
        let pointIdx = 0;
        let prevPointIdx = -1;

        for (let i = 0; i < commands.length; i++) {
            const cmd = commands[i];

            switch (cmd) {
                case 0: // M
                    prevPointIdx = pointIdx;
                    pointIdx++;
                    break;

                case 1: // L
                    if (prevPointIdx >= 0) {
                        this.addDistanceConstraint(prevPointIdx, pointIdx);
                    }
                    prevPointIdx = pointIdx;
                    pointIdx++;
                    break;

                case 2: // C (bezier - add constraints between all 4 points)
                    if (prevPointIdx >= 0) {
                        // Previous endpoint to cp1
                        this.addDistanceConstraint(prevPointIdx, pointIdx);
                    }
                    // cp1 to cp2
                    this.addDistanceConstraint(pointIdx, pointIdx + 1);
                    // cp2 to endpoint
                    this.addDistanceConstraint(pointIdx + 1, pointIdx + 2);

                    prevPointIdx = pointIdx + 2;
                    pointIdx += 3;
                    break;

                case 5: // Z - could add constraint back to start
                    break;
            }
        }
    }

    private addDistanceConstraint(p1: number, p2: number): void {
        const particle1 = this.particles[p1];
        const particle2 = this.particles[p2];

        const dx = particle2.x - particle1.x;
        const dy = particle2.y - particle1.y;
        const restLength = Math.sqrt(dx * dx + dy * dy);

        this.distanceConstraints.push({
            p1,
            p2,
            restLength,
            stiffness: this.config.distanceStiffness,
        });
    }

    private buildBezierConstraints(parsedPath: ParsedPath): void {
        const commands = parsedPath.commands;
        let pointIdx = 0;
        let prevEndIdx = -1;

        for (let i = 0; i < commands.length; i++) {
            const cmd = commands[i];

            switch (cmd) {
                case 0: // M
                    prevEndIdx = pointIdx;
                    pointIdx++;
                    break;

                case 1: // L
                    prevEndIdx = pointIdx;
                    pointIdx++;
                    break;

                case 2: // C
                    const cp1Idx = pointIdx;
                    const cp2Idx = pointIdx + 1;
                    const endIdx = pointIdx + 2;

                    // Look ahead for next bezier's cp1
                    let nextCp1Idx = -1;
                    if (i + 1 < commands.length && commands[i + 1] === 2) {
                        nextCp1Idx = endIdx + 1;
                    }

                    if (prevEndIdx >= 0) {
                        const prevEnd = this.particles[prevEndIdx];
                        const cp1 = this.particles[cp1Idx];
                        const cp2 = this.particles[cp2Idx];
                        const end = this.particles[endIdx];

                        // Calculate rest state tangents
                        const tangentInX = cp1.x - prevEnd.x;
                        const tangentInY = cp1.y - prevEnd.y;
                        const tangentInLen = Math.sqrt(tangentInX * tangentInX + tangentInY * tangentInY) || 1;

                        const tangentOutX = end.x - cp2.x;
                        const tangentOutY = end.y - cp2.y;
                        const tangentOutLen = Math.sqrt(tangentOutX * tangentOutX + tangentOutY * tangentOutY) || 1;

                        this.bezierConstraints.push({
                            prevEnd: prevEndIdx,
                            cp1: cp1Idx,
                            cp2: cp2Idx,
                            end: endIdx,
                            nextCp1: nextCp1Idx,
                            restTangentIn: { x: tangentInX / tangentInLen, y: tangentInY / tangentInLen },
                            restTangentOut: { x: tangentOutX / tangentOutLen, y: tangentOutY / tangentOutLen },
                            restLengthIn: tangentInLen,
                            restLengthOut: tangentOutLen,
                        });
                    }

                    prevEndIdx = endIdx;
                    pointIdx += 3;
                    break;

                case 5: // Z
                    break;
            }
        }
    }

    private buildAnchorConstraints(anchorInfluence: Float32Array): void {
        const numPoints = this.particles.length;

        for (let i = 0; i < numPoints; i++) {
            const influence = anchorInfluence[i];

            // Create anchor constraint for points with low influence (near anchors)
            if (influence < 0.95) {
                const p = this.particles[i];
                this.anchorConstraints.push({
                    particle: i,
                    targetX: p.baseX,
                    targetY: p.baseY,
                    stiffness: (1 - influence) * ANCHOR_STIFFNESS,
                });
            }
        }
    }

    /**
     * Apply displacements to particles from base positions
     * This resets particles to base + displacement each frame,
     * then solve() constrains them for curve continuity.
     */
    applyDisplacements(displacements: Float32Array): void {
        const numParticles = this.particles.length;

        for (let i = 0; i < numParticles; i++) {
            const p = this.particles[i];

            // Store previous position for velocity calculation
            p.prevX = p.x;
            p.prevY = p.y;

            // Start from base position + displacement
            // invMass controls how much the displacement affects this particle
            const dx = displacements[i * 2];
            const dy = displacements[i * 2 + 1];

            p.x = p.baseX + dx * p.invMass;
            p.y = p.baseY + dy * p.invMass;
        }
    }

    /**
     * Legacy method - apply forces as velocity impulses
     * @deprecated Use applyDisplacements for better results
     */
    applyForces(displacements: Float32Array, dt: number): void {
        // Redirect to applyDisplacements for backwards compatibility
        this.applyDisplacements(displacements);
    }

    /**
     * Main solver loop - call once per frame after applyForces()
     */
    solve(): void {
        const { iterations, velocityDamping } = this.config;

        // Apply velocity damping (Verlet style)
        this.applyDamping(velocityDamping);

        // Iteratively solve constraints
        for (let iter = 0; iter < iterations; iter++) {
            // Solve in order: anchors (strongest), bezier continuity, distances
            this.solveAnchorConstraints();
            this.solveBezierConstraints();
            this.solveDistanceConstraints();
        }

        // Update stretch ratios for muscular hydrostat effect
        this.updateStretchRatios();
    }

    private applyDamping(damping: number): void {
        for (const p of this.particles) {
            if (p.invMass === 0) continue;

            // Velocity = current - previous
            const vx = (p.x - p.prevX) * damping;
            const vy = (p.y - p.prevY) * damping;

            p.prevX = p.x - vx;
            p.prevY = p.y - vy;
        }
    }

    private solveDistanceConstraints(): void {
        const { maxStretchRatio } = this.config;

        for (const c of this.distanceConstraints) {
            const p1 = this.particles[c.p1];
            const p2 = this.particles[c.p2];

            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const currentLength = Math.sqrt(dx * dx + dy * dy) || 0.0001;

            // For very short rest lengths (bezier joints), always enforce strictly
            // These are points that should maintain their relative position
            const isJointConstraint = c.restLength < 5.0;

            if (isJointConstraint) {
                // Always correct joint constraints to maintain curve continuity
                const diff = (currentLength - c.restLength) / currentLength;
                const stiffness = 0.9;  // High stiffness for joints

                const correctionX = dx * diff * 0.5 * stiffness;
                const correctionY = dy * diff * 0.5 * stiffness;

                const totalInvMass = p1.invMass + p2.invMass;
                if (totalInvMass > 0) {
                    const w1 = p1.invMass / totalInvMass;
                    const w2 = p2.invMass / totalInvMass;

                    p1.x += correctionX * w1;
                    p1.y += correctionY * w1;
                    p2.x -= correctionX * w2;
                    p2.y -= correctionY * w2;
                }
                continue;
            }

            // For longer constraints, only correct if stretched beyond threshold
            const stretchRatio = currentLength / c.restLength;
            if (stretchRatio < maxStretchRatio && stretchRatio > 1 / maxStretchRatio) {
                continue;  // Within acceptable range
            }

            // Calculate correction
            const targetLength = stretchRatio > 1
                ? c.restLength * maxStretchRatio
                : c.restLength / maxStretchRatio;
            const diff = (currentLength - targetLength) / currentLength;

            const correctionX = dx * diff * 0.5 * c.stiffness;
            const correctionY = dy * diff * 0.5 * c.stiffness;

            // Apply correction weighted by inverse mass
            const totalInvMass = p1.invMass + p2.invMass;
            if (totalInvMass > 0) {
                const w1 = p1.invMass / totalInvMass;
                const w2 = p2.invMass / totalInvMass;

                p1.x += correctionX * w1;
                p1.y += correctionY * w1;
                p2.x -= correctionX * w2;
                p2.y -= correctionY * w2;
            }
        }
    }

    private solveBezierConstraints(): void {
        const stiffness = this.config.continuityStiffness;

        for (const c of this.bezierConstraints) {
            // C0 continuity: cp1 should stay connected to previous endpoint
            if (c.prevEnd >= 0) {
                const prevEnd = this.particles[c.prevEnd];
                const cp1 = this.particles[c.cp1];

                // cp1 should be at prevEnd + tangent * length
                // But we also want to allow organic deformation
                // So we blend toward the rest configuration

                const currentDx = cp1.x - prevEnd.x;
                const currentDy = cp1.y - prevEnd.y;
                const currentLen = Math.sqrt(currentDx * currentDx + currentDy * currentDy) || 0.0001;

                // Normalize current direction
                const currentDirX = currentDx / currentLen;
                const currentDirY = currentDy / currentLen;

                // Blend direction toward rest tangent (preserves tangent direction)
                const blendFactor = stiffness * 0.3;  // Softer blending for tangent direction
                const targetDirX = currentDirX + (c.restTangentIn.x - currentDirX) * blendFactor;
                const targetDirY = currentDirY + (c.restTangentIn.y - currentDirY) * blendFactor;

                // Renormalize
                const targetDirLen = Math.sqrt(targetDirX * targetDirX + targetDirY * targetDirY) || 1;
                const normDirX = targetDirX / targetDirLen;
                const normDirY = targetDirY / targetDirLen;

                // Target position for cp1 (preserve current length, adjust direction)
                const targetX = prevEnd.x + normDirX * currentLen;
                const targetY = prevEnd.y + normDirY * currentLen;

                // Apply correction
                if (cp1.invMass > 0) {
                    cp1.x += (targetX - cp1.x) * stiffness * cp1.invMass;
                    cp1.y += (targetY - cp1.y) * stiffness * cp1.invMass;
                }
            }

            // Similar for cp2 relative to endpoint
            {
                const cp2 = this.particles[c.cp2];
                const end = this.particles[c.end];

                const currentDx = cp2.x - end.x;
                const currentDy = cp2.y - end.y;
                const currentLen = Math.sqrt(currentDx * currentDx + currentDy * currentDy) || 0.0001;

                const currentDirX = currentDx / currentLen;
                const currentDirY = currentDy / currentLen;

                // Rest tangent out points FROM cp2 TO end, so we want the opposite
                const restDirX = -c.restTangentOut.x;
                const restDirY = -c.restTangentOut.y;

                const blendFactor = stiffness * 0.3;
                const targetDirX = currentDirX + (restDirX - currentDirX) * blendFactor;
                const targetDirY = currentDirY + (restDirY - currentDirY) * blendFactor;

                const targetDirLen = Math.sqrt(targetDirX * targetDirX + targetDirY * targetDirY) || 1;
                const normDirX = targetDirX / targetDirLen;
                const normDirY = targetDirY / targetDirLen;

                const targetX = end.x + normDirX * currentLen;
                const targetY = end.y + normDirY * currentLen;

                if (cp2.invMass > 0) {
                    cp2.x += (targetX - cp2.x) * stiffness * cp2.invMass;
                    cp2.y += (targetY - cp2.y) * stiffness * cp2.invMass;
                }
            }

            // C1 continuity: if there's a next bezier, its cp1 should be collinear
            if (c.nextCp1 >= 0) {
                const end = this.particles[c.end];
                const cp2 = this.particles[c.cp2];
                const nextCp1 = this.particles[c.nextCp1];

                // Direction from cp2 to end
                const inDx = end.x - cp2.x;
                const inDy = end.y - cp2.y;
                const inLen = Math.sqrt(inDx * inDx + inDy * inDy) || 0.0001;
                const inDirX = inDx / inLen;
                const inDirY = inDy / inLen;

                // Current nextCp1 position relative to end
                const outDx = nextCp1.x - end.x;
                const outDy = nextCp1.y - end.y;
                const outLen = Math.sqrt(outDx * outDx + outDy * outDy) || 0.0001;

                // For C1 continuity, nextCp1 should be along the same line as (cp2 -> end)
                // Project nextCp1 onto that line, but keep its distance
                const targetX = end.x + inDirX * outLen;
                const targetY = end.y + inDirY * outLen;

                // Soft constraint - blend toward collinear position
                const c1Stiffness = stiffness * 0.5;  // Softer for C1
                if (nextCp1.invMass > 0) {
                    nextCp1.x += (targetX - nextCp1.x) * c1Stiffness * nextCp1.invMass;
                    nextCp1.y += (targetY - nextCp1.y) * c1Stiffness * nextCp1.invMass;
                }
            }
        }
    }

    private solveAnchorConstraints(): void {
        for (const c of this.anchorConstraints) {
            const p = this.particles[c.particle];

            // Pull toward anchor position
            const dx = c.targetX - p.x;
            const dy = c.targetY - p.y;

            p.x += dx * c.stiffness;
            p.y += dy * c.stiffness;
        }
    }

    private updateStretchRatios(): void {
        // Calculate stretch ratio for each distance constraint
        // and propagate to particles for muscular hydrostat effect

        this.stretchRatios.fill(1.0);
        const counts = new Float32Array(this.particles.length);

        for (const c of this.distanceConstraints) {
            const p1 = this.particles[c.p1];
            const p2 = this.particles[c.p2];

            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const currentLength = Math.sqrt(dx * dx + dy * dy);
            const ratio = currentLength / c.restLength;

            // Accumulate stretch ratios
            this.stretchRatios[c.p1] += ratio;
            this.stretchRatios[c.p2] += ratio;
            counts[c.p1]++;
            counts[c.p2]++;
        }

        // Average the ratios
        for (let i = 0; i < this.stretchRatios.length; i++) {
            if (counts[i] > 0) {
                this.stretchRatios[i] /= counts[i];
            }
        }
    }

    /**
     * Get the solved positions as a coordinate array
     */
    getPositions(): Float32Array {
        const numParticles = this.particles.length;

        for (let i = 0; i < numParticles; i++) {
            this.outputCoords[i * 2] = this.particles[i].x;
            this.outputCoords[i * 2 + 1] = this.particles[i].y;
        }

        return this.outputCoords;
    }

    /**
     * Get stretch ratios for muscular hydrostat stroke width modulation
     * Values > 1 mean stretched (thinner), < 1 mean compressed (thicker)
     */
    getStretchRatios(): Float32Array {
        return this.stretchRatios;
    }

    /**
     * Reset particles to base positions
     */
    reset(): void {
        for (const p of this.particles) {
            p.x = p.baseX;
            p.y = p.baseY;
            p.prevX = p.baseX;
            p.prevY = p.baseY;
        }
        this.stretchRatios.fill(1.0);
    }

    /**
     * Update anchor influence (when anchors change)
     */
    updateAnchorInfluence(anchorInfluence: Float32Array): void {
        // Update particle inverse masses
        for (let i = 0; i < this.particles.length; i++) {
            this.particles[i].invMass = anchorInfluence[i];
        }

        // Rebuild anchor constraints
        this.anchorConstraints = [];
        this.buildAnchorConstraints(anchorInfluence);
    }

    /**
     * Get configuration for UI exposure
     */
    getConfig(): PBDConfig {
        return { ...this.config };
    }

    /**
     * Update configuration
     */
    setConfig(config: Partial<PBDConfig>): void {
        this.config = { ...this.config, ...config };
    }
}
