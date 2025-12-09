// Anchor Influence Map - computes how much each path point can move based on distance to anchors

export type AnchorType = 'rect' | 'line' | 'single';

export interface Anchor {
    x: number;
    y: number;
    type: AnchorType;
    groupId: number;
    // For rect anchors
    corner?: 'tl' | 'tr' | 'bl' | 'br';
    // For line anchors
    position?: 'start' | 'end';
}

// Legacy format from corners.json (backward compatible)
export interface LegacyAnchorData {
    x: string;
    y: string;
    rectId?: number;
    corner?: string;
}

// New unified format (also accepts legacy format)
export interface AnchorData {
    type?: AnchorType; // Optional for backward compat (defaults to 'rect')
    groupId?: number;  // Optional for backward compat (uses rectId)
    x: string;
    y: string;
    // For rect: corner position (accepts string for legacy compat)
    corner?: string;
    rectId?: number;   // Legacy field
    // For line: endpoint position
    position?: 'start' | 'end';
}

// Quintic smoothstep for ultra-smooth falloff: 6t^5 - 15t^4 + 10t^3
function quinticSmoothstep(t: number): number {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Compute influence map for all path coordinates
 * @param coords - Float32Array of path coordinates [x1,y1,x2,y2,...]
 * @param anchors - Array of anchor points (fixed positions)
 * @param falloffRadius - Distance from anchor where full movement begins
 * @param transformOffset - SVG transform offset to add to anchors {tx, ty}
 * @returns Float32Array where each value is 0 (pinned) to 1 (free movement)
 */
export function computeInfluenceMap(
    coords: Float32Array,
    anchors: Anchor[],
    falloffRadius: number,
    transformOffset: { tx: number; ty: number } = { tx: 0, ty: 0 }
): Float32Array {
    const numPoints = coords.length / 2;
    const influence = new Float32Array(numPoints);

    // Transform anchors to path coordinate space
    // The SVG has transform="translate(-84.2, -80.7)" on the group,
    // so path coords are offset. We need to add this to anchor coords.
    const transformedAnchors = anchors.map(a => ({
        ...a,
        x: a.x - transformOffset.tx, // Subtract because transform is negative
        y: a.y - transformOffset.ty,
    }));

    // Group line anchors for line segment distance calculations
    const lineGroups = groupLineAnchors(transformedAnchors);

    // Get point anchors (rect corners and single points)
    const pointAnchors = transformedAnchors.filter(a => a.type === 'rect' || a.type === 'single');

    for (let i = 0; i < numPoints; i++) {
        const px = coords[i * 2];
        const py = coords[i * 2 + 1];

        let minDist = Infinity;

        // Distance to point anchors (rect corners and single points)
        for (const anchor of pointAnchors) {
            const dx = px - anchor.x;
            const dy = py - anchor.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDist) {
                minDist = dist;
            }
        }

        // Distance to line anchors (use distance to line segment)
        for (const [, line] of lineGroups) {
            if (line.start && line.end) {
                const dist = distanceToLineSegment(
                    px, py,
                    line.start.x, line.start.y,
                    line.end.x, line.end.y
                );
                if (dist < minDist) {
                    minDist = dist;
                }
            }
        }

        // Compute influence: 0 at anchor, 1 beyond falloffRadius
        const t = minDist / falloffRadius;
        influence[i] = quinticSmoothstep(t);
    }

    return influence;
}

/**
 * Load anchors from data (supports both legacy corners.json and new unified format)
 */
export function loadAnchors(data: AnchorData[]): Anchor[] {
    return data.map(item => {
        // Parse corner string to typed corner (validate it's a known value)
        let corner: Anchor['corner'];
        if (item.corner === 'tl' || item.corner === 'tr' || item.corner === 'bl' || item.corner === 'br') {
            corner = item.corner;
        }

        return {
            x: parseFloat(item.x),
            y: parseFloat(item.y),
            type: item.type ?? 'rect',
            groupId: item.groupId ?? item.rectId ?? 0,
            corner,
            position: item.position,
        };
    });
}

/**
 * Group anchors by type and groupId for line distance calculations
 */
function groupLineAnchors(anchors: Anchor[]): Map<number, { start?: Anchor; end?: Anchor }> {
    const lines = new Map<number, { start?: Anchor; end?: Anchor }>();

    for (const anchor of anchors) {
        if (anchor.type !== 'line') continue;

        if (!lines.has(anchor.groupId)) {
            lines.set(anchor.groupId, {});
        }
        const line = lines.get(anchor.groupId)!;
        if (anchor.position === 'start') line.start = anchor;
        if (anchor.position === 'end') line.end = anchor;
    }

    return lines;
}

/**
 * Calculate minimum distance from point to line segment
 */
function distanceToLineSegment(
    px: number, py: number,
    x1: number, y1: number,
    x2: number, y2: number
): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy;

    if (lengthSq === 0) {
        // Line segment is a point
        return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    }

    // Project point onto line, clamped to segment
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;

    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

/**
 * Debug: get influence at a specific point
 */
export function getInfluenceAt(
    x: number,
    y: number,
    anchors: Anchor[],
    falloffRadius: number,
    transformOffset: { tx: number; ty: number } = { tx: 0, ty: 0 }
): number {
    const transformedAnchors = anchors.map(a => ({
        ...a,
        x: a.x - transformOffset.tx,
        y: a.y - transformOffset.ty,
    }));

    const lineGroups = groupLineAnchors(transformedAnchors);
    const pointAnchors = transformedAnchors.filter(a => a.type === 'rect' || a.type === 'single');

    let minDist = Infinity;

    // Point anchors
    for (const anchor of pointAnchors) {
        const dx = x - anchor.x;
        const dy = y - anchor.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist) minDist = dist;
    }

    // Line anchors
    for (const [, line] of lineGroups) {
        if (line.start && line.end) {
            const dist = distanceToLineSegment(
                x, y,
                line.start.x, line.start.y,
                line.end.x, line.end.y
            );
            if (dist < minDist) minDist = dist;
        }
    }

    return quinticSmoothstep(minDist / falloffRadius);
}

/**
 * Create default anchors for a new rectangle group
 */
export function createRectAnchors(
    groupId: number,
    x: number,
    y: number,
    width: number,
    height: number
): Anchor[] {
    return [
        { type: 'rect', groupId, corner: 'tl', x, y },
        { type: 'rect', groupId, corner: 'tr', x: x + width, y },
        { type: 'rect', groupId, corner: 'bl', x, y: y + height },
        { type: 'rect', groupId, corner: 'br', x: x + width, y: y + height },
    ];
}

/**
 * Create default anchors for a new line group
 */
export function createLineAnchors(
    groupId: number,
    x1: number, y1: number,
    x2: number, y2: number
): Anchor[] {
    return [
        { type: 'line', groupId, position: 'start', x: x1, y: y1 },
        { type: 'line', groupId, position: 'end', x: x2, y: y2 },
    ];
}

/**
 * Create a single point anchor
 */
export function createSingleAnchor(
    groupId: number,
    x: number,
    y: number
): Anchor {
    return { type: 'single', groupId, x, y };
}
