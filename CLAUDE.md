# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start development server (Vite)
npm run build     # TypeScript compile + Vite production build
npm run build:lib # Build as library for use in other projects
npm run preview   # Preview production build
```

## Architecture

This is a React + TypeScript + Vite + Tailwind application that renders an animated Art Nouveau SVG frame with a "psychedelic drift" effect using Canvas 2D.

### Animation Pipeline

1. **Path Parsing** (`src/lib/pathParser.ts`) - Converts SVG path `d` attributes into typed arrays, handling M/L/C/S/Q/H/V/Z commands with absolute coordinate conversion

2. **Anchor Influence** (`src/lib/anchorInfluence.ts`) - Anchor points (from `corners.json`) define pinned regions. Uses quintic smoothstep (`6t⁵ - 15t⁴ + 10t³`) to compute influence falloff: 0 at anchors (fixed), 1 far away (free to move)

3. **Noise Engine** (`src/lib/noiseEngine.ts`) - 3D Perlin noise with FBM (fractal Brownian motion). Key technique: **domain warping** - distorts input coordinates with noise before sampling to create organic flowing movement

4. **Frame Animator** (`src/lib/frameAnimator.ts`) - requestAnimationFrame loop running outside React, renders to Canvas via Path2D

### Key Components

- `App.tsx` - Main app layout with Navbar, Canvas viewport (with zoom/pan), and ControlPanel sidebar
- `AnimatedFrame.tsx` - Core canvas component, accepts `params` prop for animation control
- `ControlPanel.tsx` - shadcn/ui-based control panel for animation parameters and anchor management
- `Navbar.tsx` - Top navigation bar with File menu (Import SVG) and View menu (zoom controls)
- `AnchorPicker.tsx` - Development tool for creating anchor points in `corners.json` (uses Leva)

### UI Stack

- **Tailwind CSS v4** with `@tailwindcss/vite` plugin
- **shadcn/ui** components (Radix UI primitives)
- Custom control components: `SliderControl`, `NumberStepper`

## Library Usage

Build with `npm run build:lib` to create a distributable library. Use in another React project:

```tsx
import { AnimatedFrame } from 'nouveau-flux';
import { DEFAULT_PARAMS } from 'nouveau-flux/lib/frameAnimator';

function MyComponent() {
  const [params, setParams] = useState({ ...DEFAULT_PARAMS });

  return (
    <AnimatedFrame
      svgPath="/my-frame.svg"
      anchorsData={myAnchors}
      params={params}
      width={600}
      style={{
        fill: '#333',
        // or gradient:
        gradient: {
          type: 'linear',
          angle: 45,
          stops: [
            { offset: 0, color: '#ff0000' },
            { offset: 1, color: '#0000ff' }
          ]
        }
      }}
    />
  );
}
```

Peer dependencies: `react`, `react-dom`

Optional: `leva` (only needed if using `AnchorPicker` development tool)
