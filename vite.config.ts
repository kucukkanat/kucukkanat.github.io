import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 900 },
  // allowedHosts: portless serves the dev server as kucukkanat.localhost and, in LAN mode, kucukkanat.local
  server: { port: 4380, host: true, allowedHosts: ['.localhost', '.local'] },
  plugins: [{
    // GitHub Pages serves /plain/ from public/plain/index.html, and likewise /writing/, /writing/<slug>/ and
    // /writing/topic/<id>/ (written by scripts/build-notes.ts); make the dev server do the same.
    name: 'plain-index',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [path, query] = (req.url ?? '').split('?');
        if (/^\/(plain|writing(\/topic)?(\/[a-z0-9-]+)?)\/?$/.test(path))
          req.url = path.replace(/\/?$/, '/index.html') + (query ? `?${query}` : '');
        next();
      });
    },
  }],
});
