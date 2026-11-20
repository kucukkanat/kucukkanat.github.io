# Deploying to kucukkanat.com

1. Create (or reuse) the GitHub repo and push `main`. Recommended: a new repo with this folder as its root.
2. Repo → Settings → Pages → Source: **GitHub Actions**. The workflow in `.github/workflows/pages.yml` builds with Bun and publishes `dist/`.
3. Settings → Pages → Custom domain: `kucukkanat.com` (the build also writes `dist/CNAME`). Tick **Enforce HTTPS** once the certificate is issued.
4. Cloudflare DNS for `kucukkanat.com`:
   - `CNAME  @    kucukkanat.github.io` (Cloudflare flattens it at the apex), or the four GitHub A records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `CNAME  www  kucukkanat.github.io`
   - Proxy: **DNS only** (grey cloud) until GitHub has issued the certificate; after that orange cloud works with SSL mode **Full**.
5. If `kucukkanat.github.io` (the user-site repo) also has a custom domain set, remove it there first — a domain can only belong to one Pages site.
