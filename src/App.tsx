import React from 'react';
import { AnimatedFrame } from './components/AnimatedFrame';
import anchorsData from '../corners.json';

function App() {
    return (
        <div style={{
            width: '100vw',
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f5f5f5',
        }}>
            <AnimatedFrame
                svgPath="/button_card_2.svg"
                anchorsData={anchorsData}
                width={600}
            />
        </div>
    );
}

export default App;
