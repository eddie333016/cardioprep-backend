const WebSocket = require('ws');
const url = 'wss://cardioprep-backend.onrender.com';

const cases = [
  ['minimal', {instructions:'You are a patient.'}],
  ['voice', {instructions:'You are a patient.', voice:'ash'}],
  ['modalities', {modalities:['text','audio'], instructions:'You are a patient.', voice:'ash'}],
  ['formats', {instructions:'You are a patient.', voice:'ash', input_audio_format:'pcm16', output_audio_format:'pcm16'}],
  ['transcription', {instructions:'You are a patient.', voice:'ash', input_audio_transcription:{model:'whisper-1'}}],
  ['turn_detection', {instructions:'You are a patient.', voice:'ash', turn_detection:{type:'server_vad', threshold:0.5, prefix_padding_ms:300, silence_duration_ms:500}}],
  ['temp', {instructions:'You are a patient.', voice:'ash', temperature:0.7}],
  ['tokens', {instructions:'You are a patient.', voice:'ash', max_response_output_tokens:300}],
  ['full', {modalities:['text','audio'], instructions:'You are a patient.', voice:'ash', input_audio_format:'pcm16', output_audio_format:'pcm16', input_audio_transcription:{model:'whisper-1'}, turn_detection:{type:'server_vad', threshold:0.5, prefix_padding_ms:300, silence_duration_ms:500}, temperature:0.7, max_response_output_tokens:300}],
];

function runCase([name, session]) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const start = Date.now();
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}
      resolve({name, ...result, elapsed: Date.now()-start});
    };
    ws.on('message', (data) => {
      const text = data.toString();
      try {
        const json = JSON.parse(text);
        if (json.type === 'session.created') {
          ws.send(JSON.stringify({type:'session.update', session}), (err) => {
            if (err) finish({status:'send_error', detail:err.message});
          });
        } else if (json.type === 'session.updated') {
          finish({status:'ok'});
        } else if (json.type === 'error') {
          finish({status:'error', detail:json.error?.message || text});
        }
      } catch {
        finish({status:'parse_error', detail:text.slice(0,200)});
      }
    });
    ws.on('error', (err) => finish({status:'ws_error', detail:err.message}));
    ws.on('close', (code, reason) => finish({status:'closed', detail:`${code} ${reason}` }));
    setTimeout(()=>finish({status:'timeout'}), 12000);
  });
}

(async()=>{
  for (const c of cases) {
    const result = await runCase(c);
    console.log(JSON.stringify(result));
  }
})();
