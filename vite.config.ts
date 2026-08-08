import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const entry = (name: string) => fileURLToPath(new URL(name, import.meta.url));

// Three entry points, three separate pages. The stage and the remote never run
// in the same tab, so bundling them together would ship the shader to a phone
// that only ever draws buttons.
export default defineConfig({
  server: { port: 5199, host: true },
  preview: { port: 5199 },
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        landing: entry('index.html'),
        stage: entry('stage.html'),
        remote: entry('remote.html'),
      },
    },
  },
});
