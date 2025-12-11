// Path Analysis - utilities for analyzing SVG path structure
// Used by debug overlays in AnchorEditor

import { ParsedPath } from './pathParser';

// Point types in a parsed path
export enum PointType {
    MOVE = 0,        // M command - start of subpath
    LINE_END = 1,    // L command endpoint
    BEZIER_CP1 = 2,  // C command control point 1
    BEZIER_CP2 = 3,  // C command control point 2
    BEZIER_END = 4,  // C command endpoint
}

// Topology information about a path
export interface PathTopology {
    pointTypes: PointType[];
    segmentStarts: number[];  // Index of first point in each segment
}

/**
 * Analyze path structure to determine point types and segment boundaries
 */
export function analyzePathTopology(parsedPath: ParsedPath): PathTopology {
    const commands = parsedPath.commands;
    const numCoords = parsedPath.coords.length;
    const numPoints = numCoords / 2;

    const pointTypes: PointType[] = new Array(numPoints);
    const segmentStarts: number[] = [];

    let pointIdx = 0;

    for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];

        switch (cmd) {
            case 0: // M (Move)
                segmentStarts.push(pointIdx);
                pointTypes[pointIdx] = PointType.MOVE;
                pointIdx++;
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
                pointIdx++;
                break;

            case 5: // Z (Close)
                // No coordinates, just marks path closure
                break;
        }
    }

    return { pointTypes, segmentStarts };
}
