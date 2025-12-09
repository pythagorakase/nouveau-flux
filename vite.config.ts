import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    const isLib = mode === 'lib'

    return {
        plugins: [
            react(),
            tailwindcss(),
            isLib && dts({
                include: ['src'],
                exclude: ['src/main.tsx', 'src/App.tsx'],
            }),
        ].filter(Boolean),
        resolve: {
            alias: {
                '@': resolve(__dirname, './src'),
            },
        },
        build: isLib ? {
            lib: {
                entry: resolve(__dirname, 'src/index.ts'),
                name: 'NouveauFlux',
                fileName: 'nouveau-flux',
            },
            rollupOptions: {
                external: ['react', 'react-dom', 'leva'],
                output: {
                    globals: {
                        react: 'React',
                        'react-dom': 'ReactDOM',
                        leva: 'leva',
                    },
                },
            },
        } : {},
    }
})
