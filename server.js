import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import dotenv from 'dotenv';
import admin from 'firebase-admin';

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const USE_AUTH = process.env.USE_AUTH === 'true';
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
const SCORING_MODEL = process.env.OPENAI_SCORING_MODEL || 'gpt-4.1-mini';
const CONVERSATION_MODEL = process.env.OPENAI_CONVERSATION_MODEL || 'gpt-4o-mini';

if (!OPENAI_API_KEY) {
  console.warn('⚠️ OPENAI_API_KEY is not set. Realtime and scoring requests will fail.');
}

if (USE_AUTH && process.env.FIREBASE_SERVICE_ACCOUNT) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log('✅ Firebase Admin initialized');
} else {
  console.log('⚠️ Firebase Auth disabled (dev mode)');
}

app.use(express.json({ limit: '2mb' }));

const activeSessions = new Map();

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    auth: USE_AUTH ? 'enabled' : 'disabled',
    realtimeModel: REALTIME_MODEL,
    scoringModel: SCORING_MODEL,
  });
});

function getAuthTokenFromRequest(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  return url.searchParams.get('token');
}

async function verifyToken(token) {
  if (!USE_AUTH) {
    return { uid: 'dev-user', email: 'dev@cardioprep.local' };
  }

  if (!token) {
    throw new Error('Missing auth token');
  }

  try {
    return await admin.auth().verifyIdToken(token);
  } catch {
    throw new Error('Invalid auth token');
  }
}

async function authenticateRequest(req) {
  const token = getAuthTokenFromRequest(req);
  return verifyToken(token);
}

function requireOpenAIKey(res) {
  if (OPENAI_API_KEY) {
    return true;
  }

  res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the backend.' });
  return false;
}

function normalizeScorePayload(payload) {
  const strengths = Array.isArray(payload.strengths) ? payload.strengths : [];
  const improvements = Array.isArray(payload.improvements) ? payload.improvements : [];

  const historyScore = Number(payload.historyScore) || 0;
  const presentationScore = Number(payload.presentationScore) || 0;
  const reasoningScore = Number(payload.reasoningScore) || 0;
  const discussionScore = Number(payload.discussionScore) || 0;
  const computedOverall = Math.round(
    (historyScore + presentationScore + reasoningScore + discussionScore) / 4,
  );

  return {
    overallScore: Number(payload.overallScore) || computedOverall,
    historyScore,
    presentationScore,
    reasoningScore,
    discussionScore,
    feedback: typeof payload.feedback === 'string' ? payload.feedback : 'No feedback returned.',
    strengths: strengths.map(String).slice(0, 5),
    improvements: improvements.map(String).slice(0, 5),
  };
}

async function chatCompletion({ model, messages, temperature = 0.7, response_format }) {
  const body = { model, messages, temperature };
  if (response_format) {
    body.response_format = response_format;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'OpenAI chat completion request failed');
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI chat completion response was empty');
  }

  return { content, usage: data.usage || null };
}

async function requestScoringFromOpenAI({ transcript, patientName }) {
  const rubric = `You are an expert cardiology exam assessor. Evaluate the transcript of a mock clinical exam.
Return strict JSON with exactly these keys:
overallScore, historyScore, presentationScore, reasoningScore, discussionScore, feedback, strengths, improvements
Rules:
- scores are integers from 0 to 100
- strengths is an array of 2 to 5 short bullet strings
- improvements is an array of 2 to 5 short bullet strings
- feedback is a concise paragraph
- overallScore should reflect the whole performance, not just a simple average if nuance matters`;

  const { content } = await chatCompletion({
    model: SCORING_MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: rubric },
      {
        role: 'user',
        content: `Patient: ${patientName}\n\nTranscript:\n${transcript}`,
      },
    ],
  });

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    console.error('OpenAI returned non-JSON:', content.slice(0, 200));
    throw new Error(`OpenAI returned malformed JSON: ${e.message}`);
  }
  return normalizeScorePayload(parsed);
}

async function requestConversationResponse({ systemPrompt, history, userMessage, role }) {
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  for (const turn of history || []) {
    if (!turn || typeof turn.role !== 'string' || typeof turn.content !== 'string') continue;
    messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: userMessage });

  const { content, usage } = await chatCompletion({
    model: CONVERSATION_MODEL,
    temperature: role === 'examiner' ? 0.5 : 0.8,
    messages,
  });

  return {
    text: content.trim(),
    model: CONVERSATION_MODEL,
    usage,
  };
}

app.post('/api/score', async (req, res) => {
  if (!requireOpenAIKey(res)) {
    return;
  }

  let user;
  try {
    user = await authenticateRequest(req);
  } catch (error) {
    res.status(401).json({ error: error.message });
    return;
  }

  const transcript = typeof req.body?.transcript === 'string' ? req.body.transcript.trim() : '';
  const patientName = typeof req.body?.patientName === 'string' ? req.body.patientName.trim() : 'Unknown patient';

  if (!transcript) {
    res.status(400).json({ error: 'Transcript is required.' });
    return;
  }

  try {
    const score = await requestScoringFromOpenAI({ transcript, patientName });
    console.log(`📊 Scored transcript for ${user.email || user.uid} (${transcript.length} chars)`);
    res.json(score);
  } catch (error) {
    console.error('❌ Scoring failed:', error.message);
    res.status(502).json({ error: error.message });
  }
});

app.post('/api/conversation', async (req, res) => {
  if (!requireOpenAIKey(res)) {
    return;
  }

  let user;
  try {
    user = await authenticateRequest(req);
  } catch (error) {
    res.status(401).json({ error: error.message });
    return;
  }

  const systemPrompt = typeof req.body?.systemPrompt === 'string' ? req.body.systemPrompt.trim() : '';
  const userMessage = typeof req.body?.userMessage === 'string' ? req.body.userMessage.trim() : '';
  const role = req.body?.role === 'examiner' ? 'examiner' : 'patient';
  const history = Array.isArray(req.body?.history) ? req.body.history : [];

  if (!systemPrompt || !userMessage) {
    res.status(400).json({ error: 'systemPrompt and userMessage are required.' });
    return;
  }

  try {
    const result = await requestConversationResponse({ systemPrompt, history, userMessage, role });
    console.log(`💬 Conversation response for ${user.email || user.uid} role=${role} history=${history.length}`);
    res.json(result);
  } catch (error) {
    console.error('❌ Conversation failed:', error.message);
    res.status(502).json({ error: error.message });
  }
});

wss.on('connection', async (clientWs, req) => {
  console.log('📱 Client connection attempt...');

  let user;
  try {
    user = await authenticateRequest(req);
    console.log(`✅ User authenticated: ${user.email || user.uid}`);
  } catch (error) {
    console.log('❌ Auth failed:', error.message);
    clientWs.close(4001, 'Unauthorized');
    return;
  }

  if (!OPENAI_API_KEY) {
    clientWs.close(1011, 'Backend missing OPENAI_API_KEY');
    return;
  }

  const userSessions = activeSessions.get(user.uid) || [];
  if (userSessions.length >= 3) {
    console.log(`⛔ Rate limit: ${user.email || user.uid} has ${userSessions.length} active sessions`);
    clientWs.close(4029, 'Too many active sessions');
    return;
  }

  const openaiWs = new WebSocket(`wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  });
  const pendingClientMessages = [];

  const sessionId = `${user.uid}-${Date.now()}`;
  const sessionStartTime = Date.now();
  let cleanedUp = false;

  // Keep-alive ping every 30s (Render drops idle connections after 55s)
  const pingInterval = setInterval(() => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.ping();
    }
  }, 30000);

  userSessions.push(sessionId);
  activeSessions.set(user.uid, userSessions);
  console.log(`🔗 OpenAI connection initiated for session: ${sessionId}`);

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    clearInterval(pingInterval);

    const durationMinutes = ((Date.now() - sessionStartTime) / 1000 / 60).toFixed(2);
    console.log(`🔚 Session ended: ${sessionId} (${durationMinutes} min)`);

    const sessions = activeSessions.get(user.uid) || [];
    const index = sessions.indexOf(sessionId);
    if (index > -1) {
      sessions.splice(index, 1);
    }
    if (sessions.length === 0) {
      activeSessions.delete(user.uid);
    } else {
      activeSessions.set(user.uid, sessions);
    }

    console.log(`📊 Usage: ${user.email || user.uid} - ${durationMinutes} minutes`);

    if (openaiWs.readyState === WebSocket.OPEN || openaiWs.readyState === WebSocket.CONNECTING) {
      openaiWs.close();
    }
    if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
      clientWs.close();
    }
  };

  // Events we log from OpenAI → client (significant state changes only, not audio deltas)
  const LOGGED_OPENAI_EVENTS = new Set([
    'session.created', 'session.updated', 'session.error',
    'input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped',
    'input_audio_buffer.committed',
    'conversation.item.input_audio_transcription.completed',
    'conversation.item.input_audio_transcription.failed',
    'response.created', 'response.done', 'response.cancelled',
    'response.audio_transcript.done',
    'error', 'rate_limits.updated',
  ]);

  openaiWs.on('message', (data) => {
    // Parse and log significant events (skip audio deltas to avoid log spam)
    try {
      const str = Buffer.isBuffer(data) ? data.toString() : data;
      const evt = JSON.parse(str);
      if (LOGGED_OPENAI_EVENTS.has(evt.type)) {
        const extra = evt.type === 'conversation.item.input_audio_transcription.completed'
          ? ` transcript="${(evt.transcript || '').slice(0, 80)}"`
          : evt.type === 'response.audio_transcript.done'
          ? ` transcript="${(evt.transcript || '').slice(0, 80)}"`
          : evt.type === 'error'
          ? ` msg="${evt.error?.message}"`
          : '';
        console.log(`[${sessionId}] ← OpenAI: ${evt.type}${extra}`);
      }
    } catch {
      // binary/non-JSON — ignore
    }
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data);
    }
  });

  clientWs.on('message', (data) => {
    if (Buffer.isBuffer(data) && data.length > 500000) {
      console.warn(`⚠️ Oversized WS message (${data.length} bytes), dropping`);
      return;
    }
    // Log significant client→OpenAI events (skip audio chunks)
    try {
      const str = Buffer.isBuffer(data) ? data.toString() : data;
      const evt = JSON.parse(str);
      if (evt.type && evt.type !== 'input_audio_buffer.append') {
        console.log(`[${sessionId}] → Client: ${evt.type}`);
      }
    } catch { /* binary */ }

    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.send(data);
      return;
    }
    if (openaiWs.readyState === WebSocket.CONNECTING) {
      pendingClientMessages.push(data);
      return;
    }
    console.log('⚠️ Dropping client message because OpenAI websocket is closed');
  });

  openaiWs.on('error', (error) => {
    console.log('❌ OpenAI error:', error.message);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, 'OpenAI connection error');
    }
  });

  clientWs.on('error', (error) => {
    console.log('❌ Client error:', error.message);
  });

  openaiWs.on('close', cleanup);
  clientWs.on('close', cleanup);

  openaiWs.on('open', () => {
    console.log(`✅ OpenAI connected for session: ${sessionId}`);
    while (pendingClientMessages.length > 0 && openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.send(pendingClientMessages.shift());
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 CardioPrep Backend running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   WebSocket: ws://localhost:${PORT}?token=<firebase-id-token>`);
  console.log(`   Scoring:   http://localhost:${PORT}/api/score`);
  console.log(`   Auth: ${USE_AUTH ? 'ENABLED' : 'DISABLED (dev mode)'}`);
});
