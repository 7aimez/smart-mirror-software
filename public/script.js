// public/script.js
(function(){
  const DEFAULTS = { showClock: true, showWeather: true, showNotes: true, faceDetect: false };
  const storageKey = 'smartMirrorSettingsV1';

  // Elements
  const settingsToggle = document.getElementById('settingsToggle');
  const settingsPanel = document.getElementById('settingsPanel');
  const settingsForm = document.getElementById('settingsForm');

  const clockEl = document.getElementById('clock');
  const clockTime = document.getElementById('clockTime');

  const weatherEl = document.getElementById('weather');
  const weatherContent = document.getElementById('weatherContent');

  const notesEl = document.getElementById('notes');
  const notesContent = document.getElementById('notesContent');

  const faceStatus = document.getElementById('faceStatus');
  const faceContent = document.getElementById('faceContent');
  const faceArea = document.getElementById('faceArea');
  const video = document.getElementById('cameraVideo');
  const overlay = document.getElementById('overlay');

  // Checkboxes (IDs match requested names)
  const showClockCB = document.getElementById('showClock');
  const showWeatherCB = document.getElementById('showWeather');
  const showNotesCB = document.getElementById('showNotes');
  const faceDetectCB = document.getElementById('faceDetect');

  // State
  let settings = loadSettings();
  let clockTimer = null;
  let weatherTimer = null;
  let fdDetector = null;
  let fdInterval = null;
  let stream = null;

  // Initialize UI
  function init(){
    // Populate checkboxes
    showClockCB.checked = !!settings.showClock;
    showWeatherCB.checked = !!settings.showWeather;
    showNotesCB.checked = !!settings.showNotes;
    faceDetectCB.checked = !!settings.faceDetect;

    // Apply settings to UI
    applySettings();

    // Event listeners
    settingsToggle.addEventListener('click', toggleSettingsPanel);
    showClockCB.addEventListener('change', onSettingChange);
    showWeatherCB.addEventListener('change', onSettingChange);
    showNotesCB.addEventListener('change', onSettingChange);
    faceDetectCB.addEventListener('change', onFaceDetectChange);

    notesContent.addEventListener('input', debounce(saveNotes, 700));
    notesContent.addEventListener('blur', saveNotes);

    startClock();
    if(settings.showWeather) startWeather();
    if(settings.faceDetect) startFaceDetection();
  }

  function loadSettings(){
    try{
      const raw = localStorage.getItem(storageKey);
      if(!raw) return Object.assign({}, DEFAULTS, { notes: localStorage.getItem('smartMirrorNotes') || '' });
      const parsed = JSON.parse(raw);
      return Object.assign({}, DEFAULTS, parsed, { notes: localStorage.getItem('smartMirrorNotes') || '' });
    }catch(e){
      console.warn('Failed to load settings', e);
      return Object.assign({}, DEFAULTS, { notes: localStorage.getItem('smartMirrorNotes') || '' });
    }
  }

  function saveSettings(){
    const toSave = { showClock: !!settings.showClock, showWeather: !!settings.showWeather, showNotes: !!settings.showNotes, faceDetect: !!settings.faceDetect };
    localStorage.setItem(storageKey, JSON.stringify(toSave));
  }

  function applySettings(){
    clockEl.style.display = settings.showClock ? '' : 'none';
    weatherEl.style.display = settings.showWeather ? '' : 'none';
    notesEl.style.display = settings.showNotes ? '' : 'none';

    // Notes content
    notesContent.textContent = settings.notes || notesContent.textContent;

    // Face detection UI presence
    if(settings.faceDetect){
      faceArea.classList.remove('hidden');
    }else{
      faceArea.classList.add('hidden');
    }

    faceContent.textContent = settings.faceDetect ? 'Starting...' : 'Inactive';
  }

  function toggleSettingsPanel(){
    const hidden = settingsPanel.classList.toggle('hidden');
    settingsPanel.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    settingsToggle.setAttribute('aria-expanded', hidden ? 'false' : 'true');
  }

  function onSettingChange(e){
    const id = e.target.id;
    settings[id] = e.target.checked;
    saveSettings();
    applySettings();

    if(id === 'showWeather'){
      if(settings.showWeather) startWeather(); else stopWeather();
    }
  }

  function onFaceDetectChange(e){
    settings.faceDetect = e.target.checked;
    saveSettings();
    applySettings();
    if(settings.faceDetect) startFaceDetection(); else stopFaceDetection();
  }

  // Clock
  function startClock(){
    updateClock();
    if(clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(updateClock, 1000);
  }

  function updateClock(){
    const now = new Date();
    const hh = String(now.getHours()).padStart(2,'0');
    const mm = String(now.getMinutes()).padStart(2,'0');
    const ss = String(now.getSeconds()).padStart(2,'0');
    clockTime.textContent = `${hh}:${mm}:${ss}`;
  }

  // Weather (uses open-meteo without API key)
  async function startWeather(){
    await fetchAndRenderWeather();
    if(weatherTimer) clearInterval(weatherTimer);
    weatherTimer = setInterval(fetchAndRenderWeather, 10 * 60 * 1000); // every 10min
  }
  function stopWeather(){
    if(weatherTimer) { clearInterval(weatherTimer); weatherTimer = null; }
  }

  async function fetchAndRenderWeather(){
    weatherContent.textContent = 'Loading...';
    try{
      const coords = await getCoordinates();
      const lat = coords.latitude.toFixed(4);
      const lon = coords.longitude.toFixed(4);
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=celsius`;
      const res = await fetch(url);
      if(!res.ok) throw new Error('Weather API error');
      const data = await res.json();
      if(data && data.current_weather){
        const t = data.current_weather.temperature;
        const w = data.current_weather.weathercode;
        weatherContent.textContent = `${t}°C (code ${w})`;
      }else{
        weatherContent.textContent = 'Weather data unavailable';
      }
    }catch(err){
      console.warn('Weather failed', err);
      weatherContent.textContent = 'Weather unavailable';
    }
  }

  function getCoordinates(){
    return new Promise((resolve)=>{
      if(navigator.geolocation){
        const timeout = setTimeout(()=>{
          // fallback coords (New York) if geolocation times out
          resolve({latitude:40.7128, longitude:-74.0060});
        },5000);
        navigator.geolocation.getCurrentPosition((pos)=>{
          clearTimeout(timeout);
          resolve(pos.coords);
        },()=>{
          clearTimeout(timeout);
          resolve({latitude:40.7128, longitude:-74.0060});
        },{maximumAge:600000, timeout:5000});
      }else{
        resolve({latitude:40.7128, longitude:-74.0060});
      }
    });
  }

  // Notes
  function saveNotes(){
    settings.notes = notesContent.textContent || '';
    localStorage.setItem('smartMirrorNotes', settings.notes);
  }

  // Face detection
  async function startFaceDetection(){
    faceContent.textContent = 'Initializing...';

    // Try to get camera access
    try{
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      video.srcObject = stream;
      await video.play();
    }catch(err){
      console.warn('Camera start failed', err);
      faceContent.textContent = 'Camera access denied/unavailable';
      return;
    }

    // Setup canvas size
    overlay.width = video.videoWidth || video.clientWidth || 320;
    overlay.height = video.videoHeight || video.clientHeight || 240;

    // Use native FaceDetector API if available
    if('FaceDetector' in window){
      try{
        fdDetector = new FaceDetector({ fastMode: true, maxDetectedFaces: 5 });
        runFaceDetector();
        faceContent.textContent = 'Detecting faces...';
        return;
      }catch(e){
        console.warn('FaceDetector init failed', e);
      }
    }

    // Fallback: no detection available
    faceContent.textContent = 'Face detection not supported in this browser.';
  }

  async function runFaceDetector(){
    const ctx = overlay.getContext('2d');
    if(!ctx) return;

    const detect = async ()=>{
      try{
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
        ctx.clearRect(0,0,overlay.width,overlay.height);
        const faces = await fdDetector.detect(video);
        if(faces && faces.length){
          faceContent.textContent = `${faces.length} face(s) detected`;
          ctx.strokeStyle = '#00FF00';
          ctx.lineWidth = 2;
          faces.forEach(f=>{
            const box = f.boundingBox;
            ctx.strokeRect(box.x, box.y, box.width, box.height);
          });
        }else{
          faceContent.textContent = 'No faces';
        }
      }catch(err){
        console.warn('Face detect error', err);
        faceContent.textContent = 'Detection error';
      }
    };

    fdInterval = setInterval(detect, 200); // run ~5x per second
  }

  function stopFaceDetection(){
    faceContent.textContent = 'Inactive';
    if(fdInterval){ clearInterval(fdInterval); fdInterval = null; }
    fdDetector = null;
    // stop camera
    if(stream){
      stream.getTracks().forEach(t=>t.stop());
      stream = null;
    }
    if(video){ try{ video.pause(); video.srcObject = null; }catch(e){}
    }
    // clear overlay
    if(overlay && overlay.getContext){
      const ctx = overlay.getContext('2d'); if(ctx) ctx.clearRect(0,0,overlay.width,overlay.height);
    }
  }

  // Utility: debounce
  function debounce(fn, wait){
    let t = null; return function(...args){ clearTimeout(t); t = setTimeout(()=>fn.apply(this,args), wait); };
  }

  // Start
  init();
})();
