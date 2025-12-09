import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useControls, button } from 'leva';

interface Rectangle {
    id: number;
    x: number;      // top-left x (normalized 0-1)
    y: number;      // top-left y (normalized 0-1)
    width: number;  // normalized 0-1
    height: number; // normalized 0-1
    color: string;
}

type DragMode = null | {
    rectId: number;
    type: 'move' | 'corner';
    corner?: 'tl' | 'tr' | 'bl' | 'br';
    startMouse: { x: number; y: number };
    startRect: Rectangle;
};

interface AnchorPickerProps {
    svgPath: string;
}

const COLORS = [
    '#e63946', '#2a9d8f', '#e9c46a', '#8338ec',
    '#f77f00', '#06d6a0', '#3a86ff', '#ff006e',
];

export const AnchorPicker: React.FC<AnchorPickerProps> = ({ svgPath }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [svgContent, setSvgContent] = useState<string>('');
    const [svgViewBox, setSvgViewBox] = useState({ width: 215, height: 181 });

    // View state
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState({ x: 0, y: 0 });

    // Coordinates panel state
    const [coordsPanelPos, setCoordsPanelPos] = useState({ x: 0, y: 0 }); // offset from default position
    const [coordsPanelCollapsed, setCoordsPanelCollapsed] = useState(false);
    const [isDraggingPanel, setIsDraggingPanel] = useState(false);
    const [panelDragStart, setPanelDragStart] = useState({ x: 0, y: 0 });

    // Rectangle state
    const [rectangles, setRectangles] = useState<Rectangle[]>(() =>
        Array.from({ length: 4 }, (_, i) => ({
            id: i,
            x: 0.35 + (i % 2) * 0.05,
            y: 0.35 + Math.floor(i / 2) * 0.05,
            width: 0.3 - i * 0.05,
            height: 0.3 - i * 0.05,
            color: COLORS[i % COLORS.length],
        }))
    );
    const [dragMode, setDragMode] = useState<DragMode>(null);
    const [selectedRect, setSelectedRect] = useState<number | null>(null);

    // Refs for current values (needed for Leva button callbacks)
    const rectanglesRef = useRef(rectangles);
    const svgViewBoxRef = useRef(svgViewBox);
    rectanglesRef.current = rectangles;
    svgViewBoxRef.current = svgViewBox;

    // Leva controls
    const { showRects, handleSize, strokeWidth, rectCount } = useControls({
        showRects: { value: true, label: 'Show Rectangles' },
        handleSize: { value: 12, min: 6, max: 24, step: 2, label: 'Handle Size' },
        strokeWidth: { value: 2, min: 1, max: 6, step: 0.5, label: 'Stroke Width' },
        rectCount: { value: 4, min: 4, max: 12, step: 1, label: 'Rectangle Count' },
        'Export Anchors': button(() => {
            // Use refs to get current values (not stale closure)
            const currentRects = rectanglesRef.current;
            const currentViewBox = svgViewBoxRef.current;
            const anchors: { rectId: number; corner: string; x: string; y: string }[] = [];
            currentRects.forEach(rect => {
                const corners = [
                    { corner: 'tl', x: rect.x, y: rect.y },
                    { corner: 'tr', x: rect.x + rect.width, y: rect.y },
                    { corner: 'bl', x: rect.x, y: rect.y + rect.height },
                    { corner: 'br', x: rect.x + rect.width, y: rect.y + rect.height },
                ];
                corners.forEach(c => {
                    anchors.push({
                        rectId: rect.id,
                        corner: c.corner,
                        // 4 decimal places as strings to preserve trailing zeros
                        x: (c.x * currentViewBox.width).toFixed(4),
                        y: (c.y * currentViewBox.height).toFixed(4),
                    });
                });
            });
            console.log('Anchor positions:', JSON.stringify(anchors, null, 2));
            navigator.clipboard?.writeText(JSON.stringify(anchors, null, 2));
            alert(`${anchors.length} anchor positions copied to clipboard!`);
        }),
        'Reset Rectangles': button(() => {
            setRectangles(Array.from({ length: rectCount }, (_, i) => ({
                id: i,
                x: 0.35 + (i % 2) * 0.05,
                y: 0.35 + Math.floor(i / 2) * 0.05,
                width: 0.3 - (i % 4) * 0.05,
                height: 0.3 - (i % 4) * 0.05,
                color: COLORS[i % COLORS.length],
            })));
        }),
    });

    // Update rectangle count when changed
    useEffect(() => {
        setRectangles(prev => {
            if (prev.length === rectCount) return prev;
            if (prev.length < rectCount) {
                // Add new rectangles
                const newRects = [...prev];
                for (let i = prev.length; i < rectCount; i++) {
                    newRects.push({
                        id: i,
                        x: 0.4,
                        y: 0.4,
                        width: 0.2,
                        height: 0.2,
                        color: COLORS[i % COLORS.length],
                    });
                }
                return newRects;
            } else {
                // Remove rectangles from end
                return prev.slice(0, rectCount);
            }
        });
    }, [rectCount]);

    // Load SVG
    useEffect(() => {
        fetch(svgPath)
            .then(res => res.text())
            .then(text => {
                setSvgContent(text);
                const viewBoxMatch = text.match(/viewBox="([^"]+)"/);
                if (viewBoxMatch) {
                    const parts = viewBoxMatch[1].split(/\s+/).map(Number);
                    if (parts.length >= 4) {
                        setSvgViewBox({ width: parts[2], height: parts[3] });
                    }
                }
            })
            .catch(err => console.error('Failed to load SVG:', err));
    }, [svgPath]);

    // Base display size
    const baseWidth = 600;
    const baseHeight = baseWidth * (svgViewBox.height / svgViewBox.width);

    // Mouse position to normalized SVG coordinates
    const mouseToNormalized = useCallback((clientX: number, clientY: number) => {
        if (!containerRef.current) return { x: 0.5, y: 0.5 };
        const rect = containerRef.current.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;
        const svgX = (mouseX - centerX - pan.x) / zoom + baseWidth / 2;
        const svgY = (mouseY - centerY - pan.y) / zoom + baseHeight / 2;
        return {
            x: svgX / baseWidth,
            y: svgY / baseHeight,
        };
    }, [pan, zoom, baseWidth, baseHeight]);

    // Handle wheel zoom
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setZoom(z => Math.max(0.2, Math.min(10, z * delta)));
    }, []);

    // Handle mouse down
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0) return;

        const target = e.target as HTMLElement;

        // Check if clicking on a corner handle
        const cornerHandle = target.closest('[data-corner]');
        if (cornerHandle) {
            const rectId = parseInt(cornerHandle.getAttribute('data-rect-id') || '0');
            const corner = cornerHandle.getAttribute('data-corner') as 'tl' | 'tr' | 'bl' | 'br';
            const rect = rectangles.find(r => r.id === rectId);
            if (rect) {
                setDragMode({
                    rectId,
                    type: 'corner',
                    corner,
                    startMouse: { x: e.clientX, y: e.clientY },
                    startRect: { ...rect },
                });
                setSelectedRect(rectId);
            }
            return;
        }

        // Check if clicking on a rectangle body
        const rectBody = target.closest('[data-rect-body]');
        if (rectBody) {
            const rectId = parseInt(rectBody.getAttribute('data-rect-id') || '0');
            const rect = rectangles.find(r => r.id === rectId);
            if (rect) {
                setDragMode({
                    rectId,
                    type: 'move',
                    startMouse: { x: e.clientX, y: e.clientY },
                    startRect: { ...rect },
                });
                setSelectedRect(rectId);
            }
            return;
        }

        // Otherwise, start panning
        setIsPanning(true);
        setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }, [rectangles, pan]);

    // Handle mouse move
    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        // Handle panel dragging
        if (isDraggingPanel) {
            setCoordsPanelPos({
                x: e.clientX - panelDragStart.x,
                y: e.clientY - panelDragStart.y,
            });
            return;
        }

        if (isPanning) {
            setPan({
                x: e.clientX - panStart.x,
                y: e.clientY - panStart.y,
            });
            return;
        }

        if (!dragMode) return;

        const currentNorm = mouseToNormalized(e.clientX, e.clientY);
        const startNorm = mouseToNormalized(dragMode.startMouse.x, dragMode.startMouse.y);
        const deltaX = currentNorm.x - startNorm.x;
        const deltaY = currentNorm.y - startNorm.y;

        setRectangles(prev => prev.map(rect => {
            if (rect.id !== dragMode.rectId) return rect;

            if (dragMode.type === 'move') {
                return {
                    ...rect,
                    x: Math.max(0, Math.min(1 - rect.width, dragMode.startRect.x + deltaX)),
                    y: Math.max(0, Math.min(1 - rect.height, dragMode.startRect.y + deltaY)),
                };
            }

            if (dragMode.type === 'corner' && dragMode.corner) {
                const { startRect, corner } = dragMode;
                let newX = startRect.x;
                let newY = startRect.y;
                let newW = startRect.width;
                let newH = startRect.height;

                if (corner === 'tl') {
                    newX = Math.min(startRect.x + deltaX, startRect.x + startRect.width - 0.02);
                    newY = Math.min(startRect.y + deltaY, startRect.y + startRect.height - 0.02);
                    newW = startRect.width - (newX - startRect.x);
                    newH = startRect.height - (newY - startRect.y);
                } else if (corner === 'tr') {
                    newW = Math.max(0.02, startRect.width + deltaX);
                    newY = Math.min(startRect.y + deltaY, startRect.y + startRect.height - 0.02);
                    newH = startRect.height - (newY - startRect.y);
                } else if (corner === 'bl') {
                    newX = Math.min(startRect.x + deltaX, startRect.x + startRect.width - 0.02);
                    newW = startRect.width - (newX - startRect.x);
                    newH = Math.max(0.02, startRect.height + deltaY);
                } else if (corner === 'br') {
                    newW = Math.max(0.02, startRect.width + deltaX);
                    newH = Math.max(0.02, startRect.height + deltaY);
                }

                return {
                    ...rect,
                    x: Math.max(0, newX),
                    y: Math.max(0, newY),
                    width: Math.min(1 - Math.max(0, newX), newW),
                    height: Math.min(1 - Math.max(0, newY), newH),
                };
            }

            return rect;
        }));
    }, [isPanning, panStart, dragMode, mouseToNormalized, isDraggingPanel, panelDragStart]);

    // Handle mouse up
    const handleMouseUp = useCallback(() => {
        setIsPanning(false);
        setDragMode(null);
        setIsDraggingPanel(false);
    }, []);

    // Determine if any drag is active
    const isAnyDragActive = isPanning || isDraggingPanel || dragMode !== null;

    return (
        <div
            ref={containerRef}
            style={{
                width: '100vw',
                height: '100vh',
                overflow: 'hidden',
                background: '#1a1a2e',
                cursor: isPanning ? 'grabbing' : (dragMode ? 'grabbing' : 'grab'),
                position: 'relative',
            }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
            {/* Drag overlay - captures all mouse events during drag to prevent Leva interference */}
            {isAnyDragActive && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 9999,
                        cursor: isPanning || isDraggingPanel ? 'grabbing' : 'move',
                    }}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                />
            )}
            {/* Instructions */}
            <div style={{
                position: 'absolute',
                top: 10,
                left: 10,
                color: '#888',
                fontSize: 12,
                zIndex: 100,
                pointerEvents: 'none',
                background: 'rgba(0,0,0,0.5)',
                padding: '8px 12px',
                borderRadius: 4,
            }}>
                Scroll to zoom | Drag background to pan | Drag rectangles to move | Drag corners to resize
            </div>

            {/* Zoom indicator */}
            <div style={{
                position: 'absolute',
                bottom: 10,
                left: 10,
                color: '#666',
                fontSize: 12,
                zIndex: 100,
                pointerEvents: 'none',
            }}>
                Zoom: {(zoom * 100).toFixed(0)}% | Anchors: {rectangles.length * 4}
            </div>

            {/* All rectangle coordinates - draggable & collapsable panel */}
            <div
                style={{
                    position: 'absolute',
                    bottom: 10 + coordsPanelPos.y,
                    right: 240 - coordsPanelPos.x,
                    color: '#aaa',
                    fontSize: 10,
                    zIndex: 100,
                    background: 'rgba(0,0,0,0.8)',
                    borderRadius: 4,
                    fontFamily: 'monospace',
                    maxHeight: coordsPanelCollapsed ? 'auto' : '60vh',
                    overflow: 'hidden',
                    userSelect: 'none',
                }}
            >
                {/* Panel header - draggable */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        background: 'rgba(255,255,255,0.1)',
                        cursor: 'move',
                        borderBottom: coordsPanelCollapsed ? 'none' : '1px solid rgba(255,255,255,0.1)',
                    }}
                    onMouseDown={(e) => {
                        e.stopPropagation();
                        setIsDraggingPanel(true);
                        setPanelDragStart({
                            x: e.clientX - coordsPanelPos.x,
                            y: e.clientY - coordsPanelPos.y,
                        });
                    }}
                >
                    <span style={{ fontWeight: 'bold', color: '#fff' }}>Coordinates</span>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setCoordsPanelCollapsed(!coordsPanelCollapsed);
                        }}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: '#888',
                            cursor: 'pointer',
                            fontSize: 14,
                            padding: '0 4px',
                        }}
                    >
                        {coordsPanelCollapsed ? '▼' : '▲'}
                    </button>
                </div>
                {/* Panel content */}
                {!coordsPanelCollapsed && (
                    <div style={{ padding: '8px 12px', overflowY: 'auto', maxHeight: 'calc(60vh - 30px)' }}>
                        {rectangles.map(rect => {
                            const tl = { x: (rect.x * svgViewBox.width).toFixed(4), y: (rect.y * svgViewBox.height).toFixed(4) };
                            const tr = { x: ((rect.x + rect.width) * svgViewBox.width).toFixed(4), y: (rect.y * svgViewBox.height).toFixed(4) };
                            const bl = { x: (rect.x * svgViewBox.width).toFixed(4), y: ((rect.y + rect.height) * svgViewBox.height).toFixed(4) };
                            const br = { x: ((rect.x + rect.width) * svgViewBox.width).toFixed(4), y: ((rect.y + rect.height) * svgViewBox.height).toFixed(4) };
                            const isSelected = selectedRect === rect.id;
                            return (
                                <div key={rect.id} style={{
                                    marginBottom: 8,
                                    opacity: isSelected ? 1 : 0.7,
                                    borderLeft: isSelected ? `3px solid ${rect.color}` : '3px solid transparent',
                                    paddingLeft: 6,
                                }}>
                                    <div style={{ color: rect.color, fontWeight: 'bold' }}>Rect {rect.id + 1}</div>
                                    <div>TL: ({tl.x}, {tl.y})</div>
                                    <div>TR: ({tr.x}, {tr.y})</div>
                                    <div>BL: ({bl.x}, {bl.y})</div>
                                    <div>BR: ({br.x}, {br.y})</div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

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
                {/* SVG with white background */}
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

                {/* Rectangles */}
                {showRects && rectangles.map(rect => {
                    const x = rect.x * baseWidth;
                    const y = rect.y * baseHeight;
                    const w = rect.width * baseWidth;
                    const h = rect.height * baseHeight;
                    const isSelected = selectedRect === rect.id;
                    const isDragging = dragMode?.rectId === rect.id;
                    const hs = handleSize / zoom; // Handle size adjusted for zoom

                    return (
                        <React.Fragment key={rect.id}>
                            {/* Rectangle outline */}
                            <div
                                data-rect-body
                                data-rect-id={rect.id}
                                style={{
                                    position: 'absolute',
                                    left: x,
                                    top: y,
                                    width: w,
                                    height: h,
                                    border: `${strokeWidth / zoom}px solid ${rect.color}`,
                                    background: isSelected ? `${rect.color}15` : 'transparent',
                                    cursor: 'move',
                                    boxSizing: 'border-box',
                                    zIndex: isDragging ? 10000 : (isSelected ? 100 : 10),
                                }}
                            />

                            {/* Corner handles */}
                            {[
                                { corner: 'tl', cx: x, cy: y },
                                { corner: 'tr', cx: x + w, cy: y },
                                { corner: 'bl', cx: x, cy: y + h },
                                { corner: 'br', cx: x + w, cy: y + h },
                            ].map(({ corner, cx, cy }) => (
                                <div
                                    key={corner}
                                    data-corner={corner}
                                    data-rect-id={rect.id}
                                    style={{
                                        position: 'absolute',
                                        left: cx - hs / 2,
                                        top: cy - hs / 2,
                                        width: hs,
                                        height: hs,
                                        background: rect.color,
                                        border: `${2 / zoom}px solid white`,
                                        borderRadius: '50%',
                                        cursor: corner === 'tl' || corner === 'br' ? 'nwse-resize' : 'nesw-resize',
                                        boxShadow: `0 ${2 / zoom}px ${4 / zoom}px rgba(0,0,0,0.3)`,
                                        zIndex: isSelected ? 100 : 10,
                                    }}
                                />
                            ))}

                            {/* Rectangle label */}
                            <div
                                style={{
                                    position: 'absolute',
                                    left: x + w / 2,
                                    top: y + h / 2,
                                    transform: 'translate(-50%, -50%)',
                                    background: rect.color,
                                    color: 'white',
                                    padding: `${2 / zoom}px ${6 / zoom}px`,
                                    borderRadius: 4 / zoom,
                                    fontSize: 14 / zoom,
                                    fontWeight: 'bold',
                                    pointerEvents: 'none',
                                    opacity: 0.9,
                                }}
                            >
                                {rect.id + 1}
                            </div>
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );
};
