import React, { useState, useRef } from 'react';
import { AnimatedFrame } from './components/AnimatedFrame';
import anchorsData from '../corners.json';

function App() {
    const [svgPath, setSvgPath] = useState('/button_card_2.svg');
    const [svgName, setSvgName] = useState('button_card_2.svg');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Create a blob URL for the uploaded file
        const blobUrl = URL.createObjectURL(file);
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
