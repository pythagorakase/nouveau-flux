# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start development server (Vite)
npm run build    # TypeScript compile + Vite production build
npm run preview  # Preview production build
```

## Architecture

This is a React + TypeScript + Vite application that renders an animated Art Nouveau SVG frame with a "psychedelic drift" effect using Canvas 2D.

### Animation Pipeline

1. **Path Parsing** (`src/lib/pathParser.ts`) - Converts SVG path `d` attributes into typed arrays, handling M/L/C/S/Q/H/V/Z commands with absolute coordinate conversion

2. **Anchor Influence** (`src/lib/anchorInfluence.ts`) - 16 anchor points (from `corners.json`) define pinned regions. Uses quintic smoothstep (`6t⁵ - 15t⁴ + 10t³`) to compute influence falloff: 0 at anchors (fixed), 1 far away (free to move)

3. **Noise Engine** (`src/lib/noiseEngine.ts`) - 3D Perlin noise with FBM (fractal Brownian motion). Key technique: **domain warping** - distorts input coordinates with noise before sampling to create organic flowing movement

4. **Frame Animator** (`src/lib/frameAnimator.ts`) - requestAnimationFrame loop running outside React, renders to Canvas via Path2D

### Key Components

- `AnimatedFrame.tsx` - React wrapper with Leva controls panel for tweaking animation parameters (speed, intensity, warpStrength, falloffRadius, octaves)
- `AnchorPicker.tsx` - Development tool for creating anchor points in `corners.json`
