/**
 * Project Manager - Save/Load .nflux project files
 *
 * .nflux files are JSON containing:
 * - Embedded SVG (base64 encoded)
 * - Animation parameters
 * - Anchor data
 * - Stretch configuration
 * - View state (zoom/pan)
 */

import { AnimationParams } from './frameAnimator';
import { AnchorData } from './anchorInfluence';
import { StretchConfig } from './stretchZone';

// Current schema version for migration support
const CURRENT_VERSION = 1;

// localStorage key and limits
const STORAGE_KEY = 'nouveau-flux-recent-projects';
const MAX_RECENT = 10;

/**
 * Project file schema
 */
export interface NfluxProject {
    version: number;
    name: string;
    created: string;   // ISO timestamp
    modified: string;  // ISO timestamp
    svg: {
        name: string;  // Original filename
        data: string;  // Base64-encoded SVG content
    };
    animationParams: AnimationParams;
    anchors: AnchorData[];
    stretchConfig: StretchConfig;
    viewState: {
        zoom: number;
        pan: { x: number; y: number };
    };
}

/**
 * Recent project entry for localStorage
 */
export interface RecentProject {
    name: string;
    modified: string;
}

/**
 * Custom error class for project operations
 */
export class ProjectError extends Error {
    constructor(
        message: string,
        public readonly code: 'INVALID_JSON' | 'INVALID_SCHEMA' | 'VERSION_UNSUPPORTED' | 'SVG_DECODE_FAILED' | 'FILE_READ_FAILED'
    ) {
        super(message);
        this.name = 'ProjectError';
    }
}

// --- SVG Encoding/Decoding ---

/**
 * Encode SVG string to base64
 */
export function encodeSvg(svgText: string): string {
    // Use TextEncoder for proper UTF-8 handling
    const encoder = new TextEncoder();
    const bytes = encoder.encode(svgText);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Decode base64 to SVG string
 */
export function decodeSvg(base64: string): string {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
}

/**
 * Create blob URL from base64 SVG (for AnimatedFrame svgPath prop)
 */
export function createSvgBlobUrl(base64: string): string {
    const svgText = decodeSvg(base64);
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    return URL.createObjectURL(blob);
}

// --- Project Serialization ---

/**
 * Create a project object from current app state
 */
export function createProject(
    name: string,
    svgName: string,
    svgContent: string,
    animationParams: AnimationParams,
    anchors: AnchorData[],
    stretchConfig: StretchConfig,
    viewState: { zoom: number; pan: { x: number; y: number } }
): NfluxProject {
    const now = new Date().toISOString();
    return {
        version: CURRENT_VERSION,
        name,
        created: now,
        modified: now,
        svg: {
            name: svgName,
            data: encodeSvg(svgContent),
        },
        animationParams,
        anchors,
        stretchConfig,
        viewState,
    };
}

/**
 * Validate and parse project JSON
 */
export function parseProject(json: string): NfluxProject {
    let data: unknown;

    try {
        data = JSON.parse(json);
    } catch {
        throw new ProjectError('Invalid JSON format', 'INVALID_JSON');
    }

    return validateProject(data);
}

/**
 * Validate project schema and apply migrations
 */
export function validateProject(data: unknown): NfluxProject {
    if (typeof data !== 'object' || data === null) {
        throw new ProjectError('Project must be an object', 'INVALID_SCHEMA');
    }

    const obj = data as Record<string, unknown>;

    // Version check
    if (typeof obj.version !== 'number') {
        throw new ProjectError('Missing version field', 'INVALID_SCHEMA');
    }

    if (obj.version > CURRENT_VERSION) {
        throw new ProjectError(
            `Project version ${obj.version} is newer than supported version ${CURRENT_VERSION}. Please update the app.`,
            'VERSION_UNSUPPORTED'
        );
    }

    // Validate required fields
    const requiredFields = ['name', 'created', 'modified', 'svg', 'animationParams', 'anchors', 'stretchConfig', 'viewState'];
    for (const field of requiredFields) {
        if (!(field in obj)) {
            throw new ProjectError(`Missing required field: ${field}`, 'INVALID_SCHEMA');
        }
    }

    // Validate SVG structure
    if (typeof obj.svg !== 'object' || obj.svg === null) {
        throw new ProjectError('Invalid SVG data', 'INVALID_SCHEMA');
    }

    const svg = obj.svg as Record<string, unknown>;
    if (typeof svg.name !== 'string' || typeof svg.data !== 'string') {
        throw new ProjectError('SVG must have name and data fields', 'INVALID_SCHEMA');
    }

    // Validate base64 decoding
    try {
        decodeSvg(svg.data as string);
    } catch {
        throw new ProjectError('SVG data is not valid base64', 'SVG_DECODE_FAILED');
    }

    // Apply migrations if needed
    return migrateProject(data as NfluxProject);
}

/**
 * Migrate older project versions to current schema
 */
export function migrateProject(project: NfluxProject): NfluxProject {
    const migrated = { ...project };

    // Version 1 is current - no migrations needed yet
    // Future migrations would go here:
    // if (migrated.version === 1) {
    //     // Add new fields with defaults
    //     migrated.newField = migrated.newField ?? defaultValue;
    //     migrated.version = 2;
    // }

    return migrated;
}

// --- File I/O (Browser APIs) ---

/**
 * Download project as .nflux file
 */
export function downloadProject(project: NfluxProject, filename?: string): void {
    // Update modified timestamp
    const projectToSave = {
        ...project,
        modified: new Date().toISOString(),
    };

    const json = JSON.stringify(projectToSave, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `${project.name}.nflux`;
    a.click();

    URL.revokeObjectURL(url);
}

/**
 * Open file picker for .nflux files
 */
export function openProjectFile(): Promise<NfluxProject> {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.nflux';

        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) {
                reject(new Error('No file selected'));
                return;
            }

            try {
                const text = await file.text();
                const project = parseProject(text);
                resolve(project);
            } catch (err) {
                reject(err);
            }
        };

        // Handle cancel - input doesn't fire oncancel in all browsers
        // so we use a focus event after a delay
        const handleFocus = () => {
            setTimeout(() => {
                if (!input.files?.length) {
                    reject(new Error('Cancelled'));
                }
                window.removeEventListener('focus', handleFocus);
            }, 300);
        };
        window.addEventListener('focus', handleFocus);

        input.click();
    });
}

/**
 * Open file picker for .svg files (for Import SVG)
 */
export function importSvgFile(): Promise<{ name: string; content: string }> {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.svg';

        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) {
                reject(new Error('No file selected'));
                return;
            }

            try {
                const content = await file.text();
                resolve({ name: file.name, content });
            } catch {
                reject(new ProjectError('Failed to read SVG file', 'FILE_READ_FAILED'));
            }
        };

        const handleFocus = () => {
            setTimeout(() => {
                if (!input.files?.length) {
                    reject(new Error('Cancelled'));
                }
                window.removeEventListener('focus', handleFocus);
            }, 300);
        };
        window.addEventListener('focus', handleFocus);

        input.click();
    });
}

// --- Recent Projects (localStorage) ---

/**
 * Get list of recent projects from localStorage
 */
export function getRecentProjects(): RecentProject[] {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return [];
        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) return [];
        return parsed.slice(0, MAX_RECENT);
    } catch {
        return [];
    }
}

/**
 * Add project to recent list (moves to top if exists)
 */
export function addRecentProject(project: RecentProject): void {
    const recent = getRecentProjects();

    // Remove if already exists
    const filtered = recent.filter(p => p.name !== project.name);

    // Add to front
    filtered.unshift(project);

    // Trim to max
    const trimmed = filtered.slice(0, MAX_RECENT);

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
        // localStorage might be full or disabled - silently ignore
    }
}

/**
 * Remove project from recent list
 */
export function removeRecentProject(name: string): void {
    const recent = getRecentProjects();
    const filtered = recent.filter(p => p.name !== name);

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    } catch {
        // Silently ignore
    }
}

/**
 * Clear all recent projects
 */
export function clearRecentProjects(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Silently ignore
    }
}
