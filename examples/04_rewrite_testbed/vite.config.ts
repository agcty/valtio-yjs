import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['yjs'],
    dedupe: ['yjs'],
  },
  resolve: {
    dedupe: ['yjs'],
  },
});
