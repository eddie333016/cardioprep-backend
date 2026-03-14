require('dotenv').config();
const WebSocket = require('ws');
const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error('missing OPENAI_API_KEY');
const url = 'wss://api.openai.com/v1/realtime?model=' + (process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17');
const ws = new WebSocket(url, {headers:{Authorization:`Bearer ${key}`,'OpenAI-Beta':'realtime=v1'}});
const start = Date.now();
function t(){return ((Date.now()-start)/1000).toFixed(3)+'s'}
console.log('[direct]', t(), 'connecting');
ws.on('open', ()=>console.log('[direct]', t(), 'open'));
ws.on('message', data => {
  const text = data.toString();
  console.log('[direct]', t(), 'message', text.slice(0,500));
  try {
    const j = JSON.parse(text);
    if (j.type === 'session.created') {
      ws.send(JSON.stringify({type:'session.update', session:{instructions:'You are a patient.'}}), err=>console.log('[direct]', t(), 'send cb', err?err.message:'ok'));
    }
  } catch {}
});
ws.on('error', err => console.log('[direct]', t(), 'err', err.message));
ws.on('close', (c,r)=>console.log('[direct]', t(), 'close', c, r.toString()));
setTimeout(()=>{console.log('[direct]',t(),'timeout'); ws.close();}, 15000);
