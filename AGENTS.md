# Repository Guidelines

## Project Structure & Module Organization
- React + TypeScript Vite app; entry flows from `src/main.tsx` into `src/App.tsx`.
- Animation engine lives in `src/lib` (`frameAnimator`, `noiseEngine`, `anchorInfluence`, `pathParser`); project import/export lives in `projectManager.ts`.
- UI is in `src/components`, with Radix/Tailwind primitives under `components/ui` and default assets in `public/button_card_2.svg` plus anchor layout from `corners.json`.

## Build, Test, and Development Commands
- `npm install` — install dependencies (stick to npm to match `package-lock.json`).
- `npm run dev` — start the Vite dev server with hot reload.
- `npm run build` — run `tsc` then Vite build; use before PRs to catch type/bundle issues.
- `npm run build:lib` — emit ESM + UMD bundles and `.d.ts` types to `dist` for library consumers.
- `npm run preview` — serve the production build for smoke-testing.

## Coding Style & Naming Conventions
- TypeScript + React functional components; keep existing 4-space indentation and alias imports (`@/...` maps to `src`).
- Name animation parameters descriptively (`loopPeriod`, `warpStrength`, `falloffRadius`) and keep pure helpers in `src/lib`.
- Use Tailwind tokens defined in `src/index.css`; avoid hardcoded colors and prefer shared theme variables.
- Place side effects in `useEffect` with proper cleanup (fetch abort/RAF cancel) to prevent leaks noted in TODO.
- When adding UI pieces, first check https://ui.shadcn.com/ for a matching component and install/adapt the Shadcn version rather than creating bespoke primitives.

## Testing Guidelines
- No automated test suite yet; at minimum run `npm run build` for type checks.
- For new lib utilities, add light Vitest coverage or REPL-style examples in `src/lib/utils.ts`.
- Manually verify anchor editing, zoom/pan, and GIF export in `npm run dev`, especially around new SVG assets.

## Commit & Pull Request Guidelines
- Follow Conventional Commits already used (`feat: ...`, `fix: ...`); imperative mood, ≤72-char subject.
- PRs should include a brief behavior summary, affected areas, before/after GIF or screenshot of the frame, and linked issue/TODO if applicable.
- Call out any new assets (SVGs, JSON configs) and update defaults in `App.tsx`/`corners.json` when changing the frame source.

## Security & Configuration Tips
- Keep SVG assets in `public/` to leverage Vite static serving; sanitize user-loaded SVGs via `projectManager` helpers.
- Avoid committing large binaries; prefer generated output in `dist/` or user downloads.
