const WebSocket = require('ws');
const url = 'wss://cardioprep-backend.onrender.com';
const cases = [
  ['system_item', [
    {type:'conversation.item.create', item:{type:'message', role:'system', content:[{type:'input_text', text:'You are a realistic cardiology patient named Don. Stay in character.'}] }},
    {type:'response.create', response:{modalities:['audio','text'], instructions:'Say exactly: Hello, doctor. What can I help you with today?'}}
  ]],
  ['user_instruction_item', [
    {type:'conversation.item.create', item:{type:'message', role:'user', content:[{type:'input_text', text:'Instruction: For the rest of this conversation, act as a realistic cardiology patient named Don. Stay in character and answer like the patient, not an AI.'}] }},
    {type:'response.create', response:{modalities:['audio','text'], instructions:'Acknowledge internally and then say exactly: Hello, doctor. What can I help you with today?'}}
  ]],
  ['response_only', [
    {type:'response.create', response:{modalities:['audio','text'], instructions:'You are a realistic cardiology patient named Don. Stay in character and say exactly: Hello, doctor. What can I help you with today?'}}
  ]],
];
async function runCase([name, events]) {
  return new Promise((resolve)=>{
    const ws = new WebSocket(url);
    const start = Date.now();
    let sent = false;
    const out = [];
    const finish = (status, detail='') => { try { ws.close(); } catch{}; resolve({name,status,detail,events:out,elapsed:Date.now()-start}); };
    ws.on('message', data=>{
      const text=data.toString(); out.push(text.slice(0,300));
      try {
        const j=JSON.parse(text);
        if (j.type==='session.created' && !sent) {
          sent = true;
          for (const ev of events) ws.send(JSON.stringify(ev));
        } else if (j.type==='error') {
          finish('error', j.error?.message || text);
        } else if (j.type==='response.audio.delta' || j.type==='response.audio_transcript.delta' || j.type==='response.audio_transcript.done' || j.type==='response.done') {
          // after first response done assume success
          if (j.type==='response.done') finish('ok');
        }
      } catch (e) {}
    });
    ws.on('error', err=>finish('ws_error', err.message));
    ws.on('close', (c,r)=>finish('closed', `${c} ${r}`));
    setTimeout(()=>finish('timeout'), 15000);
  });
}
(async()=>{ for (const c of cases) console.log(JSON.stringify(await runCase(c))); })();
