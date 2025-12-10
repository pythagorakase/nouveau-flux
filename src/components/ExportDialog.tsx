import React, { useState, useCallback } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    GifExportOptions,
    GifExportProgress,
    encodeGif,
    downloadBlob,
    DEFAULT_EXPORT_OPTIONS,
} from '@/lib/gifExporter';
import { AnimationParams } from '@/lib/frameAnimator';

interface ExportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    getCanvas: () => HTMLCanvasElement | null;
    renderAtTime: (time: number) => void;
    setLoopPeriod: (seconds: number) => void;
    getLoopPeriod: () => number;
    params: AnimationParams;
    projectName?: string;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({
    open,
    onOpenChange,
    getCanvas,
    renderAtTime,
    setLoopPeriod,
    getLoopPeriod,
    params,
    projectName,
}) => {
    const [options, setOptions] = useState<GifExportOptions>({
        ...DEFAULT_EXPORT_OPTIONS,
    });
    const [isExporting, setIsExporting] = useState(false);
    const [progress, setProgress] = useState<GifExportProgress | null>(null);

    const handleExport = useCallback(async () => {
        const mainCanvas = getCanvas();
        if (!mainCanvas) {
            console.error('No canvas available for export');
            return;
        }

        const previousLoopPeriod = getLoopPeriod();
        const speed = params.speed ?? 1;
        const loopSpan = speed > 0 ? options.loopDuration * speed : 0;
        setLoopPeriod(loopSpan);

        setIsExporting(true);
        setProgress({ phase: 'capturing', percent: 0 });

        try {
            // Get the actual canvas dimensions (includes DPR scaling)
            const mainWidth = mainCanvas.width;
            const mainHeight = mainCanvas.height;

            // Calculate aspect ratio from main canvas
            const aspectRatio = mainHeight / mainWidth;

            // Export dimensions based on desired width
            const exportWidth = options.width;
            const exportHeight = Math.round(options.width * aspectRatio);

            // Resolve a non-transparent background so GIF encoding doesn't turn alpha into black
            const backgroundColor =
                getComputedStyle(mainCanvas.closest('main') || document.body).backgroundColor ||
                '#ffffff';

            // Create export canvas at target resolution
            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = exportWidth;
            exportCanvas.height = exportHeight;
            const exportCtx = exportCanvas.getContext('2d');
            if (!exportCtx) throw new Error('Could not create export context');

            // Custom frame capture that scales from main canvas
            const captureFrame = (time: number): ImageData => {
                // Render the frame at this time
                renderAtTime(time);

                // Paint background then copy and scale from main canvas to export canvas
                exportCtx.fillStyle = backgroundColor;
                exportCtx.fillRect(0, 0, exportWidth, exportHeight);
                exportCtx.drawImage(mainCanvas, 0, 0, exportWidth, exportHeight);

                // Return the image data
                return exportCtx.getImageData(0, 0, exportWidth, exportHeight);
            };

            // Capture all frames
            const totalFrames = Math.ceil(options.loopDuration * options.fps);
            const frames: ImageData[] = [];

            for (let i = 0; i < totalFrames; i++) {
                const time = loopSpan > 0 ? (i / totalFrames) * loopSpan : 0;
                frames.push(captureFrame(time));

                setProgress({
                    phase: 'capturing',
                    percent: (i / totalFrames) * 50,
                    currentFrame: i + 1,
                    totalFrames,
                });

                // Yield to UI
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            // Encode frames to GIF
            const blob = await encodeGif(
                frames,
                { ...options, width: exportWidth, height: exportHeight },
                setProgress
            );

            const filename = `${projectName || 'nouveau-flux'}_${options.loopDuration}s_${options.fps}fps.gif`;
            downloadBlob(blob, filename);

            onOpenChange(false);
        } catch (err) {
            console.error('Export failed:', err);
        } finally {
            setIsExporting(false);
            setProgress(null);
            setLoopPeriod(previousLoopPeriod);
        }
    }, [getCanvas, renderAtTime, setLoopPeriod, getLoopPeriod, options, projectName, onOpenChange]);

    const progressText = progress
        ? progress.phase === 'capturing'
            ? `Capturing frame ${progress.currentFrame}/${progress.totalFrames}...`
            : progress.phase === 'encoding'
                ? `Encoding frame ${progress.currentFrame}/${progress.totalFrames}...`
                : 'Complete!'
        : '';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Export GIF</DialogTitle>
                    <DialogDescription>
                        Export a seamless looping GIF of the animation.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {/* Loop Duration */}
                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <Label>Loop Duration</Label>
                            <span className="text-sm text-muted-foreground">
                                {options.loopDuration}s
                            </span>
                        </div>
                        <Slider
                            value={[options.loopDuration]}
                            min={1}
                            max={10}
                            step={0.5}
                            onValueChange={([v]) => setOptions(o => ({ ...o, loopDuration: v }))}
                            disabled={isExporting}
                        />
                    </div>

                    {/* FPS */}
                    <div className="space-y-2">
                        <Label>Frame Rate</Label>
                        <Select
                            value={String(options.fps)}
                            onValueChange={(v) => setOptions(o => ({ ...o, fps: Number(v) }))}
                            disabled={isExporting}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="10">10 fps (small file)</SelectItem>
                                <SelectItem value="15">15 fps (balanced)</SelectItem>
                                <SelectItem value="24">24 fps (smooth)</SelectItem>
                                <SelectItem value="30">30 fps (very smooth)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Resolution */}
                    <div className="space-y-2">
                        <Label>Resolution</Label>
                        <Select
                            value={String(options.width)}
                            onValueChange={(v) => setOptions(o => ({ ...o, width: Number(v) }))}
                            disabled={isExporting}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="200">200px (tiny)</SelectItem>
                                <SelectItem value="300">300px (small)</SelectItem>
                                <SelectItem value="400">400px (medium)</SelectItem>
                                <SelectItem value="600">600px (large)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Estimated frames */}
                    <div className="text-sm text-muted-foreground">
                        Total frames: {Math.ceil(options.loopDuration * options.fps)}
                    </div>

                    {/* Progress */}
                    {isExporting && progress && (
                        <div className="space-y-2">
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-primary transition-all duration-150"
                                    style={{ width: `${progress.percent}%` }}
                                />
                            </div>
                            <p className="text-sm text-muted-foreground">{progressText}</p>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isExporting}
                    >
                        Cancel
                    </Button>
                    <Button onClick={handleExport} disabled={isExporting}>
                        {isExporting ? 'Exporting...' : 'Export GIF'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
