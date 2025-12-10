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
    exportGif,
    downloadBlob,
    DEFAULT_EXPORT_OPTIONS,
} from '@/lib/gifExporter';

interface ExportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    getCanvas: () => HTMLCanvasElement | null;
    renderAtTime: (time: number) => void;
    projectName?: string;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({
    open,
    onOpenChange,
    getCanvas,
    renderAtTime,
    projectName,
}) => {
    const [options, setOptions] = useState<GifExportOptions>({
        ...DEFAULT_EXPORT_OPTIONS,
    });
    const [isExporting, setIsExporting] = useState(false);
    const [progress, setProgress] = useState<GifExportProgress | null>(null);

    const handleExport = useCallback(async () => {
        const canvas = getCanvas();
        if (!canvas) {
            console.error('No canvas available for export');
            return;
        }

        setIsExporting(true);
        setProgress({ phase: 'capturing', percent: 0 });

        try {
            // Calculate export dimensions based on scale
            const scale = options.width / canvas.width;
            const exportWidth = Math.round(canvas.width * scale);
            const exportHeight = Math.round(canvas.height * scale);

            // Create offscreen canvas for export
            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = exportWidth;
            exportCanvas.height = exportHeight;
            const exportCtx = exportCanvas.getContext('2d');
            if (!exportCtx) throw new Error('Could not create export context');

            // Wrapper that renders to export canvas at specified time
            const renderForExport = (time: number) => {
                renderAtTime(time);
                // Scale down the main canvas to export canvas
                exportCtx.clearRect(0, 0, exportWidth, exportHeight);
                exportCtx.drawImage(canvas, 0, 0, exportWidth, exportHeight);
            };

            const blob = await exportGif(
                exportCanvas,
                renderForExport,
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
        }
    }, [getCanvas, renderAtTime, options, projectName, onOpenChange]);

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
