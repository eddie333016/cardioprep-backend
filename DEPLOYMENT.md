# CardioPrep Backend Deployment Guide

## Recommended target
Current production-style host:
- `https://cardioprep-backend.onrender.com`

## Required environment variables
- `OPENAI_API_KEY`
- `PORT` (Render commonly injects this)

## Optional / production auth
- `USE_AUTH=true`
- `FIREBASE_SERVICE_ACCOUNT=<json>`
- `OPENAI_REALTIME_MODEL=<override>`
- `OPENAI_SCORING_MODEL=<override>`

## Render deployment
1. Connect the repo in Render.
2. Ensure `OPENAI_API_KEY` is set as a secret in Render.
3. Set `USE_AUTH=true` only when Firebase Admin credentials are configured.
4. If auth is enabled, set `FIREBASE_SERVICE_ACCOUNT` as a secret JSON string.
5. Deploy.

## After deploy
```bash
curl https://cardioprep-backend.onrender.com/health
```

If auth is enabled, also verify:
- websocket connection from the app succeeds
- `POST /api/score` accepts a valid Firebase ID token

## App config alignment
The iOS app uses:
- debug websocket: `ws://localhost:3000`
- release websocket: `wss://cardioprep-backend.onrender.com`

The app derives the scoring endpoint automatically from the websocket base URL, so keep the backend host consistent.
