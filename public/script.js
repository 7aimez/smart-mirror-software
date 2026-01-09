// Software Smart Mirror - main script
const video = document.getElementById('camera');
const timeEl = document.getElementById('time');
const dateEl = document.getElementById('date');
const weatherEl = document.getElementById('weather');
const notesEl = document.getElementById('notes');
const msgEl = document.getElementById('message');

const settingsPanel = document.getElementById('settings');
const openSettingsBtn = document.getElementById('openSettings');
const closeSettingsBtn = document.getElementById('closeSettings');
const showClockCB = document.getElementById('showClock');
const showWeatherCB = document.getElementById('showWeather');
const showNotesCB = document.getElementById('showNotes');
const toggleMirrorBtn = document.getElementById('toggleMirror');
const toggleCameraBtn = document.getElementById('toggleCamera');

let stream = null;
let mirrorFlipped = true;

function showMessage(text, ms=3000){
  msgEl.textContent = text;
  msgEl.classList.remove('hidden');
  setTimeout(()=> msgEl.classList.add('hidden'), ms);
}

// --- Camera init ---
async function startCamera(){
  if (stream) return;
  try{
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = stream;
    video.play().catch(()=>{ /* auto-play policies */});
    showMessage('Camera enabled');
  }catch(err){
    console.warn('Camera failed', err);
    showMessage('Camera access denied or not available');
  }
}

function stopCamera(){
  if (!stream) return;
  stream.getTracks().forEach(t=>t.stop());
  stream = null;
  video.srcObject = null;
  showMessage('Camera stopped');
}

// --- Clock and date ---
function updateClock(){
  const now = new Date();
  const hh = now.getHours().toString().padStart(2,'0');
  const mm = now.getMinutes().toString().padStart(2,'0');
  timeEl.textContent = `${hh}:${mm}`;
  dateEl.textContent = now.toLocaleDateString(undefined, { weekday:'long', month:'short', day:'numeric' });
}
// start clock
updateClock();
setInterval(updateClock, 1000);

// --- Weather (Open-Meteo, no key) ---
async function fetchWeather(){
  if (!navigator.geolocation) {
    weatherEl.textContent = 'Location unavailable';
    return;
  }
  weatherEl.textContent = 'Finding location…';
  navigator.geolocation.getCurrentPosition(async pos=>{
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    try{
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`;
      const res = await fetch(url);
      const json = await res.json();
      const cw = json.current_weather;
      if(!cw) { weatherEl.textContent = 'Weather unavailable'; return; }
      // simple weather display
      weatherEl.innerHTML = `${Math.round(cw.temperature)}°C • ${windIcon(cw.windspeed)} ${Math.round(cw.windspeed)} km/h`;
    }catch(err){
      console.warn(err);
      weatherEl.textContent = 'Weather fetch failed';
    }
  }, err=>{
    console.warn(err);
    weatherEl.textContent = 'Location permission required';
  }, {timeout:8000});
}

// tiny mapping: simple wind icon by speed (could map weathercode too)
function windIcon(speed){
  if (speed < 2) return '🌬️';
  if (speed < 10) return '💨';
  return '🌪️';
}

// --- Settings persistence ---
function loadSettings(){
  const s = JSON.parse(localStorage.getItem('mirror.settings') || '{}');
  showClockCB.checked = s.showClock !== false;
  showWeatherCB.checked = s.showWeather !== false;
  showNotesCB.checked = s.showNotes !== false;
  mirrorFlipped = s.mirrorFlipped !== false;
  applySettings();
}
function saveSettings(){
  const s = {
    showClock: showClockCB.checked,
    showWeather: showWeatherCB.checked,
    showNotes: showNotesCB.checked,
    mirrorFlipped
  };
  localStorage.setItem('mirror.settings', JSON.stringify(s));
}

function applySettings(){
  document.getElementById('top-left').style.display = showClockCB.checked ? 'block' : 'none';
  document.getElementById('top-right').style.display = showWeatherCB.checked ? 'block' : 'none';
  document.getElementById('bottom-left').style.display = showNotesCB.checked ? 'block' : 'none';
  video.style.transform = mirrorFlipped ? 'scaleX(-1)' : 'scaleX(1)';
  saveSettings();
}

// --- Notes persistence ---
notesEl.value = localStorage.getItem('mirror.notes') || '';
notesEl.addEventListener('input', ()=> localStorage.setItem('mirror.notes', notesEl.value));

// --- UI bindings ---
openSettingsBtn.addEventListener('click', ()=> settingsPanel.classList.toggle('hidden'));
closeSettingsBtn.addEventListener('click', ()=> settingsPanel.classList.add('hidden'));
showClockCB.addEventListener('change', applySettings);
showWeatherCB.addEventListener('change', applySettings);
showNotesCB.addEventListener('change', applySettings);

toggleMirrorBtn.addEventListener('click', ()=>{
  mirrorFlipped = !mirrorFlipped;
  applySettings();
});

toggleCameraBtn.addEventListener('click', ()=>{
  if (stream) stopCamera();
  else startCamera();
});

// keyboard shortcuts
window.addEventListener('keydown', (e)=>{
  if (e.key === 's') settingsPanel.classList.toggle('hidden');
  if (e.key === 'm') {
    mirrorFlipped = !mirrorFlipped;
    applySettings();
  }
  if (e.key === 'c') {
    if (stream) stopCamera(); else startCamera();
  }
});

// init
loadSettings();
fetchWeather();
startCamera(); // try start camera immediately; user can stop with controls

// optional: refresh weather every 15 minutes
setInterval(fetchWeather, 15*60*1000);
