// SVG Path Parser - converts path d attribute to typed arrays for efficient animation

export interface ParsedPath {
    // Command types: M=0, L=1, C=2, S=3, Q=4, Z=5
    commands: number[];
    // All coordinates flattened: [x1,y1, x2,y2, ...]
    coords: Float32Array;
    totalCommands: number;
    totalCoords: number;
}

const CMD_M = 0;
const CMD_L = 1;
const CMD_C = 2;
const CMD_Z = 5;

export function parsePath(d: string, transformOffset: { tx: number; ty: number } = { tx: 0, ty: 0 }): ParsedPath {
    console.log('Starting path parse with transform offset:', transformOffset);

    // Tokenize: extract commands and numbers
    const tokenRegex = /([MmLlCcSsQqTtAaHhVvZz])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi;
    const tokens: (string | number)[] = [];
    let match;

    while ((match = tokenRegex.exec(d)) !== null) {
        if (match[1]) {
            tokens.push(match[1]);
        } else {
            tokens.push(parseFloat(match[0]));
        }
    }

    console.log(`Tokenized: ${tokens.length} tokens`);

    // Parse into commands and coordinates
    const commands: number[] = [];
    const coordsList: number[] = [];

    // The transform offset shifts coordinates into viewBox space
    // SVG group has transform="translate(-84, -80)" meaning we ADD the offset to get viewBox coords
    // BUT: only apply to absolute coordinates, not relative ones
    const offsetX = transformOffset.tx;
    const offsetY = transformOffset.ty;

    let curX = 0, curY = 0;
    let startX = 0, startY = 0;
    let lastCmd = '';
    let lastControlX = 0, lastControlY = 0;
    let i = 0;
    let firstCommand = true;

    while (i < tokens.length) {
        const token = tokens[i];

        if (typeof token === 'string') {
            // Handle Z immediately since it has no coordinates
            if (token.toUpperCase() === 'Z') {
                commands.push(CMD_Z);
                curX = startX;
                curY = startY;
            }
            lastCmd = token;
            i++;
            continue;
        }

        // We have a number, so we need to process based on last command
        const isRelative = lastCmd === lastCmd.toLowerCase();
        const cmd = lastCmd.toUpperCase();
        const baseX = isRelative ? curX : 0;
        const baseY = isRelative ? curY : 0;

        switch (cmd) {
            case 'M': {
                // For absolute M, apply offset. For relative m (after first), it's relative to current pos
                const useOffset = !isRelative || firstCommand;
                const x = (tokens[i] as number) + baseX + (useOffset ? offsetX : 0);
                const y = (tokens[i + 1] as number) + baseY + (useOffset ? offsetY : 0);
                commands.push(CMD_M);
                coordsList.push(x, y);
                curX = startX = x;
                curY = startY = y;
                lastControlX = x;
                lastControlY = y;
                i += 2;
                firstCommand = false;
                // After M, implicit commands are L (preserve relative/absolute)
                lastCmd = isRelative ? 'l' : 'L';
                break;
            }
            case 'L': {
                const x = (tokens[i] as number) + baseX;
                const y = (tokens[i + 1] as number) + baseY;
                commands.push(CMD_L);
                coordsList.push(x, y);
                curX = x;
                curY = y;
                lastControlX = x;
                lastControlY = y;
                i += 2;
                break;
            }
            case 'H': {
                const x = (tokens[i] as number) + (isRelative ? curX : 0);
                commands.push(CMD_L);
                coordsList.push(x, curY);
                curX = x;
                lastControlX = x;
                lastControlY = curY;
                i += 1;
                break;
            }
            case 'V': {
                const y = (tokens[i] as number) + (isRelative ? curY : 0);
                commands.push(CMD_L);
                coordsList.push(curX, y);
                curY = y;
                lastControlX = curX;
                lastControlY = y;
                i += 1;
                break;
            }
            case 'C': {
                const x1 = (tokens[i] as number) + baseX;
                const y1 = (tokens[i + 1] as number) + baseY;
                const x2 = (tokens[i + 2] as number) + baseX;
                const y2 = (tokens[i + 3] as number) + baseY;
                const x = (tokens[i + 4] as number) + baseX;
                const y = (tokens[i + 5] as number) + baseY;
                commands.push(CMD_C);
                coordsList.push(x1, y1, x2, y2, x, y);
                curX = x;
                curY = y;
                lastControlX = x2;
                lastControlY = y2;
                i += 6;
                break;
            }
            case 'S': {
                // Smooth curve: first control point is reflection of last
                let cx1: number, cy1: number;
                if (lastCmd === 'C' || lastCmd === 'c' || lastCmd === 'S' || lastCmd === 's') {
                    cx1 = 2 * curX - lastControlX;
                    cy1 = 2 * curY - lastControlY;
                } else {
                    cx1 = curX;
                    cy1 = curY;
                }
                const x2 = (tokens[i] as number) + baseX;
                const y2 = (tokens[i + 1] as number) + baseY;
                const x = (tokens[i + 2] as number) + baseX;
                const y = (tokens[i + 3] as number) + baseY;
                commands.push(CMD_C);
                coordsList.push(cx1, cy1, x2, y2, x, y);
                curX = x;
                curY = y;
                lastControlX = x2;
                lastControlY = y2;
                i += 4;
                break;
            }
            case 'Q': {
                const x1 = (tokens[i] as number) + baseX;
                const y1 = (tokens[i + 1] as number) + baseY;
                const x = (tokens[i + 2] as number) + baseX;
                const y = (tokens[i + 3] as number) + baseY;
                // Convert quadratic to cubic
                const cx1 = curX + (2/3) * (x1 - curX);
                const cy1 = curY + (2/3) * (y1 - curY);
                const cx2 = x + (2/3) * (x1 - x);
                const cy2 = y + (2/3) * (y1 - y);
                commands.push(CMD_C);
                coordsList.push(cx1, cy1, cx2, cy2, x, y);
                curX = x;
                curY = y;
                lastControlX = x1;
                lastControlY = y1;
                i += 4;
                break;
            }
            case 'Z': {
                // Z is handled above when we see the command letter
                // This case is here for safety but shouldn't be reached
                break;
            }
            default:
                // Skip unknown
                i++;
        }

        // Update lastCmd for S command reflection logic
        // Keep the original case to track relative/absolute
        if (cmd !== 'M') {
            lastCmd = isRelative ? cmd.toLowerCase() : cmd;
        }
    }

    console.log(`Parsed: ${commands.length} commands, ${coordsList.length} coords`);

    return {
        commands,
        coords: new Float32Array(coordsList),
        totalCommands: commands.length,
        totalCoords: coordsList.length,
    };
}

// Extract path d attribute from SVG text
export function extractPathFromSvg(svgText: string): { d: string; viewBox: string; transform: string } | null {
    const pathMatch = svgText.match(/\bd="([^"]+)"/);
    const viewBoxMatch = svgText.match(/viewBox="([^"]+)"/);
    const transformMatch = svgText.match(/<g[^>]*transform="([^"]+)"[^>]*>/);

    if (!pathMatch) {
        console.error('No path found in SVG');
        return null;
    }

    console.log('Extracted path, viewBox, transform from SVG');

    return {
        d: pathMatch[1],
        viewBox: viewBoxMatch ? viewBoxMatch[1] : '0 0 100 100',
        transform: transformMatch ? transformMatch[1] : '',
    };
}

// Parse transform attribute to get translation offset
export function parseTransform(transform: string): { tx: number; ty: number } {
    const translateMatch = transform.match(/translate\(([^,\s]+)[,\s]+([^)]+)\)/);
    if (translateMatch) {
        return {
            tx: parseFloat(translateMatch[1]),
            ty: parseFloat(translateMatch[2]),
        };
    }
    return { tx: 0, ty: 0 };
}
