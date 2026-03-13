# CardioPrep Backend Proxy

Hermes-operated backend for CardioPrep.

## Responsibilities

- WebSocket proxy to the OpenAI Realtime API
- Firebase token verification when auth is enabled
- Session rate limiting (3 concurrent sessions per user)
- Transcript scoring via `POST /api/score`
- Health reporting via `GET /health`

## Endpoints

- `GET /health`
- `WS /?token=<firebase-id-token>`
- `POST /api/score`
  - Header: `Authorization: Bearer <firebase-id-token>` when auth is enabled
  - JSON body:
    ```json
    {
      "transcript": "...",
      "patientName": "Margaret"
    }
    ```

## Environment variables

### Required
- `OPENAI_API_KEY`

### Common
- `PORT` — defaults to `3000`
- `USE_AUTH` — `true` or `false`
- `FIREBASE_SERVICE_ACCOUNT` — JSON service account string when `USE_AUTH=true`
- `OPENAI_REALTIME_MODEL` — optional override for websocket model
- `OPENAI_SCORING_MODEL` — optional override for scoring model

## Local development

```bash
cd ~/Projects/cardioprep-backend
npm install
npm start
```

## Smoke tests

```bash
curl http://localhost:3000/health
```

If auth is disabled, you can also test scoring locally:

```bash
curl -X POST http://localhost:3000/api/score \
  -H 'Content-Type: application/json' \
  -d '{"transcript":"Short demo transcript","patientName":"Demo Patient"}'
```

## Deployment note

Do not store real secrets in `render.yaml` or in repo-local docs. Supply them through the Render dashboard or secret environment management.
