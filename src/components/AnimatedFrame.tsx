import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useControls, folder, Leva } from 'leva';
import { parsePath, extractPathFromSvg, parseTransform } from '../lib/pathParser';
import { computeInfluenceMap, loadAnchors, Anchor } from '../lib/anchorInfluence';
import { FrameAnimator, DEFAULT_PARAMS, GradientStop, GradientConfig, MotionType } from '../lib/frameAnimator';

export type { GradientStop };

export interface StyleConfig {
    fill?: string;
    gradient?: GradientConfig;
}

export interface AnimatedFrameProps {
    svgPath: string;
    anchorsData: Array<{ x: string; y: string; rectId?: number; corner?: string }>;
    width?: number;
    style?: StyleConfig;
    showControls?: boolean; // Show Leva panel (default: true)
    defaultParams?: Partial<typeof DEFAULT_PARAMS>;
}

export const AnimatedFrame: React.FC<AnimatedFrameProps> = ({
    svgPath,
    anchorsData,
    width = 600,
    style,
    showControls = true,
    defaultParams,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animatorRef = useRef<FrameAnimator | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [viewBox, setViewBox] = useState({ width: 215, height: 181 });

    // Merge default params with user-provided defaults
    const mergedDefaults = useMemo(() => ({
        ...DEFAULT_PARAMS,
        ...defaultParams,
    }), [defaultParams]);

    // Leva controls for real-time parameter tweaking
    const params = useControls('Animation', {
        motionType: {
            value: mergedDefaults.motionType,
            options: { 'Psychedelic': 'psychedelic', 'Eldritch': 'eldritch' } as Record<string, MotionType>,
            label: 'Motion Style'
        },
        Motion: folder({
            speed: { value: mergedDefaults.speed, min: 0, max: 1, step: 0.05 },
            intensity: { value: mergedDefaults.intensity, min: 0, max: 15, step: 0.5 },
        }),
        'Psychedelic Settings': folder({
            breathingAmount: { value: mergedDefaults.breathingAmount, min: 0, max: 2, step: 0.1 },
            warpStrength: { value: mergedDefaults.warpStrength, min: 0, max: 40, step: 1 },
        }),
        'Eldritch Settings': folder({
            writheSpeed: { value: mergedDefaults.writheSpeed, min: 0.1, max: 3, step: 0.1, label: 'Writhe Speed' },
            writheIntensity: { value: mergedDefaults.writheIntensity, min: 0, max: 2, step: 0.1, label: 'Writhe Intensity' },
            coilTightness: { value: mergedDefaults.coilTightness, min: 0, max: 2, step: 0.1, label: 'Coil Tightness' },
        }),
        Noise: folder({
            noiseScale: { value: mergedDefaults.noiseScale, min: 0.001, max: 0.05, step: 0.001 },
            octaves: { value: mergedDefaults.octaves, min: 1, max: 6, step: 1 },
        }),
        Anchors: folder({
            falloffRadius: { value: mergedDefaults.falloffRadius, min: 5, max: 60, step: 1 },
        }),
    });

    // Calculate height based on aspect ratio
    const height = Math.round(width * (viewBox.height / viewBox.width));

    // Initialize animator once SVG is loaded
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        let cancelled = false;

        async function init() {
            try {
                // Fetch and parse SVG
                const response = await fetch(svgPath);
                const svgText = await response.text();

                const extracted = extractPathFromSvg(svgText);
                if (!extracted) {
                    throw new Error('Could not extract path from SVG');
                }

                // Parse viewBox
                const vbParts = extracted.viewBox.split(/\s+/).map(Number);
                const vb = {
                    width: vbParts[2] || 215,
                    height: vbParts[3] || 181,
                };

                if (cancelled) return;
                setViewBox(vb);

                // Parse transform offset
                const transformOffset = parseTransform(extracted.transform);

                // Parse path with transform offset applied
                const parsedPath = parsePath(extracted.d, transformOffset);

                // Load anchors and compute influence map
                const anchors = loadAnchors(anchorsData);
                const influence = computeInfluenceMap(
                    parsedPath.coords,
                    anchors,
                    params.falloffRadius,
                    transformOffset
                );

                if (cancelled) return;

                // Set up canvas
                const dpr = window.devicePixelRatio || 1;
                const canvasWidth = width * dpr;
                const canvasHeight = Math.round(width * (vb.height / vb.width)) * dpr;
                canvas.width = canvasWidth;
                canvas.height = canvasHeight;
                canvas.style.width = `${width}px`;
                canvas.style.height = `${Math.round(width * (vb.height / vb.width))}px`;

                // Create animator (transform already applied during parsing)
                const animator = new FrameAnimator(
                    canvas,
                    parsedPath,
                    influence,
                    vb
                );

                // Apply style config
                if (style?.gradient) {
                    animator.setGradient(style.gradient);
                } else if (style?.fill) {
                    animator.setFillColor(style.fill);
                }

                animatorRef.current = animator;
                animator.start();

                setIsLoading(false);
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : 'Unknown error');
                    setIsLoading(false);
                }
            }
        }

        init();

        return () => {
            cancelled = true;
            animatorRef.current?.stop();
        };
    }, [svgPath, anchorsData, width]);

    // Update params when they change
    useEffect(() => {
        const animator = animatorRef.current;
        if (!animator) return;

        animator.setParams({
            motionType: params.motionType,
            speed: params.speed,
            intensity: params.intensity,
            // Psychedelic params
            breathingAmount: params.breathingAmount,
            warpStrength: params.warpStrength,
            // Eldritch params
            writheSpeed: params.writheSpeed,
            writheIntensity: params.writheIntensity,
            coilTightness: params.coilTightness,
            // Noise params
            noiseScale: params.noiseScale,
            octaves: params.octaves,
            falloffRadius: params.falloffRadius,
        });
    }, [
        params.motionType,
        params.speed,
        params.intensity,
        params.breathingAmount,
        params.warpStrength,
        params.writheSpeed,
        params.writheIntensity,
        params.coilTightness,
        params.noiseScale,
        params.octaves,
        params.falloffRadius
    ]);

    // Recompute influence when falloff changes
    useEffect(() => {
        const animator = animatorRef.current;
        if (!animator) return;

        // Re-fetch and recompute influence
        (async () => {
            try {
                const response = await fetch(svgPath);
                const svgText = await response.text();
                const extracted = extractPathFromSvg(svgText);
                if (!extracted) return;

                const transformOffset = parseTransform(extracted.transform);
                const parsedPath = parsePath(extracted.d, transformOffset);
                const anchors = loadAnchors(anchorsData);

                const influence = computeInfluenceMap(
                    parsedPath.coords,
                    anchors,
                    params.falloffRadius,
                    transformOffset
                );

                animator.setInfluence(influence);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Error recomputing influence');
            }
        })();
    }, [params.falloffRadius, svgPath, anchorsData]);

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

    if (error) {
        return (
            <div style={{
                width,
                height,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#fee',
                color: '#c00',
                fontFamily: 'monospace',
                padding: 20,
            }}>
                Error: {error}
            </div>
        );
    }

    return (
        <div style={{ position: 'relative', width, height }}>
            <Leva hidden={!showControls} />
            <canvas
                ref={canvasRef}
                style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                }}
            />
            {isLoading && (
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(255,255,255,0.8)',
                    fontFamily: 'monospace',
                }}>
                    Loading...
                </div>
            )}
        </div>
    );
};
