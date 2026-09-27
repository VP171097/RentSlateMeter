import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base: the app uses hash routes (#/m/<token>), so assets can load
// relative to wherever it is hosted (e.g. /RentSlateMeter/ on GitHub Pages)
// and a repo rename never breaks the site.
export default defineConfig({ plugins: [react()], base: './' });
