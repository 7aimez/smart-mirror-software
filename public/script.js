(function(){
  // DOM refs
  const video = document.getElementById('video');
  const overlay = document.getElementById('overlay');
  const ctx = overlay.getContext('2d');
  const settingsToggle = document.getElementById('settings-toggle');
  const settingsPanel = document.getElementById('settings');
  const faceToggle = document.getElementById('face-toggle');

  // State
  let faceDetectionEnabled = (localStorage.getItem('faceDetectionEnabled') === 'true');
  let detector = null; // native FaceDetector
  let trackingLoaded = false;
  let trackingTracker = null;
  let animationId = null;

  // Initialize UI
  faceToggle.checked = faceDetectionEnabled;
  settingsToggle.addEventListener('click', () => {
    const expanded = settingsToggle.getAttribute('aria-expanded') === 'true';
    settingsToggle.setAttribute('aria-expanded', String(!expanded));
    settingsPanel.hidden = !settingsPanel.hidden;
  });

  faceToggle.addEventListener('change', (e) => {
    faceDetectionEnabled = e.target.checked;
    localStorage.setItem('faceDetectionEnabled', String(faceDetectionEnabled));
    updateDetectionRunning();
  });

  // Start camera
  async function startCamera(){
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      video.srcObject = stream;
      await video.play();
      resizeCanvas();
    } catch (err) {
      console.error('Could not start video stream', err);
    }
  }

  // Resize overlay to match video display size
  function resizeCanvas(){
    const rect = video.getBoundingClientRect();
    overlay.width = Math.round(rect.width);
    overlay.height = Math.round(rect.height);
    // Ensure CSS sizing
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
  }

  window.addEventListener('resize', () => {
    if (video.videoWidth) resizeCanvas();
  });

  video.addEventListener('loadedmetadata', () => {
    resizeCanvas();
    updateDetectionRunning();
  });

  // Drawing helpers
  function clearOverlay(){
    ctx.clearRect(0,0,overlay.width,overlay.height);
  }

  function drawBoxes(boxes, color='#00FF00'){
    ctx.lineWidth = Math.max(2, Math.round(overlay.width / 200));
    ctx.strokeStyle = color;
    ctx.fillStyle = 'rgba(0, 255, 0, 0.05)'; // Light fill for better visibility
    
    boxes.forEach((b, i) => {
      // b should be {x,y,width,height} in video pixel coordinates
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.width, b.height);
      ctx.fill();
      ctx.stroke();
    });
  }

  // Native FaceDetector loop
  async function nativeLoop(){
    if (!faceDetectionEnabled) return;
    if (!detector) return;
    try {
      const faces = await detector.detect(video);
      clearOverlay();
      if (faces && faces.length) {
        // faces[i].boundingBox gives DOMRect-like {x,y,width,height} in pixels relative to video
        // Need to scale bounding boxes from intrinsic video size to displayed size.
        const sx = overlay.width / video.videoWidth;
        const sy = overlay.height / video.videoHeight;
        const boxes = faces.map(f => {
          return {
            x: Math.round(f.boundingBox.x * sx),
            y: Math.round(f.boundingBox.y * sy),
            width: Math.round(f.boundingBox.width * sx),
            height: Math.round(f.boundingBox.height * sy)
          };
        });
        drawBoxes(boxes);
      }
    } catch (err) {
      console.warn('FaceDetector.detect failed, falling back to tracking.js', err);
      // If native detection fails at runtime, attempt to load tracking fallback
      startTrackingFallback();
      return;
    }
    animationId = requestAnimationFrame(nativeLoop);
  }

  // Load tracking.js dynamically and start tracker
  function startTrackingFallback(){
    if (trackingLoaded) {
      startTracking();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tracking@1.1.3/build/tracking-min.js';
    script.onload = () => {
      const script2 = document.createElement('script');
      script2.src = 'https://cdn.jsdelivr.net/npm/tracking@1.1.3/build/data/face-min.js';
      script2.onload = () => {
        trackingLoaded = true;
        startTracking();
      };
      script2.onerror = (e) => console.error('Failed to load tracking face data', e);
      document.head.appendChild(script2);
    };
    script.onerror = (e) => console.error('Failed to load tracking.js', e);
    document.head.appendChild(script);
  }

  function startTracking(){
    if (!tracking) {
      console.error('tracking.js not available');
      return;
    }
    stopAnyDetectionLoops();
    clearOverlay();

    // Create tracker
    try {
      trackingTracker = new tracking.ObjectTracker('face');
      trackingTracker.setInitialScale(4);
      trackingTracker.setStepSize(1.7);
      trackingTracker.setEdgesDensity(0.1);

      trackingTracker.on('track', function(event) {
        clearOverlay();
        if (event.data && event.data.length) {
          const boxes = event.data.map(item => {
            // tracking.js returns x,y,width,height in video pixel coordinates relative to the tracked element
            // Need to scale from video intrinsic size to displayed size
            const sx = overlay.width / video.videoWidth;
            const sy = overlay.height / video.videoHeight;
            return {
              x: Math.round(item.x * sx),
              y: Math.round(item.y * sy),
              width: Math.round(item.width * sx),
              height: Math.round(item.height * sy)
            };
          });
          drawBoxes(boxes, '#FF8C00');
        }
      });

      // Start tracking on the video element. tracking.track accepts CSS selector or element ID.
      tracking.track('#video', trackingTracker);
    } catch (err) {
      console.error('Failed to start tracking.js tracker', err);
    }
  }

  function stopTracking(){
    try {
      if (trackingTracker && tracking) {
        trackingTracker.removeAllListeners && trackingTracker.removeAllListeners('track');
        // tracking.js doesn't provide a clean stop API for trackers started via tracking.track
        // but we can clear the interval listeners by tracking.stop() if present
        if (typeof tracking.stop === 'function') {
          try { tracking.stop(); } catch(e){}
        }
      }
    } catch(e){ /* ignore */ }
    trackingTracker = null;
  }

  function stopAnyDetectionLoops(){
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    stopTracking();
  }

  // Start appropriate detection depending on availability
  function updateDetectionRunning(){
    stopAnyDetectionLoops();
    clearOverlay();
    if (!faceDetectionEnabled) return;

    // Prefer native FaceDetector
    if ('FaceDetector' in window) {
      try {
        detector = new FaceDetector({ fastMode: true, maxDetectedFaces: 5 });
        nativeLoop();
        return;
      } catch (err) {
        console.warn('Failed to construct native FaceDetector', err);
        detector = null;
      }
    }

    // Fallback to tracking.js
    startTrackingFallback();
  }

  // Start things
  startCamera();

  // Expose for debugging
  window.__smartMirror = window.__smartMirror || {};
  window.__smartMirror.startFaceDetection = () => { faceToggle.checked = true; faceToggle.dispatchEvent(new Event('change')); };
  window.__smartMirror.stopFaceDetection = () => { faceToggle.checked = false; faceToggle.dispatchEvent(new Event('change')); };

})();
