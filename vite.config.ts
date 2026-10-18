import { existsSync, readFileSync, watch } from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** Dev-only stand-in for the CLI server: serves /data/<name>.json, /data/audio/<clip>.wav and a /events change stream. */
function mrCastData(dir: string): Plugin {
  return {
    name: 'mr-cast-data',
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const name = (req.url ?? '').split('?')[0]!.replace(/^\//, '');
        const isAudio = /^audio\/[0-9a-f]{8}\.wav$/.test(name);
        if (!isAudio && !/^[\w.-]+\.json$/.test(name)) return next();
        const file = path.join(dir, name);
        if (!existsSync(file)) {
          res.statusCode = 404;
          res.end(`${name} not found in ${dir}`);
          return;
        }
        res.setHeader('Content-Type', isAudio ? 'audio/wav' : 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(readFileSync(file));
      });
      server.middlewares.use('/events', (_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        const watcher = watch(dir, (_event, filename) => {
          if (filename?.endsWith('.json')) res.write(`event: change\ndata: ${JSON.stringify({ file: filename })}\n\n`);
        });
        res.on('close', () => watcher.close());
      });
    },
  };
}

const dataDir = path.resolve(process.env.MR_CAST_DATA_DIR ?? 'examples/demo');

export default defineConfig({
  base: './',
  // Data edits arrive through /events; letting Vite see them would reload the page and lose the frame.
  server: { watch: { ignored: [`${dataDir}/**`] } },
  plugins: [react(), tailwindcss(), mrCastData(dataDir)],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
