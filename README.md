# IKF MailMerge — monolith

This repository is **one application**: a Python **FastAPI** backend and a **React + Vite** frontend in the **same project**, deployed as a **single process** that serves both the REST API and the built web UI.

There is no separate “frontend service” required for production.

## Layout

| Path | Role |
|------|------|
| `main.py`, `start_server.py` | FastAPI app (`/api/...`) |
| `src/` | React + TypeScript source |
| `dist/` | **Generated** by `npm run build` — HTML/JS/CSS the server ships |
| End of `main.py` | Serves `dist/` + `/assets` for the SPA |

## Development (two terminals)

1. **API:** run from repo root, e.g. `python start_server.py` (uses `config` / `APP_PORT`, often `8000`).
2. **UI:** `npm run dev` — Vite dev server proxies `/api` to the backend (`vite.config.ts`).

## Production (single deploy)

1. From repo root: **`npm run build`** — runs TypeScript check + Vite, output **`dist/`**.
2. Start **only** the FastAPI app (e.g. `python start_server.py` or your PM2/systemd entry).  
   It must run with **`dist/` present** next to `main.py` so the UI loads.

Do **not** deploy the UI to a different host unless you intentionally split stacks and configure CORS + API base URL.

## Windows one-click refresh

`refresh_app.bat` rebuilds the frontend and restarts the backend (e.g. PM2) so the monolith stays in sync.

## Tests

`npm test` — Vitest unit tests (guards/helpers).
