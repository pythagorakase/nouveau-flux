import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { AnimatedFrame } from './components/AnimatedFrame';
import { Navbar } from './components/Navbar';
import { ControlPanel } from './components/ControlPanel';
import { AnchorEditor } from './components/AnchorEditor';
import { AnimationParams, DEFAULT_PARAMS } from './lib/frameAnimator';
import { AnchorData } from './lib/anchorInfluence';
import { StretchConfig, createDefaultStretchConfig } from './lib/stretchZone';
import {
    NfluxProject,
    RecentProject,
    createProject,
    parseProject,
    downloadProject,
    openProjectFile,
    createSvgBlobUrl,
    decodeSvg,
    getRecentProjects,
    addRecentProject,
    clearRecentProjects,
    ProjectError,
    sanitizeProjectName,
    validateProjectName,
} from './lib/projectManager';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Toaster, toast } from 'sonner';
import defaultAnchorsData from '../corners.json';

// Default viewBox dimensions for positioning new anchors
const DEFAULT_VB = { width: 215, height: 181 };

// Default SVG path for new projects
const DEFAULT_SVG_PATH = '/button_card_2.svg';
const DEFAULT_SVG_NAME = 'button_card_2.svg';

const createDefaultAnchorsState = (): AnchorData[] =>
    defaultAnchorsData.map(a => ({
        ...a,
        type: 'rect' as const,
        groupId: a.rectId ?? 0,
    }));

function App() {
    // Core state
    const [svgPath, setSvgPath] = useState(DEFAULT_SVG_PATH);
    const [svgName, setSvgName] = useState(DEFAULT_SVG_NAME);
    const [params, setParams] = useState<AnimationParams>({ ...DEFAULT_PARAMS });
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isEditingAnchors, setIsEditingAnchors] = useState(false);
    const [showAnchors, setShowAnchors] = useState(false);
    const [stretchConfig, setStretchConfig] = useState<StretchConfig>(() =>
        createDefaultStretchConfig(DEFAULT_VB.width, DEFAULT_VB.height)
    );

    // Project state
    const [projectName, setProjectName] = useState<string | null>(null);
    const [svgContent, setSvgContent] = useState<string | null>(null);
    const [lastSavedState, setLastSavedState] = useState<string | null>(null);
    const [recentProjects, setRecentProjects] = useState<RecentProject[]>(() => getRecentProjects());

    // Dialog state
    const [showDiscardDialog, setShowDiscardDialog] = useState(false);
    const [showSaveAsDialog, setShowSaveAsDialog] = useState(false);
    const [saveAsName, setSaveAsName] = useState('');
    const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

    const prevBlobUrlRef = useRef<string | null>(null);

    // Full anchor state (not just counts)
    const [anchors, setAnchors] = useState<AnchorData[]>(() => {
        // Initialize from corners.json with type metadata
        return createDefaultAnchorsState();
    });

    const defaultStateSnapshot = useMemo(
        () =>
            JSON.stringify({
                params: { ...DEFAULT_PARAMS },
                anchors: createDefaultAnchorsState(),
                stretchConfig: createDefaultStretchConfig(DEFAULT_VB.width, DEFAULT_VB.height),
                zoom: 1,
                pan: { x: 0, y: 0 },
                svgContent: null,
                svgName: DEFAULT_SVG_NAME,
            }),
        []
    );

    // Create state snapshot for dirty tracking
    const createStateSnapshot = useCallback(() => {
        return JSON.stringify({
            params,
            anchors,
            stretchConfig,
            zoom,
            pan,
            svgContent,
            svgName,
        });
    }, [params, anchors, stretchConfig, zoom, pan, svgContent, svgName]);

    // Compute dirty state
    const isDirty = useMemo(() => {
        const snapshot = createStateSnapshot();
        if (!lastSavedState) {
            // Compare against pristine defaults before first save
            return snapshot !== defaultStateSnapshot;
        }
        return snapshot !== lastSavedState;
    }, [createStateSnapshot, lastSavedState, defaultStateSnapshot]);

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

    // --- Project Handlers ---

    const resetToDefaults = useCallback(() => {
        // Clean up previous blob URL
        if (prevBlobUrlRef.current) {
            URL.revokeObjectURL(prevBlobUrlRef.current);
            prevBlobUrlRef.current = null;
        }

        setSvgPath(DEFAULT_SVG_PATH);
        setSvgName(DEFAULT_SVG_NAME);
        setSvgContent(null);
        setParams({ ...DEFAULT_PARAMS });
        setAnchors(createDefaultAnchorsState());
        setStretchConfig(createDefaultStretchConfig(DEFAULT_VB.width, DEFAULT_VB.height));
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setProjectName(null);
        setLastSavedState(null);
    }, []);

    const handleNewProject = useCallback(() => {
        if (isDirty) {
            setPendingAction(() => resetToDefaults);
            setShowDiscardDialog(true);
        } else {
            resetToDefaults();
        }
    }, [isDirty, resetToDefaults]);

    const applyProject = useCallback((project: NfluxProject) => {
        // Clean up previous blob URL
        if (prevBlobUrlRef.current) {
            URL.revokeObjectURL(prevBlobUrlRef.current);
            prevBlobUrlRef.current = null;
        }

        // Decode SVG and create blob URL with cleanup on error
        const svgText = decodeSvg(project.svg.data);
        let blobUrl: string | null = null;
        try {
            blobUrl = createSvgBlobUrl(project.svg.data);
            prevBlobUrlRef.current = blobUrl;

            // Apply all state
            setSvgPath(blobUrl);
            setSvgName(project.svg.name);
            setSvgContent(svgText);
            setParams(project.animationParams);
            setAnchors(project.anchors);
            setStretchConfig(project.stretchConfig);
            setZoom(project.viewState.zoom);
            setPan(project.viewState.pan);
            setProjectName(project.name);

            // Mark as clean - use project values directly (no setTimeout needed)
            setLastSavedState(JSON.stringify({
                params: project.animationParams,
                anchors: project.anchors,
                stretchConfig: project.stretchConfig,
                zoom: project.viewState.zoom,
                pan: project.viewState.pan,
                svgContent: svgText,
                svgName: project.svg.name,
            }));

            // Add to recent
            const recent: RecentProject = {
                name: project.name,
                modified: project.modified,
            };
            addRecentProject(recent);
            setRecentProjects(getRecentProjects());

            toast.success(`Opened "${project.name}"`);
        } catch (err) {
            // Clean up blob URL if state application fails
            if (blobUrl && prevBlobUrlRef.current !== blobUrl) {
                URL.revokeObjectURL(blobUrl);
            }
            throw err;
        }
    }, []);

    const handleOpenProject = useCallback(async () => {
        const doOpen = async () => {
            try {
                const project = await openProjectFile();
                applyProject(project);
            } catch (err) {
                if (err instanceof ProjectError) {
                    toast.error(`Failed to open project: ${err.message}`);
                }
                // User cancelled - ignore
            }
        };

        if (isDirty) {
            setPendingAction(() => doOpen);
            setShowDiscardDialog(true);
        } else {
            doOpen();
        }
    }, [isDirty, applyProject]);

    const handleSaveProject = useCallback(async () => {
        // Need SVG content - fetch if not cached
        let content = svgContent;
        if (!content) {
            try {
                const response = await fetch(svgPath);
                content = await response.text();
                setSvgContent(content);
            } catch {
                toast.error('Failed to read SVG content');
                return;
            }
        }

        // If no project name, prompt for one
        if (!projectName) {
            setSaveAsName('Untitled Project');
            setShowSaveAsDialog(true);
            return;
        }

        const project = createProject(
            projectName,
            svgName,
            content,
            params,
            anchors,
            stretchConfig,
            { zoom, pan }
        );

        downloadProject(project);
        setLastSavedState(createStateSnapshot());

        // Update recent projects
        addRecentProject({
            name: projectName,
            modified: new Date().toISOString(),
        });
        setRecentProjects(getRecentProjects());

        toast.success(`Saved "${projectName}.nflux"`);
    }, [svgContent, svgPath, projectName, svgName, params, anchors, stretchConfig, zoom, pan, createStateSnapshot]);

    const handleSaveAsProject = useCallback(() => {
        setSaveAsName(projectName || 'Untitled Project');
        setShowSaveAsDialog(true);
    }, [projectName]);

    const handleSaveAsConfirm = useCallback(async () => {
        if (!saveAsName.trim()) return;

        // Validate project name
        const validationError = validateProjectName(saveAsName);
        if (validationError) {
            toast.error(validationError);
            return;
        }

        // Need SVG content
        let content = svgContent;
        if (!content) {
            try {
                const response = await fetch(svgPath);
                content = await response.text();
                setSvgContent(content);
            } catch {
                toast.error('Failed to read SVG content');
                return;
            }
        }

        // Sanitize the name for safe filename usage
        const name = sanitizeProjectName(saveAsName);
        setProjectName(name);

        const project = createProject(
            name,
            svgName,
            content,
            params,
            anchors,
            stretchConfig,
            { zoom, pan }
        );

        downloadProject(project);

        // Update state snapshot with saved values directly
        setLastSavedState(JSON.stringify({
            params,
            anchors,
            stretchConfig,
            zoom,
            pan,
            svgContent: content,
            svgName,
        }));

        // Update recent projects
        addRecentProject({
            name,
            modified: new Date().toISOString(),
        });
        setRecentProjects(getRecentProjects());

        setShowSaveAsDialog(false);
        toast.success(`Saved "${name}.nflux"`);
    }, [saveAsName, svgContent, svgPath, svgName, params, anchors, stretchConfig, zoom, pan]);

    const handleClearRecent = useCallback(() => {
        clearRecentProjects();
        setRecentProjects([]);
    }, []);

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

    // Import SVG handler (updated to track content)
    const handleImport = useCallback((file: File) => {
        const doImport = async () => {
            // Revoke previous blob URL if it exists
            if (prevBlobUrlRef.current) {
                URL.revokeObjectURL(prevBlobUrlRef.current);
                prevBlobUrlRef.current = null;
            }

            // Read file content for project embedding
            const content = await file.text();

            // Create a blob URL with cleanup on error
            let blobUrl: string | null = null;
            try {
                blobUrl = URL.createObjectURL(file);
                prevBlobUrlRef.current = blobUrl;

                setSvgPath(blobUrl);
                setSvgName(file.name);
                setSvgContent(content);

                // Reset project metadata (new unsaved project)
                setProjectName(null);
                setLastSavedState(null);

                toast.success(`Imported "${file.name}"`);
            } catch (err) {
                // Clean up blob URL if state application fails
                if (blobUrl && prevBlobUrlRef.current !== blobUrl) {
                    URL.revokeObjectURL(blobUrl);
                }
                toast.error('Failed to import SVG');
            }
        };

        if (isDirty) {
            setPendingAction(() => () => doImport());
            setShowDiscardDialog(true);
        } else {
            doImport();
        }
    }, [isDirty]);

    // Clean up blob URLs to prevent memory leaks
    useEffect(() => {
        return () => {
            if (prevBlobUrlRef.current) {
                URL.revokeObjectURL(prevBlobUrlRef.current);
            }
        };
    }, []);

    // beforeunload warning for unsaved changes
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isDirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isDirty]);

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

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
            const modKey = isMac ? e.metaKey : e.ctrlKey;

            if (modKey && e.key === 'n') {
                e.preventDefault();
                handleNewProject();
            } else if (modKey && e.key === 'o' && !e.shiftKey) {
                e.preventDefault();
                handleOpenProject();
            } else if (modKey && e.key === 's') {
                e.preventDefault();
                if (e.shiftKey) {
                    handleSaveAsProject();
                } else {
                    handleSaveProject();
                }
            } else if (modKey && (e.key === '=' || e.key === '+')) {
                // ⌘+ Zoom In (= key is + without shift on most keyboards)
                e.preventDefault();
                handleZoomIn();
            } else if (modKey && e.key === '-') {
                // ⌘- Zoom Out
                e.preventDefault();
                handleZoomOut();
            } else if (modKey && e.key === '0') {
                // ⌘0 Reset View
                e.preventDefault();
                handleResetView();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleNewProject, handleOpenProject, handleSaveProject, handleSaveAsProject, handleZoomIn, handleZoomOut, handleResetView]);

    return (
        <>
            <Toaster position="bottom-right" />

            <div className="h-screen flex flex-col">
                <Navbar
                    fileName={svgName}
                    projectName={projectName}
                    isDirty={isDirty}
                    recentProjects={recentProjects}
                    onNew={handleNewProject}
                    onOpen={handleOpenProject}
                    onSave={handleSaveProject}
                    onSaveAs={handleSaveAsProject}
                    onClearRecent={handleClearRecent}
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

            {/* Discard Changes Dialog */}
            <AlertDialog open={showDiscardDialog} onOpenChange={setShowDiscardDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
                        <AlertDialogDescription>
                            You have unsaved changes that will be lost. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setPendingAction(null)}>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (pendingAction) {
                                    pendingAction();
                                    setPendingAction(null);
                                }
                                setShowDiscardDialog(false);
                            }}
                        >
                            Discard
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Save As Dialog */}
            <Dialog open={showSaveAsDialog} onOpenChange={setShowSaveAsDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Save Project As</DialogTitle>
                        <DialogDescription>
                            Enter a name for your project. It will be saved as a .nflux file.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <Label htmlFor="project-name">Project Name</Label>
                        <Input
                            id="project-name"
                            value={saveAsName}
                            onChange={(e) => setSaveAsName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    handleSaveAsConfirm();
                                }
                            }}
                            placeholder="My Project"
                            className="mt-2"
                            autoFocus
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowSaveAsDialog(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleSaveAsConfirm} disabled={!saveAsName.trim()}>
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

export default App;
