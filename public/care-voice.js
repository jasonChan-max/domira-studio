export function connectCareVoice({input, status}) {
 const mic = document.getElementById('care-chat-mic');
 const speakButton = document.getElementById('care-chat-speak');
 const language = document.getElementById('care-chat-language');
 const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
 let recognition = null, speaking = false, reply = '';
 const synthesis = window.speechSynthesis;
 try {language.value = localStorage.getItem('domira-care-voice-language') === 'zh-CN' ? 'zh-CN' : 'zh-HK';} catch {}
 language.onchange = () => {try {localStorage.setItem('domira-care-voice-language',language.value);} catch {}};
 mic.disabled = !Recognition;
 if (!Recognition) mic.textContent = '此瀏覽器未支援語音輸入';
 function stopSpeech() {
  if(speaking)synthesis?.cancel();
  speaking = false;
  speakButton.textContent = '讀出回覆';
 }
 mic.onclick = () => {
  if (recognition) { recognition.stop();return; }
  stopSpeech();
  const instance = new Recognition();
  recognition = instance;
  instance.lang = language.value;
  instance.continuous = false;
  instance.interimResults = false;
  instance.onstart = () => {
   mic.textContent = '停止錄音';
   mic.setAttribute('aria-pressed','true');
   status.textContent = '正在聽。你可以慢慢講。';
  };
  instance.onresult = event => {
   input.value = event.results[0][0].transcript.slice(0,input.maxLength);
   input.focus();
   status.textContent = '請核對文字，再按「發送」。';
  };
  instance.onerror = event => {
   status.textContent = event.error === 'not-allowed' ? '請在瀏覽器允許使用咪高峰，或直接打字。' : '未能聽清楚。你可以再試一次，或直接打字。';
  };
  instance.onend = () => {
   recognition = null;
   mic.textContent = '講一句';
   mic.setAttribute('aria-pressed','false');
  };
  try { instance.start(); } catch { instance.onend();status.textContent = '暫時無法開啟咪高峰，請直接打字。'; }
 };
 speakButton.onclick = () => {
  if (speaking) { stopSpeech();return; }
  const utterance = new SpeechSynthesisUtterance(reply);
  const voices = synthesis.getVoices();
  const voice = voices.find(v => language.value === 'zh-HK' ? /^(zh[-_]HK|yue)/i.test(v.lang) : /^(zh[-_](CN|Hans)|cmn)/i.test(v.lang));
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || language.value;
  utterance.rate = .88;
  utterance.onend = stopSpeech;
  utterance.onerror = () => { stopSpeech();status.textContent = '裝置未能讀出回覆，請查看文字。'; };
  speaking = true;
  speakButton.textContent = '停止朗讀';
  synthesis.speak(utterance);
 };
 return {
  reply(text) { stopSpeech();reply=text;speakButton.hidden=!synthesis; },
  stop() { recognition?.abort();stopSpeech(); }
 };
}
