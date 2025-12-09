import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { AnimatedFrame } from './components/AnimatedFrame';
import { Navbar } from './components/Navbar';
import { ControlPanel } from './components/ControlPanel';
import { AnchorEditor } from './components/AnchorEditor';
import { AnimationParams, DEFAULT_PARAMS } from './lib/frameAnimator';
import { AnchorData } from './lib/anchorInfluence';
import { StretchConfig, createDefaultStretchConfig } from './lib/stretchZone';
import defaultAnchorsData from '../corners.json';

// Default viewBox dimensions for positioning new anchors
const DEFAULT_VB = { width: 215, height: 181 };

function App() {
    const [svgPath, setSvgPath] = useState('/button_card_2.svg');
    const [svgName, setSvgName] = useState('button_card_2.svg');
    const [params, setParams] = useState<AnimationParams>({ ...DEFAULT_PARAMS });
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isEditingAnchors, setIsEditingAnchors] = useState(false);
    const [showAnchors, setShowAnchors] = useState(false);
    const [stretchConfig, setStretchConfig] = useState<StretchConfig>(() =>
        createDefaultStretchConfig(DEFAULT_VB.width, DEFAULT_VB.height)
    );
    const prevBlobUrlRef = useRef<string | null>(null);

    // Full anchor state (not just counts)
    const [anchors, setAnchors] = useState<AnchorData[]>(() => {
        // Initialize from corners.json with type metadata
        return defaultAnchorsData.map(a => ({
            ...a,
            type: 'rect' as const,
            groupId: a.rectId ?? 0,
        }));
    });

    // Compute counts from anchors
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

    // Convert to the format AnimatedFrame expects
    const anchorsData = useMemo(() => anchors, [anchors]);

    // Handle anchor count changes
    const handleAnchorCountsChange = useCallback((counts: { rect?: number; line?: number; single?: number }) => {
        setAnchors(prev => {
            const newAnchors = [...prev];

            // Handle rect count change
            if (counts.rect !== undefined) {
                const currentRectGroups = new Set(prev.filter(a => a.type === 'rect').map(a => a.groupId ?? 0));
                const currentCount = currentRectGroups.size;

                if (counts.rect > currentCount) {
                    // Add new rect groups
                    for (let i = currentCount; i < counts.rect; i++) {
                        const newGroupId = Math.max(0, ...Array.from(currentRectGroups)) + 1 + (i - currentCount);
                        // Place new rect at center with offset based on group id
                        const cx = DEFAULT_VB.width / 2;
                        const cy = DEFAULT_VB.height / 2;
                        const size = 30 - (i % 4) * 5;
                        const offset = (i % 4) * 5;

                        newAnchors.push(
                            { type: 'rect', groupId: newGroupId, corner: 'tl', x: String((cx - size + offset).toFixed(4)), y: String((cy - size + offset).toFixed(4)) },
                            { type: 'rect', groupId: newGroupId, corner: 'tr', x: String((cx + size + offset).toFixed(4)), y: String((cy - size + offset).toFixed(4)) },
                            { type: 'rect', groupId: newGroupId, corner: 'bl', x: String((cx - size + offset).toFixed(4)), y: String((cy + size + offset).toFixed(4)) },
                            { type: 'rect', groupId: newGroupId, corner: 'br', x: String((cx + size + offset).toFixed(4)), y: String((cy + size + offset).toFixed(4)) },
                        );
                        currentRectGroups.add(newGroupId);
                    }
                } else if (counts.rect < currentCount) {
                    // Remove rect groups (remove highest groupId first)
                    const sortedGroups = Array.from(currentRectGroups).sort((a, b) => b - a);
                    const groupsToRemove = sortedGroups.slice(0, currentCount - counts.rect);
                    return newAnchors.filter(a => !(a.type === 'rect' && groupsToRemove.includes(a.groupId ?? 0)));
                }
            }

            // Handle line count change
            if (counts.line !== undefined) {
                const currentLineGroups = new Set(prev.filter(a => a.type === 'line').map(a => a.groupId ?? 0));
                const currentCount = currentLineGroups.size;

                if (counts.line > currentCount) {
                    for (let i = currentCount; i < counts.line; i++) {
                        const newGroupId = 100 + i; // Line groups start at 100
                        const cy = DEFAULT_VB.height / 2 + (i * 10);
                        newAnchors.push(
                            { type: 'line', groupId: newGroupId, position: 'start', x: String((DEFAULT_VB.width * 0.2).toFixed(4)), y: String(cy.toFixed(4)) },
                            { type: 'line', groupId: newGroupId, position: 'end', x: String((DEFAULT_VB.width * 0.8).toFixed(4)), y: String(cy.toFixed(4)) },
                        );
                    }
                } else if (counts.line < currentCount) {
                    const sortedGroups = Array.from(currentLineGroups).sort((a, b) => b - a);
                    const groupsToRemove = sortedGroups.slice(0, currentCount - counts.line);
                    return newAnchors.filter(a => !(a.type === 'line' && groupsToRemove.includes(a.groupId ?? 0)));
                }
            }

            // Handle single count change
            if (counts.single !== undefined) {
                const currentSingles = prev.filter(a => a.type === 'single');
                const currentCount = currentSingles.length;

                if (counts.single > currentCount) {
                    for (let i = currentCount; i < counts.single; i++) {
                        const newGroupId = 200 + i; // Single anchors start at 200
                        newAnchors.push({
                            type: 'single',
                            groupId: newGroupId,
                            x: String((DEFAULT_VB.width / 2 + (i - counts.single / 2) * 15).toFixed(4)),
                            y: String((DEFAULT_VB.height / 2).toFixed(4)),
                        });
                    }
                } else if (counts.single < currentCount) {
                    // Remove from end
                    const singlesToKeep = currentSingles.slice(0, counts.single);
                    const singleGroupIds = new Set(singlesToKeep.map(a => a.groupId));
                    return newAnchors.filter(a => a.type !== 'single' || singleGroupIds.has(a.groupId));
                }
            }

            return newAnchors;
        });
    }, []);

    // Clean up blob URLs to prevent memory leaks
    useEffect(() => {
        return () => {
            if (prevBlobUrlRef.current) {
                URL.revokeObjectURL(prevBlobUrlRef.current);
            }
        };
    }, []);

    const handleImport = useCallback((file: File) => {
        // Revoke previous blob URL if it exists
        if (prevBlobUrlRef.current) {
            URL.revokeObjectURL(prevBlobUrlRef.current);
        }

        // Create a blob URL for the uploaded file
        const blobUrl = URL.createObjectURL(file);
        prevBlobUrlRef.current = blobUrl;
        setSvgPath(blobUrl);
        setSvgName(file.name);
    }, []);

    const handleParamsChange = useCallback((newParams: Partial<AnimationParams>) => {
        setParams((prev) => ({ ...prev, ...newParams }));
    }, []);

    const handleZoomIn = useCallback(() => {
        setZoom((z) => Math.min(z * 1.25, 5));
    }, []);

    const handleZoomOut = useCallback(() => {
        setZoom((z) => Math.max(z / 1.25, 0.1));
    }, []);

    const handleResetView = useCallback(() => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
    }, []);

    return (
        <>
            <div className="h-screen flex flex-col">
                <Navbar
                    fileName={svgName}
                    onImport={handleImport}
                    onEditAnchors={() => setIsEditingAnchors(true)}
                    onZoomIn={handleZoomIn}
                    onZoomOut={handleZoomOut}
                    onResetView={handleResetView}
                />
                <div className="flex-1 flex overflow-hidden">
                    <main className="flex-1 bg-neutral-100 overflow-hidden relative">
                        <AnimatedFrame
                            svgPath={svgPath}
                            anchorsData={anchorsData}
                            params={params}
                            zoom={zoom}
                            pan={pan}
                            onZoomChange={setZoom}
                            onPanChange={setPan}
                            stretchConfig={stretchConfig}
                            showAnchors={showAnchors}
                        />
                    </main>
                    <ControlPanel
                        params={params}
                        onParamsChange={handleParamsChange}
                        anchorCounts={anchorCounts}
                        onEditAnchors={() => setIsEditingAnchors(true)}
                        showAnchors={showAnchors}
                        onShowAnchorsChange={setShowAnchors}
                    />
                </div>
            </div>

            {/* Anchor Editor Modal */}
            {isEditingAnchors && (
                <AnchorEditor
                    svgPath={svgPath}
                    anchors={anchors}
                    onAnchorsChange={setAnchors}
                    stretchConfig={stretchConfig}
                    onStretchConfigChange={setStretchConfig}
                    onClose={() => setIsEditingAnchors(false)}
                />
            )}
        </>
    );
}

export default App;
