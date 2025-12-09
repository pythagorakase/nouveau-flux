// Anchor Influence Map - computes how much each path point can move based on distance to anchors

export interface Anchor {
    x: number;
    y: number;
    rectId?: number;
    corner?: string;
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
        x: a.x - transformOffset.tx, // Subtract because transform is negative
        y: a.y - transformOffset.ty,
    }));

    for (let i = 0; i < numPoints; i++) {
        const px = coords[i * 2];
        const py = coords[i * 2 + 1];

        // Find minimum distance to any anchor
        let minDistSq = Infinity;
        for (const anchor of transformedAnchors) {
            const dx = px - anchor.x;
            const dy = py - anchor.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < minDistSq) {
                minDistSq = distSq;
            }
        }

        const minDist = Math.sqrt(minDistSq);

        // Compute influence: 0 at anchor, 1 beyond falloffRadius
        const t = minDist / falloffRadius;
        influence[i] = quinticSmoothstep(t);
    }

    return influence;
}

/**
 * Load anchors from the corners.json format
 */
export function loadAnchors(data: Array<{ x: string; y: string; rectId?: number; corner?: string }>): Anchor[] {
    return data.map(item => ({
        x: parseFloat(item.x),
        y: parseFloat(item.y),
        rectId: item.rectId,
        corner: item.corner,
    }));
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
        x: a.x - transformOffset.tx,
        y: a.y - transformOffset.ty,
    }));

    let minDistSq = Infinity;
    for (const anchor of transformedAnchors) {
        const dx = x - anchor.x;
        const dy = y - anchor.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < minDistSq) {
            minDistSq = distSq;
        }
    }

    const minDist = Math.sqrt(minDistSq);
    return quinticSmoothstep(minDist / falloffRadius);
}
