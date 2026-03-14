const WebSocket = require('ws');
const url = 'wss://cardioprep-backend.onrender.com';
const ws = new WebSocket(url);
const start = Date.now();
function t(){return ((Date.now()-start)/1000).toFixed(3)+'s'}
console.log('[client]', t(), 'connecting to', url);
ws.on('open', ()=>console.log('[client]', t(), 'open'));
ws.on('message', (data)=>{
  const text = data.toString();
  console.log('[client]', t(), 'message', text.slice(0,400));
  try {
    const json = JSON.parse(text);
    if (json.type === 'session.created') {
      console.log('[client]', t(), 'sending session.update');
      ws.send(JSON.stringify({type:'session.update', session:{modalities:['text','audio'], instructions:'You are a patient.', voice:'ash', input_audio_format:'pcm16', output_audio_format:'pcm16', input_audio_transcription:{model:'whisper-1'}, turn_detection:{type:'server_vad', threshold:0.5, prefix_padding_ms:300, silence_duration_ms:500}, temperature:0.7, max_response_output_tokens:300}}), (err)=>{
        console.log('[client]', t(), 'send callback', err ? err.message : 'ok');
      });
      setTimeout(()=>{
        console.log('[client]', t(), 'sending greeting item');
        ws.send(JSON.stringify({type:'conversation.item.create', item:{type:'message', role:'assistant', content:[{type:'input_text', text:'Hello, doctor. What can I help you with today?'}]}}), err=>console.log('[client]', t(), 'greeting send cb', err?err.message:'ok'));
      }, 500);
    }
  } catch {}
});
ws.on('close', (code, reason)=>console.log('[client]', t(), 'close', code, reason.toString()));
ws.on('error', (err)=>console.log('[client]', t(), 'error', err.message));
setTimeout(()=>{ console.log('[client]', t(), 'timeout exiting'); try{ws.close();}catch{} }, 20000);
