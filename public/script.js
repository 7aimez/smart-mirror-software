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
  let isProcessing = false;
  let lastBoxes = [];
  let frameSkipCounter = 0;
  const FRAME_SKIP = 2; // Process every 3rd frame for better performance

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
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 }
        }, 
        audio: false 
      });
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
    ctx.clearRect(0, 0, overlay.width, overlay.height);
  }

  function drawBoxes(boxes){
    if (boxes.length === 0) {
      clearOverlay();
      return;
    }
    
    // Clear only the area that might have previous boxes
    if (lastBoxes.length > 0) {
      lastBoxes.forEach(box => {
        // Clear a slightly larger area to ensure no artifacts
        ctx.clearRect(
          Math.max(0, box.x - 5),
          Math.max(0, box.y - 5),
          box.width + 10,
          box.height + 10
        );
      });
    }
    
    // Draw new boxes
    ctx.lineWidth = Math.max(2, Math.round(overlay.width / 200));
    ctx.strokeStyle = '#00FF00';
    ctx.fillStyle = 'rgba(0, 255, 0, 0.05)'; // Light fill for better visibility
    
    boxes.forEach((b, i) => {
      // Draw filled rectangle with border
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.width, b.height);
      ctx.fill();
      ctx.stroke();
    });
    
    lastBoxes = boxes;
  }

  // Native FaceDetector loop with debouncing
  async function nativeLoop(){
    if (!faceDetectionEnabled || !detector || isProcessing) {
      animationId = requestAnimationFrame(nativeLoop);
      return;
    }
    
    frameSkipCounter = (frameSkipCounter + 1) % (FRAME_SKIP + 1);
    if (frameSkipCounter !== 0) {
      animationId = requestAnimationFrame(nativeLoop);
      return;
    }
    
    isProcessing = true;
    
    try {
      const faces = await detector.detect(video);
      if (faceDetectionEnabled) { // Check again in case disabled during async operation
        if (faces && faces.length) {
          const sx = overlay.width / video.videoWidth;
          const sy = overlay.height / video.videoHeight;
          const boxes = faces.map(f => {
            const x = Math.round(f.boundingBox.x * sx);
            const y = Math.round(f.boundingBox.y * sy);
            const width = Math.round(f.boundingBox.width * sx);
            const height = Math.round(f.boundingBox.height * sy);
            
            // Add some margin around the detected face
            const margin = Math.min(width, height) * 0.1;
            return {
              x: Math.max(0, x - margin),
              y: Math.max(0, y - margin),
              width: width + margin * 2,
              height: height + margin * 2
            };
          });
          drawBoxes(boxes);
        } else {
          drawBoxes([]);
        }
      }
    } catch (err) {
      console.warn('FaceDetector.detect failed, falling back to tracking.js', err);
      // If native detection fails at runtime, attempt to load tracking fallback
      startTrackingFallback();
      isProcessing = false;
      return;
    }
    
    isProcessing = false;
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

    // Create tracker with optimized settings
    try {
      trackingTracker = new tracking.ObjectTracker('face');
      trackingTracker.setInitialScale(4);
      trackingTracker.setStepSize(2); // Increased step size for better performance
      trackingTracker.setEdgesDensity(0.07); // Reduced for better performance

      // Use requestAnimationFrame to throttle tracking.js updates
      let lastTime = 0;
      const trackingInterval = 100; // ms between updates
      
      const throttledTrack = (currentTime) => {
        if (!faceDetectionEnabled || !trackingTracker) return;
        
        if (currentTime - lastTime >= trackingInterval) {
          try {
            tracking.track('#video', trackingTracker);
            lastTime = currentTime;
          } catch(e) {
            console.warn('Tracking error:', e);
          }
        }
        
        if (faceDetectionEnabled) {
          requestAnimationFrame(throttledTrack);
        }
      };

      trackingTracker.on('track', function(event) {
        if (!faceDetectionEnabled) return;
        
        if (event.data && event.data.length) {
          const sx = overlay.width / video.videoWidth;
          const sy = overlay.height / video.videoHeight;
          const boxes = event.data.map(item => {
            const x = Math.round(item.x * sx);
            const y = Math.round(item.y * sy);
            const width = Math.round(item.width * sx);
            const height = Math.round(item.height * sy);
            
            // Add some margin around the detected face
            const margin = Math.min(width, height) * 0.1;
            return {
              x: Math.max(0, x - margin),
              y: Math.max(0, y - margin),
              width: width + margin * 2,
              height: height + margin * 2
            };
          });
          drawBoxes(boxes);
        } else {
          drawBoxes([]);
        }
      });

      // Start the throttled tracking loop
      requestAnimationFrame(throttledTrack);
    } catch (err) {
      console.error('Failed to start tracking.js tracker', err);
    }
  }

  function stopTracking(){
    try {
      if (trackingTracker && tracking) {
        trackingTracker.removeAllListeners && trackingTracker.removeAllListeners('track');
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
    isProcessing = false;
    lastBoxes = [];
    clearOverlay();
  }

  // Start appropriate detection depending on availability
  function updateDetectionRunning(){
    stopAnyDetectionLoops();
    clearOverlay();
    if (!faceDetectionEnabled) return;

    // Prefer native FaceDetector
    if ('FaceDetector' in window) {
      try {
        detector = new FaceDetector({ 
          fastMode: true, 
          maxDetectedFaces: 2 // Reduced for better performance
        });
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
  window.__smartMirror.startFaceDetection = () => { 
    faceToggle.checked = true; 
    faceToggle.dispatchEvent(new Event('change')); 
  };
  window.__smartMirror.stopFaceDetection = () => { 
    faceToggle.checked = false; 
    faceToggle.dispatchEvent(new Event('change')); 
  };

})();
