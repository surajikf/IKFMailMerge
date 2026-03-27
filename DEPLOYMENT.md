# Deployment Guide

This application is a standalone monolith:

- FastAPI serves the API
- FastAPI also serves the built React frontend
- Default runtime is `http://<server>:8000`

## 1. Files To Give Support Team

Provide the full project folder, including:

- `main.py`
- `start_server.py`
- `config.py`
- `requirements.txt`
- `package.json`
- `package-lock.json`
- `src/`
- `public/`
- `ikf.png`

Do not rely on local development folders such as:

- `node_modules/`
- `.venv/`
- `venv/`
- `dist/`
- `__pycache__/`
- `uvicorn.out.log`
- `uvicorn.err.log`

## 2. Server Requirements

- Python 3.11+
- Node.js 18+
- Network access for Gmail/Brevo/SMTP providers
- Write permission for the app directory or configured data directory

## 3. Environment Setup

Create a `.env` file in the project root using `.env.example` as the base.

Recommended production values:

```env
APP_ENV=production
APP_HOST=0.0.0.0
APP_PORT=8000
ALLOWED_ORIGINS=
APP_DATA_DIR=data
APP_LOGO_PATH=public/ikf.png
GMAIL_CREDENTIALS_PATH=credentials.json
GMAIL_TOKEN_PATH=data/token.json
```

Notes:

- Leave `ALLOWED_ORIGINS` empty if frontend and backend are served from the same URL.
- `APP_DATA_DIR` stores runtime files such as the SQLite database and Gmail token.
- If the team wants a different database path, they can set `DATABASE_URL`.

## 4. First-Time Deployment

From the project root:

```bash
python -m venv .venv
```

Windows:

```bash
.venv\Scripts\activate
```

Linux:

```bash
source .venv/bin/activate
```

Install Python dependencies:

```bash
pip install -r requirements.txt
```

Install frontend dependencies:

```bash
npm install
```

Build the frontend:

```bash
npm run build
```

Start the application:

```bash
python start_server.py
```

Open:

```text
http://SERVER_IP_OR_DOMAIN:8000
```

## 5. Gmail OAuth After Server URL Is Known

Once support gives you the final public URL, you must add this exact callback URL in Google Cloud Console:

```text
https://YOUR_DOMAIN/api/gmail/callback
```

Important:

- The callback must match the final public domain exactly
- Gmail connect will not work correctly until this is done

## 6. Files That Must Persist

These should survive restarts and deployments:

- `data/sql_app.db`
- `data/token.json`
- `credentials.json` if Gmail file credentials are used
- `public/ikf.png`

If the deployment replaces the app directory each time, support must preserve the `data/` folder.

## 7. Production Startup Recommendation

Run behind a process manager.

Examples:

- Windows service / NSSM
- Linux `systemd`
- Docker container

Recommended command:

```bash
python start_server.py
```

## 8. Smoke Test Checklist

After deployment, support should verify:

1. `GET /api/settings` returns `200`
2. App home page loads
3. `/ikf.png` returns the image
4. Upload CSV/XLSX works
5. Batch processing works
6. Test email works for the configured provider
7. Gmail connect works after callback URL is configured

You can automate the basic checks with:

```bash
python smoke_test.py http://YOUR_DOMAIN_OR_IP:8000
```

Recommended quick verification endpoints:

- `/api/health`
- `/api/ready`

## 9. Current Production Notes

This project is deployable for internal or moderate usage, but keep these constraints in mind:

- SQLite is acceptable for low-to-medium concurrency, not ideal for heavy concurrent multi-user traffic
- Secrets are file-based / DB-based, so server file permissions matter
- Reverse proxy and TLS should be handled by the hosting team if exposed publicly
