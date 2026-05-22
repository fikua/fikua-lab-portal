# Fikua Lab — Portal

Admin portal for the Fikua Lab. Served at
**<https://portal.lab.fikua.com>**.

Talks to the lab backend (DSS lab on the VPS) for live log streaming
(`/admin/logs/stream` over SSE), profile management (`/admin/`) and
state reset (`/reset`). The backend itself stays on the VPS behind
Traefik / Cloudflare Tunnel — see ADR 0008.

## What lives here

```text
.
├── index.html      Portal UI
├── style.css
├── app.js
├── favicon.svg
└── shared/         Vendored shared assets (consent banner, error pages)
```

Pure static — no build step.

## Hosting

- **Production:** Cloudflare Workers Static Assets (project
  `fikua-lab-portal`), custom domain `portal.lab.fikua.com`.
- **DNS:** managed via OpenTofu in
  [`fikua-platform-iac/tofu/cloudflare/`](https://github.com/fikua/fikua-platform-iac).
- **Backend API:** the `/admin/`, `/admin/logs/stream`, `/health` and
  `/reset` paths are reverse-proxied to the lab backend at the edge
  (Cloudflare Worker or Page Rule); to be wired up when the lab backend
  is exposed publicly via Traefik.

## Architecture decisions

- ADR 0008 — Fikua Lab frontends on Cloudflare Workers.

## License

Apache-2.0. See [LICENSE](LICENSE).
