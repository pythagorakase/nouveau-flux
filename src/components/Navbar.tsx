import React, { useRef } from 'react';
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from '@/components/ui/menubar';

export interface NavbarProps {
  fileName: string;
  onImport: (file: File) => void;
  onExport?: () => void;
  onEditAnchors?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetView?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  fileName,
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

  return (
    <nav className="h-12 border-b flex items-center px-4 gap-4 bg-background">
      <span className="font-semibold text-sm">Nouveau Flux</span>

      <Menubar className="border-none shadow-none bg-transparent p-0 h-auto">
        <MenubarMenu>
          <MenubarTrigger className="text-sm">File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={handleImportClick}>
              Import SVG
              <MenubarShortcut>⌘O</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
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
          {fileName}
        </span>
      </div>

      {/* Hidden file input */}
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
