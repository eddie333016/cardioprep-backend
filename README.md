# CardioPrep Backend Proxy

WebSocket proxy for OpenAI Realtime API with Firebase authentication.

## Features

- ✅ WebSocket proxy to OpenAI Realtime API
- ✅ Firebase token verification
- ✅ Rate limiting (3 concurrent sessions per user)
- ✅ Usage logging
- ✅ Dev mode (auth disabled for testing)

## Setup

```bash
npm install
npm start
```

## Environment Variables

- `OPENAI_API_KEY` - OpenAI API key
- `PORT` - Server port (default: 3000)
- `USE_AUTH` - Enable Firebase auth (true/false)
- `FIREBASE_SERVICE_ACCOUNT` - Firebase service account JSON

## Endpoints

- `GET /health` - Health check
- `WS /?token=<firebase-token>` - WebSocket proxy

## Development

```bash
npm run dev  # Auto-reload on changes
```

## Deployment

Deploy to Railway/Render/Fly.io:
1. Set environment variables
2. Deploy from GitHub
3. Update iOS app with backend URL
