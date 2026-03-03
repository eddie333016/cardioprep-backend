import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import dotenv from 'dotenv';
import admin from 'firebase-admin';

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Initialize Firebase Admin (will configure later with service account)
// For now, skip Firebase auth in dev mode
const USE_AUTH = process.env.USE_AUTH === 'true';

if (USE_AUTH && process.env.FIREBASE_SERVICE_ACCOUNT) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('✅ Firebase Admin initialized');
} else {
  console.log('⚠️  Firebase Auth disabled (dev mode)');
}

// Middleware
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    auth: USE_AUTH ? 'enabled' : 'disabled'
  });
});

// Session tracking
const activeSessions = new Map();

// Verify Firebase token
async function verifyToken(token) {
  if (!USE_AUTH) {
    return { uid: 'dev-user', email: 'dev@cardioprep.com' };
  }
  
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    throw new Error('Invalid auth token');
  }
}

// WebSocket handler for Realtime API
wss.on('connection', async (clientWs, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  
  console.log('📱 Client connection attempt...');
  
  // Verify auth token
  let user;
  try {
    user = await verifyToken(token);
    console.log(`✅ User authenticated: ${user.email}`);
  } catch (error) {
    console.log('❌ Auth failed:', error.message);
    clientWs.close(4001, 'Unauthorized');
    return;
  }
  
  // Check rate limits (simple in-memory for now)
  const userSessions = activeSessions.get(user.uid) || [];
  if (userSessions.length >= 3) {
    console.log(`⛔ Rate limit: User ${user.email} has ${userSessions.length} active sessions`);
    clientWs.close(4029, 'Too many active sessions');
    return;
  }
  
  // Connect to OpenAI Realtime API
  const openaiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17', {
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1'
    }
  });
  
  const sessionId = `${user.uid}-${Date.now()}`;
  let sessionStartTime = Date.now();
  
  // Track session
  userSessions.push(sessionId);
  activeSessions.set(user.uid, userSessions);
  
  console.log(`🔗 OpenAI connection initiated for session: ${sessionId}`);
  
  // OpenAI -> Client
  openaiWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data);
    }
  });
  
  // Client -> OpenAI
  clientWs.on('message', (data) => {
    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.send(data);
    }
  });
  
  // Handle errors
  openaiWs.on('error', (error) => {
    console.log('❌ OpenAI error:', error.message);
    clientWs.close(1011, 'OpenAI connection error');
  });
  
  clientWs.on('error', (error) => {
    console.log('❌ Client error:', error.message);
  });
  
  // Handle closures
  const cleanup = () => {
    const duration = ((Date.now() - sessionStartTime) / 1000 / 60).toFixed(2);
    console.log(`🔚 Session ended: ${sessionId} (${duration} min)`);
    
    // Remove from active sessions
    const sessions = activeSessions.get(user.uid) || [];
    const index = sessions.indexOf(sessionId);
    if (index > -1) {
      sessions.splice(index, 1);
      if (sessions.length === 0) {
        activeSessions.delete(user.uid);
      } else {
        activeSessions.set(user.uid, sessions);
      }
    }
    
    // Log usage (in production, save to Firestore)
    console.log(`📊 Usage: ${user.email} - ${duration} minutes`);
    
    // Close both connections
    if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  };
  
  openaiWs.on('close', cleanup);
  clientWs.on('close', cleanup);
  
  openaiWs.on('open', () => {
    console.log(`✅ OpenAI connected for session: ${sessionId}`);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 CardioPrep Backend running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   WebSocket: ws://localhost:${PORT}?token=YOUR_TOKEN`);
  console.log(`   Auth: ${USE_AUTH ? 'ENABLED' : 'DISABLED (dev mode)'}`);
});
