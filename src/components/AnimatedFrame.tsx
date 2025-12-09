import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { parsePath, extractPathFromSvg, parseTransform } from '../lib/pathParser';
import { computeInfluenceMap, loadAnchors, AnchorData } from '../lib/anchorInfluence';
import { FrameAnimator, DEFAULT_PARAMS, GradientStop, GradientConfig, AnimationParams } from '../lib/frameAnimator';
import { StretchConfig, applyStretchConfig, getStretchedViewBox } from '../lib/stretchZone';

// Margin around the canvas for animation overflow (as percentage of each side)
const MARGIN_PERCENT = 0.15;

export type { GradientStop };

export interface StyleConfig {
    fill?: string;
    gradient?: GradientConfig;
}

export interface AnimatedFrameProps {
    svgPath: string;
    anchorsData: AnchorData[];
    width?: number; // Optional fixed width (for library usage)
    style?: StyleConfig;
    params: AnimationParams;
    zoom?: number;
    pan?: { x: number; y: number };
    onZoomChange?: (zoom: number) => void;
    onPanChange?: (pan: { x: number; y: number }) => void;
    stretchConfig?: StretchConfig;
    showAnchors?: boolean;
}

// Core component that renders the canvas - no Leva dependency
const AnimatedFrameCore: React.FC<{
    svgPath: string;
    anchorsData: AnchorData[];
    width?: number;
    style?: StyleConfig;
    params: AnimationParams;
    zoom: number;
    pan: { x: number; y: number };
    onZoomChange?: (zoom: number) => void;
    onPanChange?: (pan: { x: number; y: number }) => void;
    stretchConfig?: StretchConfig;
    showAnchors?: boolean;
}> = ({
    svgPath,
    anchorsData,
    width,
    style,
    params,
    zoom,
    pan,
    onZoomChange,
    onPanChange,
    stretchConfig,
    showAnchors = false,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animatorRef = useRef<FrameAnimator | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [viewBox, setViewBox] = useState({ width: 215, height: 181 });
    const [containerSize, setContainerSize] = useState({ width: 600, height: 400 });

    // For drag-to-pan
    const isDragging = useRef(false);
    const lastMousePos = useRef({ x: 0, y: 0 });

    // Calculate effective dimensions maintaining aspect ratio
    const { effectiveWidth, effectiveHeight } = useMemo(() => {
        if (width) {
            // Fixed width mode - calculate height from aspect ratio
            return {
                effectiveWidth: width,
                effectiveHeight: Math.round(width * (viewBox.height / viewBox.width)),
            };
        }

        // Fill container mode - fit within container maintaining aspect ratio
        const containerAspect = containerSize.width / containerSize.height;
        const svgAspect = viewBox.width / viewBox.height;

        if (containerAspect > svgAspect) {
            // Container is wider than SVG - fit by height
            const h = containerSize.height;
            const w = h * svgAspect;
            return { effectiveWidth: w, effectiveHeight: h };
        } else {
            // Container is taller than SVG - fit by width
            const w = containerSize.width;
            const h = w / svgAspect;
            return { effectiveWidth: w, effectiveHeight: h };
        }
    }, [width, containerSize, viewBox]);

    // Observe container size changes (when no fixed width)
    useEffect(() => {
        if (width || !containerRef.current) return;

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) {
                setContainerSize({
                    width: entry.contentRect.width,
                    height: entry.contentRect.height,
                });
            }
        });

        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, [width]);

    // Initialize animator once SVG is loaded
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || effectiveWidth === 0 || effectiveHeight === 0) return;

        const controller = new AbortController();
        let cancelled = false;

        async function init() {
            try {
                const response = await fetch(svgPath, { signal: controller.signal });
                const svgText = await response.text();

                const extracted = extractPathFromSvg(svgText);
                if (!extracted) {
                    throw new Error('Could not extract path from SVG');
                }

                const vbParts = extracted.viewBox.split(/\s+/).map(Number);
                const vb = {
                    width: vbParts[2] || 215,
                    height: vbParts[3] || 181,
                };

                if (cancelled) return;
                setViewBox(vb);

                const transformOffset = parseTransform(extracted.transform);
                const parsedPath = parsePath(extracted.d, transformOffset);

                // Apply stretch transformation to coordinates
                const stretchedCoords = applyStretchConfig(parsedPath.coords, stretchConfig ?? null);
                const stretchedPath = {
                    ...parsedPath,
                    coords: stretchedCoords,
                };

                // Adjust viewBox dimensions for stretch
                const stretchedVb = getStretchedViewBox(vb.width, vb.height, stretchConfig ?? null);

                const anchors = loadAnchors(anchorsData);
                const influence = computeInfluenceMap(
                    stretchedPath.coords,
                    anchors,
                    params.falloffRadius,
                    transformOffset
                );

                if (cancelled) return;

                // Recalculate effective dimensions with stretched viewBox
                let finalWidth = effectiveWidth;
                let finalHeight = effectiveHeight;
                const hasStretch = stretchConfig && (
                    (stretchConfig.x.enabled && stretchConfig.x.stretchAmount !== 0) ||
                    (stretchConfig.y.enabled && stretchConfig.y.stretchAmount !== 0)
                );
                if (hasStretch) {
                    // Maintain aspect ratio with new dimensions
                    const stretchedAspect = stretchedVb.width / stretchedVb.height;
                    if (width) {
                        finalHeight = Math.round(width / stretchedAspect);
                    } else {
                        const containerAspect = containerSize.width / containerSize.height;
                        if (containerAspect > stretchedAspect) {
                            finalHeight = containerSize.height;
                            finalWidth = finalHeight * stretchedAspect;
                        } else {
                            finalWidth = containerSize.width;
                            finalHeight = finalWidth / stretchedAspect;
                        }
                    }
                }

                // Add margin for animation overflow
                const marginX = finalWidth * MARGIN_PERCENT;
                const marginY = finalHeight * MARGIN_PERCENT;

                const dpr = window.devicePixelRatio || 1;
                const canvasW = finalWidth + marginX * 2;
                const canvasH = finalHeight + marginY * 2;
                canvas.width = canvasW * dpr;
                canvas.height = canvasH * dpr;
                canvas.style.width = `${canvasW}px`;
                canvas.style.height = `${canvasH}px`;

                // Extended viewBox to include margin (using stretched dimensions)
                const marginVbX = (marginX / finalWidth) * stretchedVb.width;
                const marginVbY = (marginY / finalHeight) * stretchedVb.height;
                const extendedVb = {
                    width: stretchedVb.width + marginVbX * 2,
                    height: stretchedVb.height + marginVbY * 2,
                };

                const animator = new FrameAnimator(
                    canvas,
                    stretchedPath,
                    extendedVb,
                    { offsetX: marginVbX, offsetY: marginVbY }
                );

                animator.setInfluence(influence);

                if (style?.gradient) {
                    animator.setGradient(style.gradient);
                } else if (style?.fill) {
                    animator.setFillColor(style.fill);
                }

                animatorRef.current = animator;
                animator.start();
                setIsLoading(false);
            } catch (err) {
                // Ignore abort errors - they're expected on cleanup
                if (err instanceof Error && err.name === 'AbortError') return;
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : 'Unknown error');
                    setIsLoading(false);
                }
            }
        }

        init();

        return () => {
            cancelled = true;
            controller.abort();
            animatorRef.current?.stop();
        };
    }, [svgPath, anchorsData, effectiveWidth, effectiveHeight, stretchConfig, containerSize, width]);

    // Update params when they change
    useEffect(() => {
        const animator = animatorRef.current;
        if (!animator) return;

        animator.setParams({
            motionType: params.motionType,
            speed: params.speed,
            intensity: params.intensity,
            breathingAmount: params.breathingAmount,
            warpStrength: params.warpStrength,
            writheSpeed: params.writheSpeed,
            writheIntensity: params.writheIntensity,
            coilTightness: params.coilTightness,
            eldritchOriginX: params.eldritchOriginX,
            eldritchOriginY: params.eldritchOriginY,
            noiseScale: params.noiseScale,
            octaves: params.octaves,
            falloffRadius: params.falloffRadius,
        });
    }, [params]);

    // Recompute influence when falloff changes
    useEffect(() => {
        const animator = animatorRef.current;
        if (!animator) return;

        const controller = new AbortController();

        (async () => {
            try {
                const response = await fetch(svgPath, { signal: controller.signal });
                const svgText = await response.text();
                const extracted = extractPathFromSvg(svgText);
                if (!extracted) return;

                const transformOffset = parseTransform(extracted.transform);
                const parsedPath = parsePath(extracted.d, transformOffset);
                const stretchedCoords = applyStretchConfig(parsedPath.coords, stretchConfig ?? null);
                const anchors = loadAnchors(anchorsData);
                const influence = computeInfluenceMap(
                    stretchedCoords,
                    anchors,
                    params.falloffRadius,
                    transformOffset
                );
                animator.setInfluence(influence);
            } catch (err) {
                // Ignore abort errors - they're expected on cleanup
                if (err instanceof Error && err.name === 'AbortError') return;
                // Log warning but don't show error UI - animator continues with stale influence data
                console.warn('Failed to recompute influence, using previous values:', err);
            }
        })();

        return () => controller.abort();
    }, [params.falloffRadius, svgPath, anchorsData, stretchConfig]);

    // Update style when it changes
    useEffect(() => {
        const animator = animatorRef.current;
        if (!animator) return;

        if (style?.gradient) {
            animator.setGradient(style.gradient);
        } else if (style?.fill) {
            animator.setFillColor(style.fill);
        }
    }, [style?.fill, style?.gradient]);

    // Handle wheel zoom
    const handleWheel = useCallback((e: React.WheelEvent) => {
        if (!onZoomChange) return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.min(Math.max(zoom * delta, 0.1), 5);
        onZoomChange(newZoom);
    }, [zoom, onZoomChange]);

    // Handle mouse down for pan
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        // Middle click or Alt+left click to pan
        if (e.button === 1 || (e.button === 0 && e.altKey)) {
            isDragging.current = true;
            lastMousePos.current = { x: e.clientX, y: e.clientY };
            e.preventDefault();
        }
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging.current || !onPanChange) return;
        const dx = e.clientX - lastMousePos.current.x;
        const dy = e.clientY - lastMousePos.current.y;
        lastMousePos.current = { x: e.clientX, y: e.clientY };
        onPanChange({ x: pan.x + dx, y: pan.y + dy });
    }, [pan, onPanChange]);

    const handleMouseUp = useCallback(() => {
        isDragging.current = false;
    }, []);

    if (error) {
        return (
            <div
                ref={containerRef}
                className="w-full h-full flex items-center justify-center bg-red-50 text-red-600 font-mono p-5"
            >
                Error: {error}
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="w-full h-full relative overflow-hidden cursor-grab active:cursor-grabbing"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
            <div
                className="absolute inset-0 flex items-center justify-center"
                style={{
                    transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                    transformOrigin: 'center center',
                }}
            >
                <canvas
                    ref={canvasRef}
                    className="block"
                />
                {/* Anchor overlay */}
                {showAnchors && !isLoading && (
                    <svg
                        className="absolute pointer-events-none"
                        style={{
                            width: effectiveWidth,
                            height: effectiveHeight,
                        }}
                        viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
                    >
                        {anchorsData.map((anchor, i) => {
                            const x = parseFloat(anchor.x);
                            const y = parseFloat(anchor.y);
                            const type = anchor.type || 'rect';
                            const color = type === 'rect' ? '#10b981' : type === 'line' ? '#3b82f6' : '#f59e0b';
                            return (
                                <g key={i}>
                                    <circle
                                        cx={x}
                                        cy={y}
                                        r={3}
                                        fill={color}
                                        stroke="white"
                                        strokeWidth={1}
                                    />
                                    <circle
                                        cx={x}
                                        cy={y}
                                        r={params.falloffRadius}
                                        fill="none"
                                        stroke={color}
                                        strokeWidth={0.5}
                                        strokeDasharray="2,2"
                                        opacity={0.5}
                                    />
                                </g>
                            );
                        })}
                    </svg>
                )}
            </div>
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80 font-mono">
                    Loading...
                </div>
            )}
        </div>
    );
};

// Main export
export const AnimatedFrame: React.FC<AnimatedFrameProps> = ({
    svgPath,
    anchorsData,
    width,
    style,
    params,
    zoom = 1,
    pan = { x: 0, y: 0 },
    onZoomChange,
    onPanChange,
    stretchConfig,
    showAnchors = false,
}) => (
    <AnimatedFrameCore
        svgPath={svgPath}
        anchorsData={anchorsData}
        width={width}
        style={style}
        params={params}
        zoom={zoom}
        pan={pan}
        onZoomChange={onZoomChange}
        onPanChange={onPanChange}
        stretchConfig={stretchConfig}
        showAnchors={showAnchors}
    />
);
