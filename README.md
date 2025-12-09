# Art Nouveau Psychedelic Frame

An animated Art Nouveau SVG frame with subtle "psychedelic drift" - organic, flowing movement reminiscent of visual distortion effects.

## How It Works

### Architecture

1. **Path Parsing** (`src/lib/pathParser.ts`)
   - Parses SVG path `d` attribute into typed arrays for efficient manipulation
   - Converts all coordinates to absolute, applying the SVG group transform offset
   - Handles M, L, C, S, Q, H, V, Z commands with proper relative/absolute tracking

2. **Anchor Influence** (`src/lib/anchorInfluence.ts`)
   - 16 anchor points define "pinned" regions that don't move
   - Computes distance from each path point to nearest anchor
   - Uses quintic smoothstep (`6t⁵ - 15t⁴ + 10t³`) for ultra-smooth falloff
   - Points at anchors: influence = 0 (fixed). Far from anchors: influence = 1 (free)

3. **Noise Engine** (`src/lib/noiseEngine.ts`)
   - 3D Perlin noise (x, y, time) for smooth temporal evolution
   - Fractal Brownian Motion (FBM) layers multiple octaves
   - **Domain warping**: Uses noise to distort input coordinates before sampling - this creates the organic "flowing/melting" quality

4. **Frame Animator** (`src/lib/frameAnimator.ts`)
   - Runs animation loop outside React (requestAnimationFrame)
   - Each frame: applies noise displacement scaled by anchor influence
   - Renders to Canvas 2D using Path2D for performance

### The Psychedelic Effect

The key to the organic movement is **domain warping**:

```
warpedCoords = originalCoords + noise(originalCoords) * warpStrength
finalDisplacement = noise(warpedCoords)
```

This creates swirling, flowing patterns instead of uniform jittering.

### Controls (Leva Panel)

- **speed**: Animation speed (keep low ~0.3 for hypnotic effect)
- **intensity**: Maximum displacement in SVG units
- **warpStrength**: Domain warping amount (higher = more flowing)
- **falloffRadius**: Distance from anchors where movement begins
- **octaves**: Noise detail layers

## Files

```
src/
├── lib/
│   ├── pathParser.ts      # SVG path → typed arrays
│   ├── anchorInfluence.ts # Distance field from 16 pins
│   ├── noiseEngine.ts     # Perlin + FBM + domain warping
│   └── frameAnimator.ts   # RAF loop, Canvas rendering
├── components/
│   └── AnimatedFrame.tsx  # React wrapper with Leva controls
└── App.tsx
```

## Anchor Points

Defined in `corners.json` - 16 points (4 rectangles × 4 corners) marking where the Art Nouveau curves should stay fixed. Created using the AnchorPicker tool.
