# Deploying to kucukkanat.com

1. Create (or reuse) the GitHub repo and push `main`. Recommended: a new repo with this folder as its root.
2. Repo → Settings → Pages → Source: **GitHub Actions**. The workflow in `.github/workflows/pages.yml` builds with Bun and publishes `dist/`.
3. Settings → Pages → Custom domain: `kucukkanat.com` (the build also writes `dist/CNAME`). Tick **Enforce HTTPS** once the certificate is issued.
4. Cloudflare DNS for `kucukkanat.com`:
   - `CNAME  @    kucukkanat.github.io` (Cloudflare flattens it at the apex), or the four GitHub A records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `CNAME  www  kucukkanat.github.io`
   - Proxy: **DNS only** (grey cloud) until GitHub has issued the certificate; after that orange cloud works with SSL mode **Full**.
5. If `kucukkanat.github.io` (the user-site repo) also has a custom domain set, remove it there first — a domain can only belong to one Pages site.
6. Caching (orange cloud on). GitHub Pages sends `Cache-Control: max-age=600` for everything, so add two Cloudflare **Cache Rules** (Caching → Cache Rules → Create rule):
   - **Hashed assets, cache for a year.** When: `starts_with(http.request.uri.path, "/assets/")`. Then: Eligible for cache; Edge TTL **Ignore cache-control header, 1 year**; Browser TTL **Override origin, 1 year**. Every file under `/assets/` that the site references is content-hashed (Vite chunks, and `scripts/hash-assets.ts` for models, textures and fonts), so a deploy never needs a purge. The unhashed copies are only for old pages in flight.
   - **Service worker, never stale.** When: `http.request.uri.path eq "/sw.js"`. Then: Bypass cache (or Browser TTL 0). Browsers re-check it anyway at least every 24 h, but this makes a deploy reach installed apps on their next launch.
   Optional: a Transform Rule adding `Cache-Control: public, max-age=31536000, immutable` on `/assets/*` lets browsers skip revalidation entirely.
