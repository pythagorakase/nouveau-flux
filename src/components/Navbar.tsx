import React, { useRef } from 'react';
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from '@/components/ui/menubar';
import { RecentProject } from '@/lib/projectManager';

export interface NavbarProps {
  fileName: string;
  projectName: string | null;
  isDirty: boolean;
  recentProjects: RecentProject[];
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onClearRecent: () => void;
  onImport: (file: File) => void;
  onExport?: () => void;
  onEditAnchors?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetView?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  fileName,
  projectName,
  isDirty,
  recentProjects,
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onClearRecent,
  onImport,
  onExport,
  onEditAnchors,
  onZoomIn,
  onZoomOut,
  onResetView,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImport(file);
      // Reset input so same file can be selected again
      e.target.value = '';
    }
  };

  // Display title with dirty indicator
  const displayTitle = projectName
    ? `${projectName}${isDirty ? ' *' : ''}`
    : isDirty
      ? 'Untitled *'
      : fileName;

  return (
    <nav className="h-12 border-b flex items-center px-4 gap-4 bg-background">
      <span className="font-semibold text-sm">Nouveau Flux</span>

      <Menubar className="border-none shadow-none bg-transparent p-0 h-auto">
        <MenubarMenu>
          <MenubarTrigger className="text-sm">File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={onNew}>
              New
              <MenubarShortcut>⌘N</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={onOpen}>
              Open...
              <MenubarShortcut>⌘O</MenubarShortcut>
            </MenubarItem>

            {/* Recent Projects Submenu */}
            <MenubarSub>
              <MenubarSubTrigger>Open Recent</MenubarSubTrigger>
              <MenubarSubContent>
                {recentProjects.length === 0 ? (
                  <MenubarItem disabled>No recent projects</MenubarItem>
                ) : (
                  <>
                    {recentProjects.map((project) => (
                      <MenubarItem
                        key={project.name}
                        disabled
                        title={`Last modified: ${new Date(project.modified).toLocaleString()}\n(Use File > Open to reload)`}
                      >
                        <span className="text-muted-foreground">{project.name}.nflux</span>
                      </MenubarItem>
                    ))}
                    <MenubarSeparator />
                    <MenubarItem disabled className="text-xs text-muted-foreground">
                      Use File → Open to reload projects
                    </MenubarItem>
                    <MenubarSeparator />
                    <MenubarItem onClick={onClearRecent}>
                      Clear Recent
                    </MenubarItem>
                  </>
                )}
              </MenubarSubContent>
            </MenubarSub>

            <MenubarSeparator />

            <MenubarItem onClick={onSave}>
              Save
              <MenubarShortcut>⌘S</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={onSaveAs}>
              Save As...
              <MenubarShortcut>⇧⌘S</MenubarShortcut>
            </MenubarItem>

            <MenubarSeparator />

            <MenubarItem onClick={handleImportClick}>
              Import SVG...
            </MenubarItem>
            <MenubarItem onClick={onExport} disabled={!onExport}>
              Export GIF
              <MenubarShortcut>⌘E</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="text-sm">Edit</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={onEditAnchors}>
              Anchors & Stretch Zones
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="text-sm">View</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={onZoomIn}>
              Zoom In
              <MenubarShortcut>⌘+</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={onZoomOut}>
              Zoom Out
              <MenubarShortcut>⌘-</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={onResetView}>
              Reset View
              <MenubarShortcut>⌘0</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-sm text-muted-foreground font-mono">
          {displayTitle}
        </span>
      </div>

      {/* Hidden file input for Import SVG */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".svg"
        onChange={handleFileChange}
        className="hidden"
      />
    </nav>
  );
};
