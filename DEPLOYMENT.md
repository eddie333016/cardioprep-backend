# CardioPrep Backend Deployment Guide

## Railway Deployment (Recommended)

1. Install Railway CLI:
```bash
npm install -g @railway/cli
```

2. Login:
```bash
railway login
```

3. Create new project:
```bash
railway init
```

4. Set environment variables:
```bash
railway variables set OPENAI_API_KEY=sk-svcacct-...
railway variables set USE_AUTH=false
railway variables set PORT=3000
```

5. Deploy:
```bash
railway up
```

6. Get URL:
```bash
railway status
```

## Alternative: Render Deployment

1. Go to https://render.com
2. New > Web Service
3. Connect GitHub repo
4. Environment variables:
   - OPENAI_API_KEY
   - USE_AUTH=false
   - PORT=3000
5. Deploy

## Alternative: Fly.io Deployment

1. Install flyctl:
```bash
curl -L https://fly.io/install.sh | sh
```

2. Login:
```bash
flyctl auth login
```

3. Launch:
```bash
flyctl launch
```

4. Set secrets:
```bash
flyctl secrets set OPENAI_API_KEY=sk-svcacct-...
```

5. Deploy:
```bash
flyctl deploy
```

## Environment Variables

Required:
- `OPENAI_API_KEY` - OpenAI API key
- `USE_AUTH` - Enable Firebase auth (false for testing)
- `PORT` - Server port (default: 3000)

Optional (for production):
- `FIREBASE_SERVICE_ACCOUNT` - Firebase service account JSON

## Testing After Deployment

```bash
# Health check
curl https://your-app.up.railway.app/health

# WebSocket test (requires wscat)
wscat -c "wss://your-app.up.railway.app?token=dev-token"
```

## Update iOS App

After deployment, update `Config.swift`:

```swift
public static var backendURL: String {
    #if DEBUG
    return "ws://localhost:3000"
    #else
    return "wss://your-app.up.railway.app"  // ← Update this
    #endif
}
```
