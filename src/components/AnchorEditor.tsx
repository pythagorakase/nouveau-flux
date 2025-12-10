import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { AnchorData, AnchorType } from '@/lib/anchorInfluence';
import { StretchConfig, applyStretchConfig, getStretchedViewBox } from '@/lib/stretchZone';
import { parsePath, extractPathFromSvg, parseTransform, buildPathString, ParsedPath } from '@/lib/pathParser';
import { analyzePathTopology, PointType, PathTopology } from '@/lib/pbdSolver';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { NumberStepper } from './NumberStepper';
import { SliderControl } from './SliderControl';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { X, Square, Minus, Circle, ChevronLeft, ChevronRight } from 'lucide-react';

// Snap tolerance in SVG units
const SNAP_TOLERANCE = 3;
// Minimum line length in SVG units (prevents degenerate zero-length lines)
const MIN_LINE_LENGTH = 5;
// Minimum gap between stretch zone edges in SVG units
const MIN_ZONE_SIZE = 5;

interface AnchorEditorProps {
    svgPath: string;
    anchors: AnchorData[];
    onAnchorsChange: (anchors: AnchorData[]) => void;
    stretchConfig: StretchConfig;
    onStretchConfigChange: (config: StretchConfig) => void;
    onClose: () => void;
}

type EditMode = 'select' | 'rect' | 'line' | 'single';

interface DragState {
    mode: 'single' | 'group' | 'resize' | 'stretch';
    anchorIndex: number;
    startMouse: { x: number; y: number };
    startAnchor: { x: number; y: number };
    // For group drag - all anchors in the group
    groupAnchors?: Array<{ index: number; x: number; y: number }>;
    // For resize - which corner and the opposite corner position
    resizeCorner?: 'tl' | 'tr' | 'bl' | 'br';
    oppositeCorner?: { x: number; y: number };
    groupId?: number;
    // For stretch edge drag
    stretchEdge?: 'x-left' | 'x-right' | 'y-top' | 'y-bottom';
    startStretchValue?: number;
}

// Colors for different anchor types
const ANCHOR_COLORS = {
    rect: '#22c55e',    // Green
    line: '#3b82f6',    // Blue
    single: '#f59e0b',  // Amber
};

// Generate color for rect groups
const getRectGroupColor = (groupId: number): string => {
    const hue = (groupId * 137.5) % 360;
    return `hsl(${hue}, 70%, 55%)`;
};

export const AnchorEditor: React.FC<AnchorEditorProps> = ({
    svgPath,
    anchors,
    onAnchorsChange,
    stretchConfig,
    onStretchConfigChange,
    onClose,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [svgContent, setSvgContent] = useState<string>('');
    const [viewBox, setViewBox] = useState({ width: 215, height: 181 });
    const [editMode, setEditMode] = useState<EditMode>('select');

    // View state
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const panStartRef = useRef({ x: 0, y: 0 });
    // RAF throttling for mouse move performance
    const rafIdRef = useRef<number | null>(null);

    // Drag state
    const [dragState, setDragState] = useState<DragState | null>(null);
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

    // Line creation state
    const [lineStart, setLineStart] = useState<{ x: number; y: number } | null>(null);

    // Sidebar state
    const [sidebarOpen, setSidebarOpen] = useState(true);

    // Guidelines state
    const [showGuidelines, setShowGuidelines] = useState(true);
    const [snapEnabled, setSnapEnabled] = useState(true);
    const [activeGuidelines, setActiveGuidelines] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });

    // Anchor visibility
    const [showAnchors, setShowAnchors] = useState(true);

    // Parsed path for stretch preview
    const [parsedPath, setParsedPath] = useState<ParsedPath | null>(null);

    // Path topology for debug visualization
    const [pathTopology, setPathTopology] = useState<PathTopology | null>(null);
    const [showTopology, setShowTopology] = useState(false);

    // Compute stretched path string for preview
    const stretchedPathString = useMemo(() => {
        if (!parsedPath) return null;

        const hasStretch = (stretchConfig.x.enabled && stretchConfig.x.stretchAmount !== 0) ||
                          (stretchConfig.y.enabled && stretchConfig.y.stretchAmount !== 0);
        if (!hasStretch) return null;

        const stretchedCoords = applyStretchConfig(parsedPath.coords, stretchConfig);
        const stretchedPath: ParsedPath = {
            ...parsedPath,
            coords: stretchedCoords,
        };
        return buildPathString(stretchedPath);
    }, [parsedPath, stretchConfig]);

    // Get stretched viewBox dimensions
    const stretchedViewBox = useMemo(() => {
        return getStretchedViewBox(viewBox.width, viewBox.height, stretchConfig);
    }, [viewBox, stretchConfig]);

    // Compute anchor counts
    const anchorCounts = useMemo(() => {
        const rectGroups = new Set<number>();
        const lineGroups = new Set<number>();
        let singleCount = 0;

        for (const a of anchors) {
            if (a.type === 'rect') rectGroups.add(a.groupId ?? 0);
            else if (a.type === 'line') lineGroups.add(a.groupId ?? 0);
            else if (a.type === 'single') singleCount++;
        }

        return {
            rect: rectGroups.size,
            line: lineGroups.size,
            single: singleCount,
        };
    }, [anchors]);

    // Handle rect count change
    const handleRectCountChange = useCallback((newCount: number) => {
        const currentRectGroups = new Set(anchors.filter(a => a.type === 'rect').map(a => a.groupId ?? 0));
        const currentCount = currentRectGroups.size;

        if (newCount > currentCount) {
            const newAnchors = [...anchors];
            for (let i = currentCount; i < newCount; i++) {
                const newGroupId = Math.max(0, ...Array.from(currentRectGroups)) + 1 + (i - currentCount);
                const cx = viewBox.width / 2;
                const cy = viewBox.height / 2;
                const size = 30 - (i % 4) * 5;
                const offset = (i % 4) * 5;

                newAnchors.push(
                    { type: 'rect', groupId: newGroupId, corner: 'tl', x: (cx - size + offset).toFixed(4), y: (cy - size + offset).toFixed(4) },
                    { type: 'rect', groupId: newGroupId, corner: 'tr', x: (cx + size + offset).toFixed(4), y: (cy - size + offset).toFixed(4) },
                    { type: 'rect', groupId: newGroupId, corner: 'bl', x: (cx - size + offset).toFixed(4), y: (cy + size + offset).toFixed(4) },
                    { type: 'rect', groupId: newGroupId, corner: 'br', x: (cx + size + offset).toFixed(4), y: (cy + size + offset).toFixed(4) },
                );
                currentRectGroups.add(newGroupId);
            }
            onAnchorsChange(newAnchors);
        } else if (newCount < currentCount) {
            const sortedGroups = Array.from(currentRectGroups).sort((a, b) => b - a);
            const groupsToRemove = sortedGroups.slice(0, currentCount - newCount);
            onAnchorsChange(anchors.filter(a => !(a.type === 'rect' && groupsToRemove.includes(a.groupId ?? 0))));
        }
    }, [anchors, onAnchorsChange, viewBox]);

    // Handle line count change
    const handleLineCountChange = useCallback((newCount: number) => {
        const currentLineGroups = new Set(anchors.filter(a => a.type === 'line').map(a => a.groupId ?? 0));
        const currentCount = currentLineGroups.size;

        if (newCount > currentCount) {
            const newAnchors = [...anchors];
            for (let i = currentCount; i < newCount; i++) {
                const newGroupId = 100 + i;
                const cy = viewBox.height / 2 + (i * 10);
                newAnchors.push(
                    { type: 'line', groupId: newGroupId, position: 'start', x: (viewBox.width * 0.2).toFixed(4), y: cy.toFixed(4) },
                    { type: 'line', groupId: newGroupId, position: 'end', x: (viewBox.width * 0.8).toFixed(4), y: cy.toFixed(4) },
                );
            }
            onAnchorsChange(newAnchors);
        } else if (newCount < currentCount) {
            const sortedGroups = Array.from(currentLineGroups).sort((a, b) => b - a);
            const groupsToRemove = sortedGroups.slice(0, currentCount - newCount);
            onAnchorsChange(anchors.filter(a => !(a.type === 'line' && groupsToRemove.includes(a.groupId ?? 0))));
        }
    }, [anchors, onAnchorsChange, viewBox]);

    // Handle single count change
    const handleSingleCountChange = useCallback((newCount: number) => {
        const currentSingles = anchors.filter(a => a.type === 'single');
        const currentCount = currentSingles.length;

        if (newCount > currentCount) {
            const newAnchors = [...anchors];
            for (let i = currentCount; i < newCount; i++) {
                const newGroupId = 200 + i;
                newAnchors.push({
                    type: 'single',
                    groupId: newGroupId,
                    x: (viewBox.width / 2 + (i - newCount / 2) * 15).toFixed(4),
                    y: (viewBox.height / 2).toFixed(4),
                });
            }
            onAnchorsChange(newAnchors);
        } else if (newCount < currentCount) {
            const singlesToKeep = currentSingles.slice(0, newCount);
            const singleGroupIds = new Set(singlesToKeep.map(a => a.groupId));
            onAnchorsChange(anchors.filter(a => a.type !== 'single' || singleGroupIds.has(a.groupId)));
        }
    }, [anchors, onAnchorsChange, viewBox]);

    // Load SVG and parse path for stretch preview
    useEffect(() => {
        const controller = new AbortController();

        fetch(svgPath, { signal: controller.signal })
            .then(res => res.text())
            .then(text => {
                setSvgContent(text);
                const match = text.match(/viewBox="([^"]+)"/);
                if (match) {
                    const parts = match[1].split(/\s+/).map(Number);
                    if (parts.length >= 4) {
                        setViewBox({ width: parts[2], height: parts[3] });
                    }
                }
                // Parse path for stretch preview and topology visualization
                const extracted = extractPathFromSvg(text);
                if (extracted) {
                    const transformOffset = parseTransform(extracted.transform);
                    const parsed = parsePath(extracted.d, transformOffset);
                    setParsedPath(parsed);
                    setPathTopology(analyzePathTopology(parsed));
                }
            })
            .catch(err => {
                // Ignore abort errors - they're expected on cleanup
                if (err.name !== 'AbortError') {
                    console.error(err);
                }
            });

        return () => controller.abort();
    }, [svgPath]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (lineStart) {
                    setLineStart(null);
                } else {
                    onClose();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose, lineStart]);

    // Cleanup RAF on unmount
    useEffect(() => {
        return () => {
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
            }
        };
    }, []);

    // Base display size
    const baseWidth = 600;
    const baseHeight = baseWidth * (viewBox.height / viewBox.width);

    // Convert mouse coords to SVG coords
    const mouseToSvg = useCallback((clientX: number, clientY: number) => {
        if (!containerRef.current) return { x: 0, y: 0 };
        const rect = containerRef.current.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;
        const svgX = (mouseX - centerX - pan.x) / zoom + baseWidth / 2;
        const svgY = (mouseY - centerY - pan.y) / zoom + baseHeight / 2;
        return {
            x: (svgX / baseWidth) * viewBox.width,
            y: (svgY / baseHeight) * viewBox.height,
        };
    }, [pan, zoom, baseWidth, baseHeight, viewBox]);

    // Get all snap targets (center lines + other anchor positions)
    const getSnapTargets = useCallback((excludeIndex: number) => {
        const xTargets: number[] = [viewBox.width / 2]; // Center X
        const yTargets: number[] = [viewBox.height / 2]; // Center Y

        anchors.forEach((a, i) => {
            if (i === excludeIndex) return;
            const x = parseFloat(a.x);
            const y = parseFloat(a.y);
            if (!xTargets.includes(x)) xTargets.push(x);
            if (!yTargets.includes(y)) yTargets.push(y);
        });

        return { xTargets, yTargets };
    }, [anchors, viewBox]);

    // Find snap position
    const findSnapPosition = useCallback((x: number, y: number, excludeIndex: number): { x: number; y: number; snappedX: number[]; snappedY: number[] } => {
        if (!snapEnabled) return { x, y, snappedX: [], snappedY: [] };

        const { xTargets, yTargets } = getSnapTargets(excludeIndex);
        let snappedX = x;
        let snappedY = y;
        const activeX: number[] = [];
        const activeY: number[] = [];

        // Find closest X snap
        for (const target of xTargets) {
            if (Math.abs(x - target) < SNAP_TOLERANCE) {
                snappedX = target;
                activeX.push(target);
                break;
            }
        }

        // Find closest Y snap
        for (const target of yTargets) {
            if (Math.abs(y - target) < SNAP_TOLERANCE) {
                snappedY = target;
                activeY.push(target);
                break;
            }
        }

        return { x: snappedX, y: snappedY, snappedX: activeX, snappedY: activeY };
    }, [snapEnabled, getSnapTargets]);

    // Handle wheel zoom
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setZoom(z => Math.max(0.2, Math.min(10, z * delta)));
    }, []);

    // Get rectangle corners by groupId
    const getRectCorners = useCallback((groupId: number) => {
        const corners: { [key: string]: { index: number; x: number; y: number } } = {};
        anchors.forEach((a, i) => {
            if (a.type === 'rect' && a.groupId === groupId && a.corner) {
                corners[a.corner] = { index: i, x: parseFloat(a.x), y: parseFloat(a.y) };
            }
        });
        return corners;
    }, [anchors]);

    // Get line endpoints by groupId
    const getLineEndpoints = useCallback((groupId: number) => {
        const endpoints: { start?: { index: number; x: number; y: number }; end?: { index: number; x: number; y: number } } = {};
        anchors.forEach((a, i) => {
            if (a.type === 'line' && a.groupId === groupId) {
                if (a.position === 'start') endpoints.start = { index: i, x: parseFloat(a.x), y: parseFloat(a.y) };
                if (a.position === 'end') endpoints.end = { index: i, x: parseFloat(a.x), y: parseFloat(a.y) };
            }
        });
        return endpoints;
    }, [anchors]);

    // Handle mouse down
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0) return;

        const target = e.target as HTMLElement;

        // Check if clicking a stretch zone edge
        const stretchEdgeElement = target.closest('[data-stretch-edge]');
        if (stretchEdgeElement) {
            const edge = stretchEdgeElement.getAttribute('data-stretch-edge') as 'x-left' | 'x-right' | 'y-top' | 'y-bottom';
            let startValue = 0;
            if (edge === 'x-left') startValue = stretchConfig.x.leftEdge;
            else if (edge === 'x-right') startValue = stretchConfig.x.rightEdge;
            else if (edge === 'y-top') startValue = stretchConfig.y.topEdge;
            else if (edge === 'y-bottom') startValue = stretchConfig.y.bottomEdge;

            setDragState({
                mode: 'stretch',
                anchorIndex: -1,
                startMouse: { x: e.clientX, y: e.clientY },
                startAnchor: { x: 0, y: 0 },
                stretchEdge: edge,
                startStretchValue: startValue,
            });
            return;
        }

        // Check if clicking a rectangle edge (for group drag)
        const rectEdge = target.closest('[data-rect-edge]');
        if (rectEdge) {
            const groupId = parseInt(rectEdge.getAttribute('data-rect-group') || '0');
            const corners = getRectCorners(groupId);
            const groupAnchors = Object.values(corners);

            if (groupAnchors.length === 4) {
                setSelectedIndex(groupAnchors[0].index);
                setDragState({
                    mode: 'group',
                    anchorIndex: groupAnchors[0].index,
                    startMouse: { x: e.clientX, y: e.clientY },
                    startAnchor: { x: groupAnchors[0].x, y: groupAnchors[0].y },
                    groupAnchors,
                    groupId,
                });
            }
            return;
        }

        // Check if clicking a line (for group drag)
        const lineElement = target.closest('[data-line-group]');
        if (lineElement) {
            const groupId = parseInt(lineElement.getAttribute('data-line-group') || '0');
            const endpoints = getLineEndpoints(groupId);

            if (endpoints.start && endpoints.end) {
                const groupAnchors = [endpoints.start, endpoints.end];
                setSelectedIndex(endpoints.start.index);
                setDragState({
                    mode: 'group',
                    anchorIndex: endpoints.start.index,
                    startMouse: { x: e.clientX, y: e.clientY },
                    startAnchor: { x: endpoints.start.x, y: endpoints.start.y },
                    groupAnchors,
                    groupId,
                });
            }
            return;
        }

        // Check if clicking an anchor handle
        const anchorHandle = target.closest('[data-anchor-index]');
        if (anchorHandle) {
            const index = parseInt(anchorHandle.getAttribute('data-anchor-index') || '0');
            const anchor = anchors[index];
            if (anchor) {
                setSelectedIndex(index);

                // For rect corners, use resize mode
                if (anchor.type === 'rect' && anchor.corner) {
                    const corners = getRectCorners(anchor.groupId ?? 0);
                    const oppositeCornerKey = anchor.corner === 'tl' ? 'br' : anchor.corner === 'tr' ? 'bl' : anchor.corner === 'bl' ? 'tr' : 'tl';
                    const oppositeCorner = corners[oppositeCornerKey];

                    setDragState({
                        mode: 'resize',
                        anchorIndex: index,
                        startMouse: { x: e.clientX, y: e.clientY },
                        startAnchor: { x: parseFloat(anchor.x), y: parseFloat(anchor.y) },
                        resizeCorner: anchor.corner as 'tl' | 'tr' | 'bl' | 'br',
                        oppositeCorner: oppositeCorner ? { x: oppositeCorner.x, y: oppositeCorner.y } : undefined,
                        groupId: anchor.groupId,
                        groupAnchors: Object.values(corners),
                    });
                } else {
                    // Single anchor drag (for line/single types)
                    setDragState({
                        mode: 'single',
                        anchorIndex: index,
                        startMouse: { x: e.clientX, y: e.clientY },
                        startAnchor: { x: parseFloat(anchor.x), y: parseFloat(anchor.y) },
                    });
                }
            }
            return;
        }

        // Handle edit mode clicks
        const svgCoords = mouseToSvg(e.clientX, e.clientY);

        if (editMode === 'single') {
            // Add single anchor
            const newGroupId = 200 + anchors.filter(a => a.type === 'single').length;
            onAnchorsChange([
                ...anchors,
                { type: 'single', groupId: newGroupId, x: svgCoords.x.toFixed(4), y: svgCoords.y.toFixed(4) },
            ]);
            return;
        }

        if (editMode === 'line') {
            if (!lineStart) {
                setLineStart(svgCoords);
            } else {
                // Check minimum line length before creating
                const dx = svgCoords.x - lineStart.x;
                const dy = svgCoords.y - lineStart.y;
                const lineLength = Math.sqrt(dx * dx + dy * dy);

                if (lineLength < MIN_LINE_LENGTH) {
                    // Line too short - cancel and reset
                    setLineStart(null);
                    return;
                }

                // Complete line
                const newGroupId = 100 + anchors.filter(a => a.type === 'line').length / 2;
                onAnchorsChange([
                    ...anchors,
                    { type: 'line', groupId: newGroupId, position: 'start', x: lineStart.x.toFixed(4), y: lineStart.y.toFixed(4) },
                    { type: 'line', groupId: newGroupId, position: 'end', x: svgCoords.x.toFixed(4), y: svgCoords.y.toFixed(4) },
                ]);
                setLineStart(null);
            }
            return;
        }

        if (editMode === 'rect') {
            // Add rect (centered at click)
            const size = 20;
            const newGroupId = Math.max(0, ...anchors.filter(a => a.type === 'rect').map(a => a.groupId ?? 0)) + 1;
            onAnchorsChange([
                ...anchors,
                { type: 'rect', groupId: newGroupId, corner: 'tl', x: (svgCoords.x - size).toFixed(4), y: (svgCoords.y - size).toFixed(4) },
                { type: 'rect', groupId: newGroupId, corner: 'tr', x: (svgCoords.x + size).toFixed(4), y: (svgCoords.y - size).toFixed(4) },
                { type: 'rect', groupId: newGroupId, corner: 'bl', x: (svgCoords.x - size).toFixed(4), y: (svgCoords.y + size).toFixed(4) },
                { type: 'rect', groupId: newGroupId, corner: 'br', x: (svgCoords.x + size).toFixed(4), y: (svgCoords.y + size).toFixed(4) },
            ]);
            return;
        }

        // Otherwise, start panning
        setIsPanning(true);
        panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }, [anchors, editMode, lineStart, mouseToSvg, onAnchorsChange, pan, getRectCorners, getLineEndpoints, stretchConfig]);

    // Handle mouse move (with RAF throttling for performance)
    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (isPanning) {
            // Panning remains immediate for responsiveness
            setPan({
                x: e.clientX - panStartRef.current.x,
                y: e.clientY - panStartRef.current.y,
            });
            return;
        }

        if (dragState) {
            // Skip if RAF already pending
            if (rafIdRef.current !== null) return;

            const clientX = e.clientX;
            const clientY = e.clientY;

            rafIdRef.current = requestAnimationFrame(() => {
                rafIdRef.current = null;
                const current = mouseToSvg(clientX, clientY);
                const start = mouseToSvg(dragState.startMouse.x, dragState.startMouse.y);
            const dx = current.x - start.x;
            const dy = current.y - start.y;

            const newAnchors = [...anchors];

            if (dragState.mode === 'single') {
                // Single anchor drag
                let rawX = dragState.startAnchor.x + dx;
                let rawY = dragState.startAnchor.y + dy;

                // For line anchors, prevent dragging too close to paired endpoint
                const anchor = anchors[dragState.anchorIndex];
                if (anchor.type === 'line' && anchor.groupId !== undefined) {
                    // Find the paired endpoint
                    const pairedIdx = anchors.findIndex((a, i) =>
                        i !== dragState.anchorIndex &&
                        a.type === 'line' &&
                        a.groupId === anchor.groupId
                    );
                    if (pairedIdx !== -1) {
                        const paired = anchors[pairedIdx];
                        const pairedX = parseFloat(paired.x);
                        const pairedY = parseFloat(paired.y);
                        const dist = Math.sqrt((rawX - pairedX) ** 2 + (rawY - pairedY) ** 2);

                        if (dist < MIN_LINE_LENGTH) {
                            // Clamp position to maintain minimum distance
                            const angle = Math.atan2(rawY - pairedY, rawX - pairedX);
                            rawX = pairedX + Math.cos(angle) * MIN_LINE_LENGTH;
                            rawY = pairedY + Math.sin(angle) * MIN_LINE_LENGTH;
                        }
                    }
                }

                const snapped = findSnapPosition(rawX, rawY, dragState.anchorIndex);
                setActiveGuidelines({ x: snapped.snappedX, y: snapped.snappedY });

                newAnchors[dragState.anchorIndex] = {
                    ...newAnchors[dragState.anchorIndex],
                    x: snapped.x.toFixed(4),
                    y: snapped.y.toFixed(4),
                };
            } else if (dragState.mode === 'group' && dragState.groupAnchors) {
                // Group drag - move all anchors together
                for (const ga of dragState.groupAnchors) {
                    const rawX = ga.x + dx;
                    const rawY = ga.y + dy;
                    newAnchors[ga.index] = {
                        ...newAnchors[ga.index],
                        x: rawX.toFixed(4),
                        y: rawY.toFixed(4),
                    };
                }
                // Snap based on first anchor
                const firstAnchor = dragState.groupAnchors[0];
                const snapped = findSnapPosition(firstAnchor.x + dx, firstAnchor.y + dy, -1);
                setActiveGuidelines({ x: snapped.snappedX, y: snapped.snappedY });

                // Apply snap offset to all if snapped
                if (snapped.snappedX.length > 0 || snapped.snappedY.length > 0) {
                    const snapDx = snapped.x - (firstAnchor.x + dx);
                    const snapDy = snapped.y - (firstAnchor.y + dy);
                    for (const ga of dragState.groupAnchors) {
                        newAnchors[ga.index] = {
                            ...newAnchors[ga.index],
                            x: (ga.x + dx + snapDx).toFixed(4),
                            y: (ga.y + dy + snapDy).toFixed(4),
                        };
                    }
                }
            } else if (dragState.mode === 'resize' && dragState.oppositeCorner && dragState.resizeCorner && dragState.groupAnchors) {
                // Resize mode - dragged corner moves, opposite stays fixed, adjacents adjust
                const rawX = dragState.startAnchor.x + dx;
                const rawY = dragState.startAnchor.y + dy;
                const snapped = findSnapPosition(rawX, rawY, dragState.anchorIndex);
                setActiveGuidelines({ x: snapped.snappedX, y: snapped.snappedY });

                const newCornerX = snapped.x;
                const newCornerY = snapped.y;
                const oppX = dragState.oppositeCorner.x;
                const oppY = dragState.oppositeCorner.y;

                // Calculate new positions for all corners based on the dragged corner and opposite
                const cornerPositions: { [key: string]: { x: number; y: number } } = {};

                if (dragState.resizeCorner === 'tl') {
                    cornerPositions['tl'] = { x: newCornerX, y: newCornerY };
                    cornerPositions['br'] = { x: oppX, y: oppY };
                    cornerPositions['tr'] = { x: oppX, y: newCornerY };
                    cornerPositions['bl'] = { x: newCornerX, y: oppY };
                } else if (dragState.resizeCorner === 'tr') {
                    cornerPositions['tr'] = { x: newCornerX, y: newCornerY };
                    cornerPositions['bl'] = { x: oppX, y: oppY };
                    cornerPositions['tl'] = { x: oppX, y: newCornerY };
                    cornerPositions['br'] = { x: newCornerX, y: oppY };
                } else if (dragState.resizeCorner === 'bl') {
                    cornerPositions['bl'] = { x: newCornerX, y: newCornerY };
                    cornerPositions['tr'] = { x: oppX, y: oppY };
                    cornerPositions['tl'] = { x: newCornerX, y: oppY };
                    cornerPositions['br'] = { x: oppX, y: newCornerY };
                } else if (dragState.resizeCorner === 'br') {
                    cornerPositions['br'] = { x: newCornerX, y: newCornerY };
                    cornerPositions['tl'] = { x: oppX, y: oppY };
                    cornerPositions['tr'] = { x: newCornerX, y: oppY };
                    cornerPositions['bl'] = { x: oppX, y: newCornerY };
                }

                // Update all corners
                for (const ga of dragState.groupAnchors) {
                    const anchor = anchors[ga.index];
                    if (anchor.corner && cornerPositions[anchor.corner]) {
                        newAnchors[ga.index] = {
                            ...newAnchors[ga.index],
                            x: cornerPositions[anchor.corner].x.toFixed(4),
                            y: cornerPositions[anchor.corner].y.toFixed(4),
                        };
                    }
                }
            } else if (dragState.mode === 'stretch' && dragState.stretchEdge && dragState.startStretchValue !== undefined) {
                // Stretch edge drag - update stretch config
                const edge = dragState.stretchEdge;

                if (edge.startsWith('x-')) {
                    // X axis (horizontal zone) - vertical lines move horizontally
                    const newValue = dragState.startStretchValue + dx;

                    if (edge === 'x-left') {
                        // Left edge can't go past right edge minus minimum gap
                        const clampedValue = Math.max(0, Math.min(stretchConfig.x.rightEdge - MIN_ZONE_SIZE, newValue));
                        onStretchConfigChange({
                            ...stretchConfig,
                            x: { ...stretchConfig.x, leftEdge: clampedValue }
                        });
                    } else {
                        // Right edge can't go past left edge plus minimum gap
                        const clampedValue = Math.max(stretchConfig.x.leftEdge + MIN_ZONE_SIZE, Math.min(viewBox.width, newValue));
                        onStretchConfigChange({
                            ...stretchConfig,
                            x: { ...stretchConfig.x, rightEdge: clampedValue }
                        });
                    }
                } else {
                    // Y axis (vertical zone) - horizontal lines move vertically
                    const newValue = dragState.startStretchValue + dy;

                    if (edge === 'y-top') {
                        // Top edge can't go past bottom edge minus minimum gap
                        const clampedValue = Math.max(0, Math.min(stretchConfig.y.bottomEdge - MIN_ZONE_SIZE, newValue));
                        onStretchConfigChange({
                            ...stretchConfig,
                            y: { ...stretchConfig.y, topEdge: clampedValue }
                        });
                    } else {
                        // Bottom edge can't go past top edge plus minimum gap
                        const clampedValue = Math.max(stretchConfig.y.topEdge + MIN_ZONE_SIZE, Math.min(viewBox.height, newValue));
                        onStretchConfigChange({
                            ...stretchConfig,
                            y: { ...stretchConfig.y, bottomEdge: clampedValue }
                        });
                    }
                }
                return; // Don't update anchors for stretch mode
            }

                onAnchorsChange(newAnchors);
            });
        }
    }, [isPanning, dragState, mouseToSvg, anchors, onAnchorsChange, findSnapPosition, stretchConfig, onStretchConfigChange, viewBox]);

    // Handle mouse up
    const handleMouseUp = useCallback(() => {
        setIsPanning(false);
        setDragState(null);
        setActiveGuidelines({ x: [], y: [] });
        // Cancel pending RAF
        if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
        }
    }, []);

    // Delete selected anchor
    const handleDelete = useCallback(() => {
        if (selectedIndex === null) return;

        const anchor = anchors[selectedIndex];
        if (!anchor) return;

        // For rect/line, delete entire group
        if (anchor.type === 'rect' || anchor.type === 'line') {
            onAnchorsChange(anchors.filter(a =>
                !(a.type === anchor.type && a.groupId === anchor.groupId)
            ));
        } else {
            onAnchorsChange(anchors.filter((_, i) => i !== selectedIndex));
        }
        setSelectedIndex(null);
    }, [selectedIndex, anchors, onAnchorsChange]);

    // Render anchor handle
    const renderAnchor = (anchor: AnchorData, index: number) => {
        const x = (parseFloat(anchor.x) / viewBox.width) * baseWidth;
        const y = (parseFloat(anchor.y) / viewBox.height) * baseHeight;
        const isSelected = selectedIndex === index;
        const size = 12 / zoom;

        let color = ANCHOR_COLORS[anchor.type ?? 'rect'];
        if (anchor.type === 'rect') {
            color = getRectGroupColor(anchor.groupId ?? 0);
        }

        return (
            <div
                key={index}
                data-anchor-index={index}
                style={{
                    position: 'absolute',
                    left: x - size / 2,
                    top: y - size / 2,
                    width: size,
                    height: size,
                    background: color,
                    border: `${2 / zoom}px solid ${isSelected ? '#fff' : 'rgba(0,0,0,0.5)'}`,
                    borderRadius: anchor.type === 'single' ? '50%' : anchor.type === 'line' ? '2px' : '3px',
                    cursor: 'move',
                    boxShadow: isSelected ? `0 0 0 ${3 / zoom}px rgba(255,255,255,0.5)` : 'none',
                    zIndex: isSelected ? 1000 : 10,
                }}
            />
        );
    };

    // Render lines between line anchor pairs with clickable hitboxes
    const renderLines = () => {
        const lineGroups = new Map<number, { start?: AnchorData; end?: AnchorData; startIdx?: number; endIdx?: number }>();
        anchors.forEach((a, i) => {
            if (a.type !== 'line') return;
            const group = lineGroups.get(a.groupId ?? 0) || {};
            if (a.position === 'start') { group.start = a; group.startIdx = i; }
            if (a.position === 'end') { group.end = a; group.endIdx = i; }
            lineGroups.set(a.groupId ?? 0, group);
        });

        return Array.from(lineGroups.entries()).map(([groupId, { start, end }]) => {
            if (!start || !end) return null;
            const x1 = (parseFloat(start.x) / viewBox.width) * baseWidth;
            const y1 = (parseFloat(start.y) / viewBox.height) * baseHeight;
            const x2 = (parseFloat(end.x) / viewBox.width) * baseWidth;
            const y2 = (parseFloat(end.y) / viewBox.height) * baseHeight;
            const hitWidth = Math.max(12 / zoom, 6); // Clickable line width

            return (
                <React.Fragment key={`line-${groupId}`}>
                    {/* Clickable hitbox line */}
                    <svg
                        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
                    >
                        <line
                            data-line-group={groupId}
                            x1={x1} y1={y1} x2={x2} y2={y2}
                            stroke="transparent"
                            strokeWidth={hitWidth}
                            style={{ cursor: 'move' }}
                        />
                    </svg>
                    {/* Visible line */}
                    <svg
                        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
                    >
                        <line
                            x1={x1} y1={y1} x2={x2} y2={y2}
                            stroke={ANCHOR_COLORS.line}
                            strokeWidth={2 / zoom}
                            strokeDasharray={`${4 / zoom} ${4 / zoom}`}
                        />
                    </svg>
                </React.Fragment>
            );
        });
    };

    // Render rect outlines with clickable edges
    const renderRects = () => {
        const rectGroups = new Map<number, AnchorData[]>();
        anchors.forEach(a => {
            if (a.type !== 'rect') return;
            const group = rectGroups.get(a.groupId ?? 0) || [];
            group.push(a);
            rectGroups.set(a.groupId ?? 0, group);
        });

        return Array.from(rectGroups.entries()).map(([groupId, corners]) => {
            if (corners.length !== 4) return null;
            const tl = corners.find(c => c.corner === 'tl');
            const tr = corners.find(c => c.corner === 'tr');
            const bl = corners.find(c => c.corner === 'bl');
            const br = corners.find(c => c.corner === 'br');
            if (!tl || !tr || !bl || !br) return null;

            const tlX = (parseFloat(tl.x) / viewBox.width) * baseWidth;
            const tlY = (parseFloat(tl.y) / viewBox.height) * baseHeight;
            const trX = (parseFloat(tr.x) / viewBox.width) * baseWidth;
            const trY = (parseFloat(tr.y) / viewBox.height) * baseHeight;
            const blX = (parseFloat(bl.x) / viewBox.width) * baseWidth;
            const blY = (parseFloat(bl.y) / viewBox.height) * baseHeight;
            const brX = (parseFloat(br.x) / viewBox.width) * baseWidth;
            const brY = (parseFloat(br.y) / viewBox.height) * baseHeight;

            const x = tlX;
            const y = tlY;
            const w = trX - tlX;
            const h = blY - tlY;
            const color = getRectGroupColor(groupId);
            const edgeWidth = Math.max(8 / zoom, 4); // Clickable edge width

            return (
                <React.Fragment key={`rect-${groupId}`}>
                    {/* Background fill */}
                    <div
                        style={{
                            position: 'absolute',
                            left: x,
                            top: y,
                            width: w,
                            height: h,
                            background: `${color}15`,
                            pointerEvents: 'none',
                        }}
                    />
                    {/* Top edge */}
                    <div
                        data-rect-edge="top"
                        data-rect-group={groupId}
                        style={{
                            position: 'absolute',
                            left: x + edgeWidth / 2,
                            top: y - edgeWidth / 2,
                            width: w - edgeWidth,
                            height: edgeWidth,
                            cursor: 'move',
                            zIndex: 5,
                        }}
                    />
                    {/* Bottom edge */}
                    <div
                        data-rect-edge="bottom"
                        data-rect-group={groupId}
                        style={{
                            position: 'absolute',
                            left: x + edgeWidth / 2,
                            top: y + h - edgeWidth / 2,
                            width: w - edgeWidth,
                            height: edgeWidth,
                            cursor: 'move',
                            zIndex: 5,
                        }}
                    />
                    {/* Left edge */}
                    <div
                        data-rect-edge="left"
                        data-rect-group={groupId}
                        style={{
                            position: 'absolute',
                            left: x - edgeWidth / 2,
                            top: y + edgeWidth / 2,
                            width: edgeWidth,
                            height: h - edgeWidth,
                            cursor: 'move',
                            zIndex: 5,
                        }}
                    />
                    {/* Right edge */}
                    <div
                        data-rect-edge="right"
                        data-rect-group={groupId}
                        style={{
                            position: 'absolute',
                            left: x + w - edgeWidth / 2,
                            top: y + edgeWidth / 2,
                            width: edgeWidth,
                            height: h - edgeWidth,
                            cursor: 'move',
                            zIndex: 5,
                        }}
                    />
                    {/* Visible border (SVG for crisp lines) */}
                    <svg
                        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
                    >
                        <rect
                            x={x}
                            y={y}
                            width={w}
                            height={h}
                            fill="none"
                            stroke={color}
                            strokeWidth={2 / zoom}
                        />
                    </svg>
                </React.Fragment>
            );
        });
    };

    // Render guidelines
    const renderGuidelines = () => {
        if (!showGuidelines) return null;

        const centerX = viewBox.width / 2;
        const centerY = viewBox.height / 2;
        const displayCenterX = (centerX / viewBox.width) * baseWidth;
        const displayCenterY = (centerY / viewBox.height) * baseHeight;

        const lines: React.ReactNode[] = [];

        // Center guidelines (always visible, subtle)
        lines.push(
            <line
                key="center-x"
                x1={displayCenterX}
                y1={0}
                x2={displayCenterX}
                y2={baseHeight}
                stroke="rgba(100, 200, 255, 0.3)"
                strokeWidth={1 / zoom}
                strokeDasharray={`${4 / zoom} ${4 / zoom}`}
            />
        );
        lines.push(
            <line
                key="center-y"
                x1={0}
                y1={displayCenterY}
                x2={baseWidth}
                y2={displayCenterY}
                stroke="rgba(100, 200, 255, 0.3)"
                strokeWidth={1 / zoom}
                strokeDasharray={`${4 / zoom} ${4 / zoom}`}
            />
        );

        // Active snap guidelines (bright, solid)
        activeGuidelines.x.forEach((svgX, i) => {
            const displayX = (svgX / viewBox.width) * baseWidth;
            lines.push(
                <line
                    key={`snap-x-${i}`}
                    x1={displayX}
                    y1={0}
                    x2={displayX}
                    y2={baseHeight}
                    stroke="#00ffff"
                    strokeWidth={2 / zoom}
                />
            );
        });

        activeGuidelines.y.forEach((svgY, i) => {
            const displayY = (svgY / viewBox.height) * baseHeight;
            lines.push(
                <line
                    key={`snap-y-${i}`}
                    x1={0}
                    y1={displayY}
                    x2={baseWidth}
                    y2={displayY}
                    stroke="#ff00ff"
                    strokeWidth={2 / zoom}
                />
            );
        });

        return (
            <svg
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
                viewBox={`0 0 ${baseWidth} ${baseHeight}`}
                preserveAspectRatio="none"
            >
                {lines}
            </svg>
        );
    };

    // Render stretch zone indicators with draggable edges
    const renderStretchZones = () => {
        const hitWidth = Math.max(12 / zoom, 6);
        const elements: React.ReactNode[] = [];

        // Horizontal zone (X) - vertical lines at leftEdge and rightEdge
        if (stretchConfig.x.enabled) {
            const leftX = (stretchConfig.x.leftEdge / viewBox.width) * baseWidth;
            const rightX = (stretchConfig.x.rightEdge / viewBox.width) * baseWidth;
            const color = '#f97316'; // Orange

            elements.push(
                <React.Fragment key="stretch-x">
                    {/* Fill between */}
                    <div
                        style={{
                            position: 'absolute',
                            left: leftX,
                            top: 0,
                            width: rightX - leftX,
                            height: baseHeight,
                            background: `${color}10`,
                            pointerEvents: 'none',
                        }}
                    />
                    {/* Left edge - draggable */}
                    <div
                        data-stretch-edge="x-left"
                        style={{
                            position: 'absolute',
                            left: leftX - hitWidth / 2,
                            top: 0,
                            width: hitWidth,
                            height: baseHeight,
                            cursor: 'ew-resize',
                            zIndex: 20,
                        }}
                    />
                    {/* Right edge - draggable */}
                    <div
                        data-stretch-edge="x-right"
                        style={{
                            position: 'absolute',
                            left: rightX - hitWidth / 2,
                            top: 0,
                            width: hitWidth,
                            height: baseHeight,
                            cursor: 'ew-resize',
                            zIndex: 20,
                        }}
                    />
                    {/* Visible lines */}
                    <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
                        <line x1={leftX} y1={0} x2={leftX} y2={baseHeight} stroke={color} strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`} />
                        <line x1={rightX} y1={0} x2={rightX} y2={baseHeight} stroke={color} strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`} />
                    </svg>
                </React.Fragment>
            );
        }

        // Vertical zone (Y) - horizontal lines at topEdge and bottomEdge
        if (stretchConfig.y.enabled) {
            const topY = (stretchConfig.y.topEdge / viewBox.height) * baseHeight;
            const bottomY = (stretchConfig.y.bottomEdge / viewBox.height) * baseHeight;
            const color = '#8b5cf6'; // Purple

            elements.push(
                <React.Fragment key="stretch-y">
                    {/* Fill between */}
                    <div
                        style={{
                            position: 'absolute',
                            left: 0,
                            top: topY,
                            width: baseWidth,
                            height: bottomY - topY,
                            background: `${color}10`,
                            pointerEvents: 'none',
                        }}
                    />
                    {/* Top edge - draggable */}
                    <div
                        data-stretch-edge="y-top"
                        style={{
                            position: 'absolute',
                            left: 0,
                            top: topY - hitWidth / 2,
                            width: baseWidth,
                            height: hitWidth,
                            cursor: 'ns-resize',
                            zIndex: 20,
                        }}
                    />
                    {/* Bottom edge - draggable */}
                    <div
                        data-stretch-edge="y-bottom"
                        style={{
                            position: 'absolute',
                            left: 0,
                            top: bottomY - hitWidth / 2,
                            width: baseWidth,
                            height: hitWidth,
                            cursor: 'ns-resize',
                            zIndex: 20,
                        }}
                    />
                    {/* Visible lines */}
                    <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
                        <line x1={0} y1={topY} x2={baseWidth} y2={topY} stroke={color} strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`} />
                        <line x1={0} y1={bottomY} x2={baseWidth} y2={bottomY} stroke={color} strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`} />
                    </svg>
                </React.Fragment>
            );
        }

        return elements.length > 0 ? <>{elements}</> : null;
    };

    // Get anchor description for coordinates panel
    const getAnchorLabel = (anchor: AnchorData, index: number): string => {
        if (anchor.type === 'rect') {
            return `R${anchor.groupId}:${anchor.corner}`;
        } else if (anchor.type === 'line') {
            return `L${anchor.groupId}:${anchor.position}`;
        } else {
            return `S${anchor.groupId ?? index}`;
        }
    };

    return (
        <div className="fixed inset-0 bg-neutral-900 z-50 flex flex-col">
            {/* Toolbar */}
            <div className="h-14 border-b border-neutral-700 flex items-center px-4 gap-4 bg-neutral-800">
                <span className="font-semibold text-white">Anchor Editor</span>

                <Select value={editMode} onValueChange={(v) => setEditMode(v as EditMode)}>
                    <SelectTrigger className="w-40 bg-neutral-700 border-neutral-600 text-white">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="select">
                            <span className="flex items-center gap-2">Select / Move</span>
                        </SelectItem>
                        <SelectItem value="rect">
                            <span className="flex items-center gap-2"><Square className="w-4 h-4" /> Add Rect</span>
                        </SelectItem>
                        <SelectItem value="line">
                            <span className="flex items-center gap-2"><Minus className="w-4 h-4" /> Add Line</span>
                        </SelectItem>
                        <SelectItem value="single">
                            <span className="flex items-center gap-2"><Circle className="w-4 h-4" /> Add Point</span>
                        </SelectItem>
                    </SelectContent>
                </Select>

                {selectedIndex !== null && (
                    <Button variant="destructive" size="sm" onClick={handleDelete}>
                        Delete Selected
                    </Button>
                )}

                {lineStart && (
                    <span className="text-amber-400 text-sm">
                        Click to place line endpoint (or Esc to cancel)
                    </span>
                )}

                <div className="flex-1" />

                <span className="text-neutral-400 text-sm">
                    {anchors.length} anchors | Zoom: {(zoom * 100).toFixed(0)}%
                </span>

                <Button variant="outline" size="sm" onClick={onClose} className="gap-1">
                    <X className="w-4 h-4" /> Done
                </Button>
            </div>

            {/* Main content area */}
            <div className="flex-1 flex overflow-hidden">
                {/* Canvas area */}
                <div
                    ref={containerRef}
                    className="flex-1 overflow-hidden cursor-grab active:cursor-grabbing relative"
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                >
                {/* SVG Container */}
                <div
                    style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        width: baseWidth,
                        height: baseHeight,
                        transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transformOrigin: 'center center',
                    }}
                >
                    {/* White background */}
                    <div
                        style={{
                            position: 'absolute',
                            inset: 0,
                            background: '#fff',
                            borderRadius: 4,
                            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                            overflow: 'hidden',
                        }}
                    >
                        <div
                            style={{ width: '100%', height: '100%' }}
                            dangerouslySetInnerHTML={{
                                __html: svgContent.replace(
                                    /<svg/,
                                    '<svg style="width:100%;height:100%;display:block"'
                                )
                            }}
                        />
                    </div>

                    {/* Stretched path preview overlay */}
                    {stretchedPathString && (
                        <svg
                            style={{
                                position: 'absolute',
                                inset: 0,
                                pointerEvents: 'none',
                                overflow: 'visible',
                            }}
                            viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
                            preserveAspectRatio="xMidYMid meet"
                        >
                            <path
                                d={stretchedPathString}
                                fill="none"
                                stroke="#e91e63"
                                strokeWidth={1.5}
                                strokeDasharray="4,2"
                                opacity={0.7}
                            />
                        </svg>
                    )}

                    {/* Guidelines */}
                    {renderGuidelines()}

                    {/* Stretch zones */}
                    {renderStretchZones()}

                    {/* Rect outlines */}
                    {showAnchors && renderRects()}

                    {/* Line connections */}
                    {showAnchors && renderLines()}

                    {/* Anchor handles */}
                    {showAnchors && anchors.map((anchor, i) => renderAnchor(anchor, i))}

                    {/* Path Topology Debug Overlay - Alternating segment highlights */}
                    {showTopology && parsedPath && pathTopology && (() => {
                        const totalPoints = parsedPath.coords.length / 2;

                        // Colorblind-safe palette: blue, orange, purple (avoid red/green)
                        const baseColors = [
                            { stroke: '#3b82f6', name: 'blue' },    // blue
                            { stroke: '#f59e0b', name: 'orange' },  // orange
                            { stroke: '#8b5cf6', name: 'purple' },  // purple
                        ];
                        // Pattern types: solid, diagonal, dots
                        const patterns = ['solid', 'diagonal', 'dots'];

                        // Build SVG path string for each segment with color+pattern combo
                        const segmentPaths: Array<{
                            d: string;
                            colorIdx: number;
                            patternIdx: number;
                            segIdx: number;
                        }> = [];

                        for (let segIdx = 0; segIdx < pathTopology.segmentStarts.length; segIdx++) {
                            const startIdx = pathTopology.segmentStarts[segIdx];
                            const endIdx = segIdx < pathTopology.segmentStarts.length - 1
                                ? pathTopology.segmentStarts[segIdx + 1] - 1
                                : totalPoints - 1;

                            let d = '';
                            let i = startIdx;

                            while (i <= endIdx) {
                                const x = parsedPath.coords[i * 2];
                                const y = parsedPath.coords[i * 2 + 1];
                                const ptype = pathTopology.pointTypes[i];

                                if (ptype === PointType.MOVE) {
                                    d += `M${x},${y} `;
                                    i++;
                                } else if (ptype === PointType.LINE_END) {
                                    d += `L${x},${y} `;
                                    i++;
                                } else if (ptype === PointType.BEZIER_CP1) {
                                    // Collect cp1, cp2, end for cubic bezier
                                    const cp1x = x, cp1y = y;
                                    const cp2x = parsedPath.coords[(i + 1) * 2];
                                    const cp2y = parsedPath.coords[(i + 1) * 2 + 1];
                                    const ex = parsedPath.coords[(i + 2) * 2];
                                    const ey = parsedPath.coords[(i + 2) * 2 + 1];
                                    d += `C${cp1x},${cp1y} ${cp2x},${cp2y} ${ex},${ey} `;
                                    i += 3;
                                } else {
                                    i++;
                                }
                            }

                            if (d) {
                                // Cycle through 9 combos: 3 colors x 3 patterns
                                const combo = segIdx % 9;
                                segmentPaths.push({
                                    d,
                                    colorIdx: combo % 3,
                                    patternIdx: Math.floor(combo / 3),
                                    segIdx,
                                });
                            }
                        }

                        return (
                            <svg
                                style={{
                                    position: 'absolute',
                                    inset: 0,
                                    width: baseWidth,
                                    height: baseHeight,
                                    pointerEvents: 'none',
                                    overflow: 'visible',
                                }}
                                viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
                            >
                                {/* Pattern definitions */}
                                <defs>
                                    {baseColors.map((c, ci) => (
                                        <React.Fragment key={c.name}>
                                            {/* Diagonal lines pattern - very fine */}
                                            <pattern
                                                id={`diag-${c.name}`}
                                                patternUnits="userSpaceOnUse"
                                                width="1.2"
                                                height="1.2"
                                                patternTransform="rotate(45)"
                                            >
                                                <line x1="0" y1="0" x2="0" y2="1.2" stroke={c.stroke} strokeWidth="0.4" />
                                            </pattern>
                                            {/* Dots pattern - very small */}
                                            <pattern
                                                id={`dots-${c.name}`}
                                                patternUnits="userSpaceOnUse"
                                                width="1.5"
                                                height="1.5"
                                            >
                                                <circle cx="0.75" cy="0.75" r="0.35" fill={c.stroke} />
                                            </pattern>
                                        </React.Fragment>
                                    ))}
                                </defs>

                                {segmentPaths.map(({ d, colorIdx, patternIdx, segIdx }) => {
                                    const color = baseColors[colorIdx];
                                    const pattern = patterns[patternIdx];

                                    // Determine fill style based on pattern
                                    let fillStyle: string;
                                    if (pattern === 'solid') {
                                        fillStyle = color.stroke;
                                    } else if (pattern === 'diagonal') {
                                        fillStyle = `url(#diag-${color.name})`;
                                    } else {
                                        fillStyle = `url(#dots-${color.name})`;
                                    }

                                    return (
                                        <path
                                            key={segIdx}
                                            d={d + 'Z'}
                                            fill={fillStyle}
                                            stroke="none"
                                            opacity={0.5}
                                        />
                                    );
                                })}
                            </svg>
                        );
                    })()}

                    {/* Line creation preview */}
                    {lineStart && (
                        <div
                            style={{
                                position: 'absolute',
                                left: (lineStart.x / viewBox.width) * baseWidth - 4,
                                top: (lineStart.y / viewBox.height) * baseHeight - 4,
                                width: 8,
                                height: 8,
                                background: ANCHOR_COLORS.line,
                                borderRadius: 2,
                                pointerEvents: 'none',
                            }}
                        />
                    )}
                </div>

                    {/* Instructions */}
                    <div className="absolute bottom-4 left-4 text-neutral-400 text-xs bg-neutral-800/80 px-3 py-2 rounded">
                        Scroll to zoom | Drag background to pan | Drag handles to move | Press Esc to close
                    </div>
                </div>

                {/* Sidebar toggle */}
                <button
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className="w-6 bg-neutral-800 border-l border-neutral-700 flex items-center justify-center hover:bg-neutral-700 transition-colors"
                >
                    {sidebarOpen ? <ChevronRight className="w-4 h-4 text-neutral-400" /> : <ChevronLeft className="w-4 h-4 text-neutral-400" />}
                </button>

                {/* Sidebar */}
                {sidebarOpen && (
                    <div className="w-72 bg-neutral-800 border-l border-neutral-700 flex flex-col">
                        {/* Anchor Counts */}
                        <div className="p-4 border-b border-neutral-700">
                            <h3 className="text-sm font-medium text-white mb-3">Anchor Counts</h3>
                            <div className="space-y-2 text-neutral-300">
                                <NumberStepper
                                    label="Rectangles (4 pts)"
                                    value={anchorCounts.rect}
                                    min={0}
                                    max={20}
                                    onChange={handleRectCountChange}
                                />
                                <NumberStepper
                                    label="Lines (2 pts)"
                                    value={anchorCounts.line}
                                    min={0}
                                    max={20}
                                    onChange={handleLineCountChange}
                                />
                                <NumberStepper
                                    label="Single Points"
                                    value={anchorCounts.single}
                                    min={0}
                                    max={50}
                                    onChange={handleSingleCountChange}
                                />
                            </div>
                            <div className="mt-3 pt-3 border-t border-neutral-700 text-xs text-neutral-400">
                                Total: {anchors.length} anchor points
                            </div>
                        </div>

                        {/* Display Settings */}
                        <div className="p-4 border-b border-neutral-700 space-y-3">
                            <h3 className="text-sm font-medium text-white">Display</h3>
                            <div className="flex items-center justify-between">
                                <Label className="text-sm text-neutral-300">Show Anchors</Label>
                                <Checkbox
                                    checked={showAnchors}
                                    onCheckedChange={(checked) => setShowAnchors(checked === true)}
                                />
                            </div>
                            <div className="flex items-center justify-between">
                                <Label className="text-sm text-neutral-300">Show Guidelines</Label>
                                <Checkbox
                                    checked={showGuidelines}
                                    onCheckedChange={(checked) => setShowGuidelines(checked === true)}
                                />
                            </div>
                            <div className="flex items-center justify-between">
                                <Label className="text-sm text-neutral-300">Snap to Guidelines</Label>
                                <Checkbox
                                    checked={snapEnabled}
                                    onCheckedChange={(checked) => setSnapEnabled(checked === true)}
                                />
                            </div>
                            <div className="flex items-center justify-between">
                                <Label className="text-sm text-neutral-300">Show Path Topology</Label>
                                <Checkbox
                                    checked={showTopology}
                                    onCheckedChange={(checked) => setShowTopology(checked === true)}
                                />
                            </div>
                            {showTopology && pathTopology && (
                                <div className="text-xs text-neutral-500 pt-1">
                                    {pathTopology.segmentStarts.length} segments (color-coded)
                                </div>
                            )}
                        </div>

                        {/* Stretch Zones */}
                        <div className="p-4 border-b border-neutral-700 space-y-4">
                            <h3 className="text-sm font-medium text-white">Stretch Zones</h3>

                            {/* Horizontal Stretch */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label className="text-sm text-neutral-300">Horizontal (X)</Label>
                                    <Checkbox
                                        checked={stretchConfig.x.enabled}
                                        onCheckedChange={(checked) => onStretchConfigChange({
                                            ...stretchConfig,
                                            x: { ...stretchConfig.x, enabled: checked === true }
                                        })}
                                    />
                                </div>
                                {stretchConfig.x.enabled && (
                                    <SliderControl
                                        label="Amount"
                                        value={stretchConfig.x.stretchAmount}
                                        min={-100}
                                        max={200}
                                        step={1}
                                        onChange={(v) => onStretchConfigChange({
                                            ...stretchConfig,
                                            x: { ...stretchConfig.x, stretchAmount: v }
                                        })}
                                    />
                                )}
                            </div>

                            {/* Vertical Stretch */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label className="text-sm text-neutral-300">Vertical (Y)</Label>
                                    <Checkbox
                                        checked={stretchConfig.y.enabled}
                                        onCheckedChange={(checked) => onStretchConfigChange({
                                            ...stretchConfig,
                                            y: { ...stretchConfig.y, enabled: checked === true }
                                        })}
                                    />
                                </div>
                                {stretchConfig.y.enabled && (
                                    <SliderControl
                                        label="Amount"
                                        value={stretchConfig.y.stretchAmount}
                                        min={-100}
                                        max={200}
                                        step={1}
                                        onChange={(v) => onStretchConfigChange({
                                            ...stretchConfig,
                                            y: { ...stretchConfig.y, stretchAmount: v }
                                        })}
                                    />
                                )}
                            </div>

                            {/* Zone info */}
                            <div className="text-xs text-neutral-500 pt-2 border-t border-neutral-600">
                                <p>Zones expand symmetrically from center.</p>
                                <p className="mt-1">Drag zone edges on canvas to reposition.</p>
                            </div>
                        </div>

                        {/* Coordinates Panel */}
                        <div className="flex-1 overflow-hidden flex flex-col">
                            <h3 className="text-sm font-medium text-white p-4 pb-2">Coordinates</h3>
                            <div className="flex-1 overflow-y-auto px-4 pb-4">
                                <table className="w-full text-xs font-mono">
                                    <thead className="text-neutral-500">
                                        <tr>
                                            <th className="text-left pb-1 pr-2">ID</th>
                                            <th className="text-right pb-1 pr-2">X</th>
                                            <th className="text-right pb-1">Y</th>
                                        </tr>
                                    </thead>
                                    <tbody className="text-neutral-300">
                                        {anchors.map((anchor, i) => (
                                            <tr
                                                key={i}
                                                className={`${selectedIndex === i ? 'bg-neutral-700' : ''} hover:bg-neutral-700/50 cursor-pointer`}
                                                onClick={() => setSelectedIndex(i)}
                                            >
                                                <td className="py-0.5 pr-2">
                                                    <span
                                                        className="inline-block w-2 h-2 rounded-sm mr-1"
                                                        style={{
                                                            background: anchor.type === 'rect'
                                                                ? getRectGroupColor(anchor.groupId ?? 0)
                                                                : ANCHOR_COLORS[anchor.type ?? 'rect']
                                                        }}
                                                    />
                                                    {getAnchorLabel(anchor, i)}
                                                </td>
                                                <td className="text-right py-0.5 pr-2">{anchor.x}</td>
                                                <td className="text-right py-0.5">{anchor.y}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
