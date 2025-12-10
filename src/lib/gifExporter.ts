/**
 * GIF Exporter - exports seamless looping GIFs from the animation
 *
 * Uses gifenc for encoding and 4D circular noise for seamless loops.
 */

import { GIFEncoder, quantize, applyPalette } from 'gifenc';

export interface GifExportOptions {
    width: number;
    height: number;
    fps: number;           // Frames per second (10, 15, 24, 30)
    loopDuration: number;  // Loop duration in seconds
    quality: number;       // 1-30, lower = better quality, slower
}

export interface GifExportProgress {
    phase: 'capturing' | 'encoding' | 'complete';
    percent: number;
    currentFrame?: number;
    totalFrames?: number;
}

/**
 * Captures frames from a canvas at specified times
 */
export async function captureFrames(
    canvas: HTMLCanvasElement,
    renderAtTime: (time: number) => void,
    options: GifExportOptions,
    onProgress?: (progress: GifExportProgress) => void
): Promise<ImageData[]> {
    const { fps, loopDuration } = options;
    const totalFrames = Math.ceil(loopDuration * fps);
    const frames: ImageData[] = [];

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2d context');

    for (let i = 0; i < totalFrames; i++) {
        const time = (i / totalFrames) * loopDuration;

        // Render the frame at this time
        renderAtTime(time);

        // Capture the frame
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        frames.push(imageData);

        onProgress?.({
            phase: 'capturing',
            percent: (i / totalFrames) * 50, // 0-50% for capture
            currentFrame: i + 1,
            totalFrames,
        });

        // Yield to prevent blocking UI
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    return frames;
}

/**
 * Encodes captured frames into a GIF blob
 */
export async function encodeGif(
    frames: ImageData[],
    options: GifExportOptions,
    onProgress?: (progress: GifExportProgress) => void
): Promise<Blob> {
    const { width, height, fps } = options;
    const delay = Math.round(1000 / fps); // ms per frame

    const gif = GIFEncoder();

    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];

        // Quantize to 256 colors
        const palette = quantize(frame.data, 256);
        const indexed = applyPalette(frame.data, palette);

        // Write frame
        gif.writeFrame(indexed, width, height, {
            palette,
            delay,
        });

        onProgress?.({
            phase: 'encoding',
            percent: 50 + (i / frames.length) * 50, // 50-100% for encoding
            currentFrame: i + 1,
            totalFrames: frames.length,
        });

        // Yield to prevent blocking UI
        if (i % 5 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    gif.finish();

    onProgress?.({
        phase: 'complete',
        percent: 100,
    });

    return new Blob([gif.bytes()], { type: 'image/gif' });
}

/**
 * Main export function - captures and encodes in one call
 */
export async function exportGif(
    canvas: HTMLCanvasElement,
    renderAtTime: (time: number) => void,
    options: GifExportOptions,
    onProgress?: (progress: GifExportProgress) => void
): Promise<Blob> {
    // Validate options
    if (options.width <= 0 || options.height <= 0) {
        throw new Error('Invalid dimensions');
    }
    if (options.fps < 1 || options.fps > 60) {
        throw new Error('FPS must be between 1 and 60');
    }
    if (options.loopDuration <= 0 || options.loopDuration > 30) {
        throw new Error('Loop duration must be between 0 and 30 seconds');
    }

    // Capture frames
    const frames = await captureFrames(canvas, renderAtTime, options, onProgress);

    // Encode to GIF
    const blob = await encodeGif(frames, options, onProgress);

    return blob;
}

/**
 * Trigger download of a blob as a file
 */
export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Default export options
 */
export const DEFAULT_EXPORT_OPTIONS: GifExportOptions = {
    width: 400,
    height: 336, // Maintains aspect ratio for default frame
    fps: 15,
    loopDuration: 3,
    quality: 10,
};
