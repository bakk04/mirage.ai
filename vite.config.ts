import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json' with { type: 'json' };
import fs from 'node:fs';

// Plugin to strip MediaPipe's upstream broken sourceMappingURL comments
function mediapipeSourcemapFix(): Plugin {
  return {
    name: 'mediapipe-sourcemap-fix',
    enforce: 'pre',
    async load(id: string) {
      if (
        id.includes('@mediapipe/tasks-vision') &&
        (id.endsWith('.mjs') || id.endsWith('.js') || id.endsWith('.cjs'))
      ) {
        const filePath = id.split('?')[0];
        try {
          const code = await fs.promises.readFile(filePath, 'utf-8');
          return {
            code: code.replace(/\/\/# sourceMappingURL=vision_bundle_[a-z]+\.js\.map/g, ''),
            map: null,
          };
        } catch {
          return null;
        }
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [
    mediapipeSourcemapFix(),
    react(),
    tailwindcss(),
    crx({ manifest }),
  ],
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'esnext',
    emptyOutDir: true,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug'],
      },
      format: {
        comments: false,
      },
    },
    rollupOptions: {
      input: {
        popup: 'src/popup/index.html',
      },
      output: {
        manualChunks(id: string) {
          if (
            id.includes('node_modules/react') ||
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/framer-motion') ||
            id.includes('node_modules/lucide-react')
          ) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/@tensorflow')) {
            return 'vendor-tensorflow';
          }
          if (id.includes('node_modules/@mediapipe')) {
            return 'vendor-mediapipe';
          }
        },
      },
    },
    chunkSizeWarningLimit: 1500,
  },
});
