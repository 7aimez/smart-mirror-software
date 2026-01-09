// script.js - mirror fullscreen camera with optional face detection overlay

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const faceToggle = document.getElementById('faceToggle');
const ctx = overlay.getContext('2d');

let detector = null;
let detecting = false;
let rafId = null;

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    video.srcObject = stream;
    await video.play();
    resizeCanvas();
  } catch (err) {
    console.error('Unable to access camera:', err);
  }
}

function resizeCanvas() {
  const vw = video.videoWidth || video.clientWidth || window.innerWidth;
  const vh = video.videoHeight || video.clientHeight || window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  overlay.width = vw * dpr;
  overlay.height = vh * dpr;
  overlay.style.width = `${vw}px`;
  overlay.style.height = `${vh}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale drawing to device pixels
}

function clearOverlay() {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
}

function drawDetections(detections) {
  clearOverlay();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0, 255, 128, 0.9)';
  ctx.fillStyle = 'rgba(0, 255, 128, 0.25)';

  // video is mirrored via CSS; mirror the drawing horizontally so boxes align visually
  const vw = overlay.width / (window.devicePixelRatio || 1);

  detections.forEach(det => {
    const box = det.boundingBox || det.box || det; // support different detector outputs
    const x = box.x || box.left || 0;
    const y = box.y || box.top || 0;
    const w = box.width || box.right - x || box.width || 0;
    const h = box.height || box.bottom - y || box.height || 0;

    // mirrored x
    const mx = vw - (x + w);

    ctx.beginPath();
    ctx.rect(mx, y, w, h);
    ctx.fill();
    ctx.stroke();
  });
}

async function initFaceDetectorIfAvailable() {
  if ('FaceDetector' in window) {
    try {
      detector = new FaceDetector({ fastMode: true, maxDetectedFaces: 5 });
      console.info('Using native FaceDetector API');
    } catch (err) {
      console.warn('FaceDetector initialization failed:', err);
      detector = null;
    }
  } else {
    console.warn('FaceDetector API not available in this browser. Face detection disabled.');
    detector = null;
  }
}

async function detectionLoop() {
  if (!detecting || !detector) {
    clearOverlay();
    return;
  }

  try {
    const detections = await detector.detect(video);
    drawDetections(detections);
  } catch (err) {
    console.error('Face detection error:', err);
  }

  rafId = requestAnimationFrame(detectionLoop);
}

function startDetection() {
  if (!detector) {
    alert('Face detection is not available in this browser.');
    faceToggle.checked = false;
    return;
  }
  if (!detecting) {
    detecting = true;
    detectionLoop();
  }
}

function stopDetection() {
  detecting = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  clearOverlay();
}

faceToggle.addEventListener('change', () => {
  if (faceToggle.checked) startDetection(); else stopDetection();
});

window.addEventListener('resize', resizeCanvas);
video.addEventListener('loadedmetadata', resizeCanvas);

// Stop detection when page hidden to save CPU
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopDetection();
});

(async function init() {
  await startCamera();
  await initFaceDetectorIfAvailable();
  // If face detector isn't available, keep the toggle visible but disabled
  if (!detector) {
    faceToggle.disabled = true;
    faceToggle.title = 'Face detection not supported in this browser';
  }
})();
