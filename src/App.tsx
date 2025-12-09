import React, { useState, useRef, useEffect } from 'react';
import { AnimatedFrame } from './components/AnimatedFrame';
import anchorsData from '../corners.json';

function App() {
    const [svgPath, setSvgPath] = useState('/button_card_2.svg');
    const [svgName, setSvgName] = useState('button_card_2.svg');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const prevBlobUrlRef = useRef<string | null>(null);

    // Clean up blob URLs to prevent memory leaks
    useEffect(() => {
        return () => {
            if (prevBlobUrlRef.current) {
                URL.revokeObjectURL(prevBlobUrlRef.current);
            }
        };
    }, []);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Revoke previous blob URL if it exists
        if (prevBlobUrlRef.current) {
            URL.revokeObjectURL(prevBlobUrlRef.current);
        }

        // Create a blob URL for the uploaded file
        const blobUrl = URL.createObjectURL(file);
        prevBlobUrlRef.current = blobUrl;
        setSvgPath(blobUrl);
        setSvgName(file.name);
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    return (
        <div style={{
            width: '100vw',
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f5f5f5',
            gap: 20,
        }}>
            {/* Import button */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
            }}>
                <button
                    onClick={handleImportClick}
                    style={{
                        padding: '8px 16px',
                        fontSize: 14,
                        fontWeight: 500,
                        background: '#333',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        cursor: 'pointer',
                    }}
                >
                    Import SVG
                </button>
                <span style={{
                    fontSize: 13,
                    color: '#666',
                    fontFamily: 'monospace',
                }}>
                    {svgName}
                </span>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".svg"
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                />
            </div>

            <AnimatedFrame
                svgPath={svgPath}
                anchorsData={anchorsData}
                width={600}
            />
        </div>
    );
}

export default App;
