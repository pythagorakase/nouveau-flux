/**
 * Stretch Zone - Non-destructive stretching of SVG regions
 *
 * For SVGs with parallel straight-line sections (common in Art Nouveau frames):
 *
 *    A -------- straight -------- B
 *    |                            |
 *  curved                       curved
 *    |                            |
 *    C -------- straight -------- D
 *
 * A-B and C-D: Straight lines (STRETCHABLE)
 * A-C and B-D: Decorative curves (PRESERVED)
 *
 * Stretching expands symmetrically from the zone center:
 * - Both edges move outward by stretchAmount/2
 * - Points inside the zone interpolate based on position from center
 */

/** Horizontal stretch zone - stretches along X axis */
export interface StretchZoneX {
    enabled: boolean;
    leftEdge: number;   // X coordinate of left boundary
    rightEdge: number;  // X coordinate of right boundary
    stretchAmount: number;  // Positive = expand, negative = compress
}

/** Vertical stretch zone - stretches along Y axis */
export interface StretchZoneY {
    enabled: boolean;
    topEdge: number;    // Y coordinate of top boundary
    bottomEdge: number; // Y coordinate of bottom boundary
    stretchAmount: number;  // Positive = expand, negative = compress
}

/** Combined stretch configuration */
export interface StretchConfig {
    x: StretchZoneX;
    y: StretchZoneY;
}

/**
 * Create default stretch config for the viewBox
 * Places zone boundaries at 1/3 and 2/3 of each dimension
 */
export function createDefaultStretchConfig(viewBoxWidth: number, viewBoxHeight: number): StretchConfig {
    return {
        x: {
            enabled: false,
            leftEdge: viewBoxWidth / 3,
            rightEdge: (viewBoxWidth * 2) / 3,
            stretchAmount: 0,
        },
        y: {
            enabled: false,
            topEdge: viewBoxHeight / 3,
            bottomEdge: (viewBoxHeight * 2) / 3,
            stretchAmount: 0,
        },
    };
}

/**
 * Apply horizontal stretch to a single X coordinate
 * Symmetric expansion from zone center
 */
function applyStretchX(x: number, zone: StretchZoneX): number {
    if (!zone.enabled || zone.stretchAmount === 0) {
        return x;
    }

    const zoneWidth = zone.rightEdge - zone.leftEdge;
    if (zoneWidth <= 0) return x;

    const zoneCenter = (zone.leftEdge + zone.rightEdge) / 2;
    const halfStretch = zone.stretchAmount / 2;

    if (x <= zone.leftEdge) {
        // Left of zone - shift left by half stretch
        return x - halfStretch;
    } else if (x >= zone.rightEdge) {
        // Right of zone - shift right by half stretch
        return x + halfStretch;
    } else {
        // Inside zone - interpolate from center
        // t = -1 at leftEdge, 0 at center, +1 at rightEdge
        const t = (x - zoneCenter) / (zoneWidth / 2);
        return x + t * halfStretch;
    }
}

/**
 * Apply vertical stretch to a single Y coordinate
 * Symmetric expansion from zone center
 */
function applyStretchY(y: number, zone: StretchZoneY): number {
    if (!zone.enabled || zone.stretchAmount === 0) {
        return y;
    }

    const zoneHeight = zone.bottomEdge - zone.topEdge;
    if (zoneHeight <= 0) return y;

    const zoneCenter = (zone.topEdge + zone.bottomEdge) / 2;
    const halfStretch = zone.stretchAmount / 2;

    if (y <= zone.topEdge) {
        // Above zone - shift up by half stretch
        return y - halfStretch;
    } else if (y >= zone.bottomEdge) {
        // Below zone - shift down by half stretch
        return y + halfStretch;
    } else {
        // Inside zone - interpolate from center
        const t = (y - zoneCenter) / (zoneHeight / 2);
        return y + t * halfStretch;
    }
}

/**
 * Apply stretch transformations to path coordinates
 *
 * @param coords - Float32Array of path coordinates [x1,y1,x2,y2,...]
 * @param config - The stretch configuration
 * @returns New Float32Array with transformed coordinates
 */
export function applyStretchConfig(
    coords: Float32Array,
    config: StretchConfig | null
): Float32Array {
    if (!config) {
        return coords;
    }

    const xActive = config.x.enabled && config.x.stretchAmount !== 0;
    const yActive = config.y.enabled && config.y.stretchAmount !== 0;

    if (!xActive && !yActive) {
        return coords;
    }

    const result = new Float32Array(coords.length);
    const numPoints = coords.length / 2;

    for (let i = 0; i < numPoints; i++) {
        let x = coords[i * 2];
        let y = coords[i * 2 + 1];

        if (xActive) {
            x = applyStretchX(x, config.x);
        }
        if (yActive) {
            y = applyStretchY(y, config.y);
        }

        result[i * 2] = x;
        result[i * 2 + 1] = y;
    }

    return result;
}

/**
 * Get the new viewBox dimensions after applying stretch
 */
export function getStretchedViewBox(
    viewBoxWidth: number,
    viewBoxHeight: number,
    config: StretchConfig | null
): { width: number; height: number } {
    if (!config) {
        return { width: viewBoxWidth, height: viewBoxHeight };
    }

    let width = viewBoxWidth;
    let height = viewBoxHeight;

    if (config.x.enabled) {
        width += config.x.stretchAmount;
    }
    if (config.y.enabled) {
        height += config.y.stretchAmount;
    }

    return { width, height };
}

/**
 * Clamp stretch amount to prevent negative dimensions
 */
export function clampStretchAmountX(amount: number, zone: StretchZoneX, viewBoxWidth: number): number {
    const zoneWidth = zone.rightEdge - zone.leftEdge;
    const minAmount = -zoneWidth * 0.9;
    const maxAmount = viewBoxWidth * 2;
    return Math.max(minAmount, Math.min(maxAmount, amount));
}

export function clampStretchAmountY(amount: number, zone: StretchZoneY, viewBoxHeight: number): number {
    const zoneHeight = zone.bottomEdge - zone.topEdge;
    const minAmount = -zoneHeight * 0.9;
    const maxAmount = viewBoxHeight * 2;
    return Math.max(minAmount, Math.min(maxAmount, amount));
}
