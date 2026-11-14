export function careVoiceDecision(text){
 const command=text.normalize('NFKC').trim().replace(/[。！!]+$/,'');
 if(/^(確認套用|确认应用|確認修改|确认修改|確認|确认|套用|應用|应用|用呢個|就這樣|就这样)$/.test(command))return 'apply';
 if(/^(取消|取消修改|唔好改|不要改|不用了|唔使喇|略過|略过)$/.test(command))return 'dismiss';
 return null;
}

export function connectCareVoice({input, status, beginTurn, finishTurn}) {
 const mic = document.getElementById('care-chat-mic');
 const speakButton = document.getElementById('care-chat-speak');
 const language = document.getElementById('care-chat-language');
 const mode = document.getElementById('care-chat-voice-mode');
 const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
 let recognition = null, speaking = null, reply = '';
 const synthesis = window.speechSynthesis;
 try {language.value = localStorage.getItem('domira-care-voice-language') === 'zh-CN' ? 'zh-CN' : 'zh-HK';mode.checked=localStorage.getItem('domira-care-voice-mode')==='true';} catch {}
 language.onchange = () => {try {localStorage.setItem('domira-care-voice-language',language.value);} catch {}};
 mic.disabled = !Recognition;
 mode.disabled = !Recognition;
 mode.onchange=()=>{try{localStorage.setItem('domira-care-voice-mode',String(mode.checked));}catch{}};
 if (!Recognition) mic.textContent = '此瀏覽器未支援語音輸入';
 function stopSpeech() {
  const previous=speaking;
  speaking=null;
  if(previous)synthesis?.cancel();
  speakButton.textContent = '讀出回覆';
 }
 mic.onclick = () => {
  if (recognition) {try{recognition.stop();}catch{}return;}
  const turn=beginTurn?.();
  if(turn===false)return;
  stopSpeech();
  const instance = new Recognition();
  let transcript='';
  const automatic=mode.checked;
  recognition = instance;
  instance.lang = language.value;
  instance.continuous = false;
  instance.interimResults = false;
  instance.onstart = () => {
   if(recognition!==instance)return;
   mic.textContent = '停止錄音';
   mic.setAttribute('aria-pressed','true');
   status.textContent = automatic&&turn?.pending?'正在聽。可以說「確認套用」或「取消」。':'正在聽。你可以慢慢講。';
  };
  instance.onresult = event => {transcript=event.results[event.resultIndex||0]?.[0]?.transcript?.trim().slice(0,input.maxLength)||'';};
  instance.onerror = event => {
   if(recognition!==instance)return;
   transcript='';
   status.textContent = event.error === 'not-allowed' ? '請在瀏覽器允許使用咪高峰，或直接打字。' : '未能聽清楚。你可以再試一次，或直接打字。';
  };
  function resetMic(){
   recognition = null;
   mic.textContent = '講一句';
   mic.setAttribute('aria-pressed','false');
  }
  instance.onend = () => {
   if(recognition!==instance)return;
   resetMic();
   if(!transcript)return;
   if(automatic){finishTurn?.(transcript,turn);return;}
   input.value=transcript;
   input.focus();
   status.textContent='請核對文字，再按「發送」。';
  };
  try { instance.start(); } catch { instance.onend();status.textContent = '暫時無法開啟咪高峰，請直接打字。'; }
 };
 function speak(text) {
  if(!synthesis||!text||recognition)return;
  if (speaking) { stopSpeech();return; }
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = synthesis.getVoices();
  const voice = voices.find(v => language.value === 'zh-HK' ? /^(zh[-_]HK|yue)/i.test(v.lang) : /^(zh[-_](CN|Hans)|cmn)/i.test(v.lang));
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || language.value;
  utterance.rate = .88;
  function finished(){if(speaking!==utterance)return false;speaking=null;speakButton.textContent='讀出回覆';return true;}
  utterance.onend = finished;
  utterance.onerror = () => {if(finished())status.textContent = '裝置未能讀出回覆，請查看文字或再按「讀出回覆」。';};
  speaking = utterance;
  speakButton.textContent = '停止朗讀';
  try{synthesis.speak(utterance);}catch{utterance.onerror();}
 }
 speakButton.onclick=()=>speak(reply);
 return {
  reply(text,{read=false}={}) {stopSpeech();reply=text;speakButton.hidden=!synthesis;if(read&&mode.checked)speak(text);},
  stop() {const instance=recognition;recognition=null;mic.textContent=Recognition?'講一句':'此瀏覽器未支援語音輸入';mic.setAttribute('aria-pressed','false');try{instance?.abort();}catch{}stopSpeech();}
 };
}
