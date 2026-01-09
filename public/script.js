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
  let detector = null;
  let trackingLoaded = false;
  let trackingTracker = null;
  let animationId = null;
  let isProcessing = false;
  let lastBoxes = [];
  let stableBoxes = [];
  let frameSkipCounter = 0;
  const FRAME_SKIP = 2;
  const SMOOTHING_FACTOR = 0.3; // Higher = more smoothing (0-1)
  const MIN_CONFIDENCE = 0.7; // Minimum confidence for stable detection
  const BOX_TRANSITION_SPEED = 0.2; // Speed of box size/position interpolation

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
          height: { ideal: 480 },
          frameRate: { ideal: 30 }
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

  // Helper to calculate distance between box centers
  function boxDistance(box1, box2) {
    const center1 = {
      x: box1.x + box1.width / 2,
      y: box1.y + box1.height / 2
    };
    const center2 = {
      x: box2.x + box2.width / 2,
      y: box2.y + box2.height / 2
    };
    return Math.sqrt(
      Math.pow(center1.x - center2.x, 2) + 
      Math.pow(center1.y - center2.y, 2)
    );
  }

  // Smooth interpolation between values
  function lerp(start, end, factor) {
    return start + (end - start) * factor;
  }

  // Match new boxes to existing stable boxes for smooth transitions
  function matchAndSmoothBoxes(newBoxes, stableBoxes) {
    if (stableBoxes.length === 0) return newBoxes;
    if (newBoxes.length === 0) return [];
    
    const matchedBoxes = [];
    const usedNewIndices = new Set();
    
    // Try to match each stable box to a new box
    stableBoxes.forEach(stableBox => {
      let bestMatch = null;
      let bestDistance = Infinity;
      
      newBoxes.forEach((newBox, newIdx) => {
        if (usedNewIndices.has(newIdx)) return;
        
        const distance = boxDistance(stableBox, newBox);
        const sizeSimilarity = Math.abs(
          (stableBox.width * stableBox.height) - 
          (newBox.width * newBox.height)
        ) / (stableBox.width * stableBox.height);
        
        // Combined score (lower is better)
        const score = distance + sizeSimilarity * 100;
        
        if (distance < overlay.width * 0.3 && score < bestDistance) {
          bestDistance = score;
          bestMatch = { box: newBox, idx: newIdx };
        }
      });
      
      if (bestMatch) {
        usedNewIndices.add(bestMatch.idx);
        // Smoothly interpolate to new position/size
        matchedBoxes.push({
          x: lerp(stableBox.x, bestMatch.box.x, BOX_TRANSITION_SPEED),
          y: lerp(stableBox.y, bestMatch.box.y, BOX_TRANSITION_SPEED),
          width: lerp(stableBox.width, bestMatch.box.width, BOX_TRANSITION_SPEED),
          height: lerp(stableBox.height, bestMatch.box.height, BOX_TRANSITION_SPEED)
        });
      } else {
        // No match found for this stable box
        // Optionally fade it out or remove immediately
      }
    });
    
    // Add any new boxes that weren't matched (new faces)
    newBoxes.forEach((newBox, idx) => {
      if (!usedNewIndices.has(idx)) {
        matchedBoxes.push(newBox);
      }
    });
    
    return matchedBoxes;
  }

  // Drawing helpers
  function clearOverlay(){
    ctx.clearRect(0, 0, overlay.width, overlay.height);
  }

  function drawBoxes(boxes){
    if (boxes.length === 0) {
      if (lastBoxes.length > 0) {
        clearOverlay();
        lastBoxes = [];
      }
      stableBoxes = [];
      return;
    }
    
    // Apply additional smoothing to prevent jitter
    if (stableBoxes.length > 0) {
      boxes = matchAndSmoothBoxes(boxes, stableBoxes);
    }
    
    // Clear only the area that might have previous boxes
    if (lastBoxes.length > 0) {
      lastBoxes.forEach(box => {
        // Clear with some padding
        ctx.clearRect(
          Math.max(0, box.x - 10),
          Math.max(0, box.y - 10),
          box.width + 20,
          box.height + 20
        );
      });
    }
    
    // Draw new boxes with anti-aliasing
    ctx.lineWidth = Math.max(2, Math.round(overlay.width / 200));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    
    // Draw with gradient for better visual appeal
    const gradient = ctx.createLinearGradient(0, 0, overlay.width, 0);
    gradient.addColorStop(0, '#00FFAA');
    gradient.addColorStop(1, '#00AAFF');
    
    ctx.strokeStyle = gradient;
    ctx.fillStyle = 'rgba(0, 170, 255, 0.03)';
    
    boxes.forEach((b) => {
      // Draw with rounded corners
      const radius = Math.min(b.width, b.height) * 0.1;
      
      ctx.beginPath();
      ctx.moveTo(b.x + radius, b.y);
      ctx.lineTo(b.x + b.width - radius, b.y);
      ctx.quadraticCurveTo(b.x + b.width, b.y, b.x + b.width, b.y + radius);
      ctx.lineTo(b.x + b.width, b.y + b.height - radius);
      ctx.quadraticCurveTo(b.x + b.width, b.y + b.height, b.x + b.width - radius, b.y + b.height);
      ctx.lineTo(b.x + radius, b.y + b.height);
      ctx.quadraticCurveTo(b.x, b.y + b.height, b.x, b.y + b.height - radius);
      ctx.lineTo(b.x, b.y + radius);
      ctx.quadraticCurveTo(b.x, b.y, b.x + radius, b.y);
      ctx.closePath();
      
      ctx.fill();
      ctx.stroke();
    });
    
    lastBoxes = boxes;
    stableBoxes = boxes;
  }

  // Native FaceDetector loop
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
      if (faceDetectionEnabled) {
        if (faces && faces.length) {
          const sx = overlay.width / video.videoWidth;
          const sy = overlay.height / video.videoHeight;
          const boxes = faces.map(f => {
            // Basic box
            const x = Math.round(f.boundingBox.x * sx);
            const y = Math.round(f.boundingBox.y * sy);
            const width = Math.round(f.boundingBox.width * sx);
            const height = Math.round(f.boundingBox.height * sy);
            
            // Add consistent margin (15% of average dimension)
            const avgDim = (width + height) / 2;
            const margin = avgDim * 0.15;
            
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
      console.warn('FaceDetector.detect failed:', err);
      startTrackingFallback();
      isProcessing = false;
      return;
    }
    
    isProcessing = false;
    animationId = requestAnimationFrame(nativeLoop);
  }

  // Load tracking.js dynamically
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
      document.head.appendChild(script2);
    };
    document.head.appendChild(script);
  }

  function startTracking(){
    if (!tracking) {
      console.error('tracking.js not available');
      return;
    }
    stopAnyDetectionLoops();
    clearOverlay();

    try {
      trackingTracker = new tracking.ObjectTracker('face');
      trackingTracker.setInitialScale(4);
      trackingTracker.setStepSize(2);
      trackingTracker.setEdgesDensity(0.07);

      let lastTime = 0;
      const trackingInterval = 150; // Increased interval for more stability
      
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
            
            // Consistent margin
            const avgDim = (width + height) / 2;
            const margin = avgDim * 0.15;
            
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
    } catch(e){}
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
    stableBoxes = [];
    clearOverlay();
  }

  function updateDetectionRunning(){
    stopAnyDetectionLoops();
    clearOverlay();
    if (!faceDetectionEnabled) return;

    if ('FaceDetector' in window) {
      try {
        detector = new FaceDetector({ 
          fastMode: true, 
          maxDetectedFaces: 2
        });
        nativeLoop();
        return;
      } catch (err) {
        detector = null;
      }
    }

    startTrackingFallback();
  }

  // Start things
  startCamera();

  // Expose for debugging
  window.__smartMirror = {
    startFaceDetection: () => { 
      faceToggle.checked = true; 
      faceToggle.dispatchEvent(new Event('change')); 
    },
    stopFaceDetection: () => { 
      faceToggle.checked = false; 
      faceToggle.dispatchEvent(new Event('change')); 
    },
    setSmoothing: (factor) => {
      if (factor >= 0 && factor <= 1) {
        SMOOTHING_FACTOR = factor;
      }
    }
  };

})();
