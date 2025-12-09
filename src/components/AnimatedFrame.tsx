import React, { useRef, useEffect, useState } from 'react';
import { useControls, folder } from 'leva';
import { parsePath, extractPathFromSvg, parseTransform } from '../lib/pathParser';
import { computeInfluenceMap, loadAnchors, Anchor } from '../lib/anchorInfluence';
import { FrameAnimator, DEFAULT_PARAMS } from '../lib/frameAnimator';

interface AnimatedFrameProps {
    svgPath: string;
    anchorsData: Array<{ x: string; y: string; rectId?: number; corner?: string }>;
    width?: number;
}

export const AnimatedFrame: React.FC<AnimatedFrameProps> = ({
    svgPath,
    anchorsData,
    width = 600,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animatorRef = useRef<FrameAnimator | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [viewBox, setViewBox] = useState({ width: 215, height: 181 });

    // Leva controls for real-time parameter tweaking
    const params = useControls('Psychedelic Drift', {
        Motion: folder({
            speed: { value: DEFAULT_PARAMS.speed, min: 0, max: 1, step: 0.05 },
            intensity: { value: DEFAULT_PARAMS.intensity, min: 0, max: 15, step: 0.5 },
            breathingAmount: { value: DEFAULT_PARAMS.breathingAmount, min: 0, max: 2, step: 0.1 },
        }),
        Noise: folder({
            noiseScale: { value: DEFAULT_PARAMS.noiseScale, min: 0.001, max: 0.05, step: 0.001 },
            octaves: { value: DEFAULT_PARAMS.octaves, min: 1, max: 6, step: 1 },
            warpStrength: { value: DEFAULT_PARAMS.warpStrength, min: 0, max: 40, step: 1 },
        }),
        Anchors: folder({
            falloffRadius: { value: DEFAULT_PARAMS.falloffRadius, min: 5, max: 60, step: 1 },
            showAnchors: { value: false },
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

                // Store anchors and transform for debug drawing
                (animator as any)._anchors = anchors;
                (animator as any)._transformOffset = transformOffset;

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
            speed: params.speed,
            intensity: params.intensity,
            breathingAmount: params.breathingAmount,
            noiseScale: params.noiseScale,
            octaves: params.octaves,
            warpStrength: params.warpStrength,
            falloffRadius: params.falloffRadius,
        });
    }, [params.speed, params.intensity, params.breathingAmount, params.noiseScale, params.octaves, params.warpStrength, params.falloffRadius]);

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
                console.error('Error recomputing influence:', err);
            }
        })();
    }, [params.falloffRadius, svgPath, anchorsData]);

    // Draw anchors overlay when showAnchors is true
    useEffect(() => {
        const animator = animatorRef.current as any;
        if (!animator || !params.showAnchors) return;

        const anchors = animator._anchors;
        const transformOffset = animator._transformOffset;
        if (anchors && transformOffset) {
            // This will be drawn each frame by the animator
            // For now, just log that we want to show anchors
        }
    }, [params.showAnchors]);

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
