document.addEventListener('DOMContentLoaded', () => {
  const preview = document.getElementById('camera-preview');
  const playback = document.getElementById('video-playback');
  const recordBtn = document.getElementById('record-btn');
  const downloadBtn = document.getElementById('download-btn');
  const resetBtn = document.getElementById('reset-btn');
  const statusText = document.getElementById('status-text');
  const countdownProgress = document.getElementById('countdown-progress');
  const progressFill = document.getElementById('progress-fill');
  const seasonSelect = document.getElementById('season-select');
  const objektSelect = document.getElementById('objekt-select');
  const objektVideo = document.getElementById('objekt-video');
  const flipBtn = document.getElementById('flip-camera-btn');

  let stream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecording = false;
  let isCountingDown = false;
  let countdownTimerId = null;
  let activeMicStream = null;
  let objektState = { x: 0, y: 0, scale: 1, rotation: 0 };
  let startTouches = [];
  let initialObjektState = null;
  let selectedObjektName = "Cosmo";
  let currentFacingMode = 'environment';
  let statusTimeout = null;

  // Official tripleS S-number ordering
  const memberOrder = [
    "seoyeon", "hyerin", "jiwoo", "chaeyeon", "yooyeon", "soomin", "nakyoung", "yubin",
    "kaede", "dahyun", "kotone", "yeonji", "nien", "sohyun", "xinyu", "mayu",
    "lynn", "joobin", "hayeon", "shion", "chaewon", "sullin", "seoah", "jiyeon"
  ];

  // Map of seasons and videos
  const videoData = { "Binary02 501z": ["binary02-chaewon-501z.mp4", "binary02-chaeyeon-501z.mp4", "binary02-dahyun-501z.mp4", "binary02-hayeon-501z.mp4", "binary02-hyerin-501z.mp4", "binary02-jiwoo-501z.mp4", "binary02-jiyeon-501z.mp4", "binary02-joobin-501z.mp4", "binary02-kaede-501z.mp4", "binary02-kotone-501z.mp4", "binary02-lynn-501z.mp4", "binary02-mayu-501z.mp4", "binary02-nakyoung-501z.mp4", "binary02-nien-501z.mp4", "binary02-seoah-501z.mp4", "binary02-seoyeon-501z.mp4", "binary02-shion-501z.mp4", "binary02-sohyun-501z.mp4", "binary02-soomin-501z.mp4", "binary02-sullin-501z.mp4", "binary02-xinyu-501z.mp4", "binary02-yeonji-501z.mp4", "binary02-yooyeon-501z.mp4", "binary02-yubin-501z.mp4"], "Binary02 502z": ["binary02-chaewon-502z.mp4", "binary02-chaeyeon-502z.mp4", "binary02-dahyun-502z.mp4", "binary02-hayeon-502z.mp4", "binary02-hyerin-502z.mp4", "binary02-jiwoo-502z.mp4", "binary02-jiyeon-502z.mp4", "binary02-joobin-502z.mp4", "binary02-kaede-502z.mp4", "binary02-kotone-502z.mp4", "binary02-lynn-502z.mp4", "binary02-mayu-502z.mp4", "binary02-nakyoung-502z.mp4", "binary02-nien-502z.mp4", "binary02-seoah-502z.mp4", "binary02-seoyeon-502z.mp4", "binary02-shion-502z.mp4", "binary02-sohyun-502z.mp4", "binary02-soomin-502z.mp4", "binary02-sullin-502z.mp4", "binary02-xinyu-502z.mp4", "binary02-yeonji-502z.mp4", "binary02-yooyeon-502z.mp4", "binary02-yubin-502z.mp4"] };

  // Populate seasons
  Object.keys(videoData).forEach(season => {
    const option = document.createElement('option');
    option.value = season;
    option.textContent = season;
    seasonSelect.appendChild(option);
  });

  // Handle season selection to populate objekte
  seasonSelect.addEventListener('change', (e) => {
    // Clear objekt select
    objektSelect.innerHTML = '<option value="">Select an Objekt</option>';
    objektVideo.removeAttribute('crossOrigin');
    objektVideo.src = "";
    selectedObjektName = "Cosmo";

    // Reset multi-touch state
    objektState = { x: 0, y: 0, scale: 1, rotation: 0 };
    objektVideo.style.transform = `translate(0px, 0px) rotate(0deg) scale(1)`;

    const season = e.target.value;
    if (season && videoData[season]) {
      let optionsData = videoData[season].map(fileName => {
        const namePart = fileName.split('-')[1]; // chaewon
        const displayName = namePart ? namePart.charAt(0).toUpperCase() + namePart.slice(1) : fileName;
        return { fileName, namePart, displayName };
      });

      // Sort according to official member S-number
      optionsData.sort((a, b) => {
        const indexA = memberOrder.indexOf(a.namePart);
        const indexB = memberOrder.indexOf(b.namePart);
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a.displayName.localeCompare(b.displayName); // fallback
      });

      optionsData.forEach(item => {
        const option = document.createElement('option');
        option.value = `videos/tripleS/${season}/${item.fileName}`;
        option.textContent = item.displayName;
        option.dataset.name = item.displayName;
        objektSelect.appendChild(option);
      });
    }
  });

  // Handle video selection
  objektSelect.addEventListener('change', (e) => {
    const selectedOption = e.target.options[e.target.selectedIndex];
    if (e.target.value) {
      // Required to prevent canvas tainting on GitHub pages / CDNs
      objektVideo.crossOrigin = "anonymous";
      objektVideo.src = e.target.value;
      selectedObjektName = selectedOption.dataset.name;
    } else {
      objektVideo.removeAttribute('crossOrigin');
      objektVideo.src = "";
      selectedObjektName = "Cosmo";
    }
  });

  // Canvas for recording
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  let animationFrameId;
  let canvasStream = null;
  let lastRenderTime = 0;
  let cachedLayout = null;

  window.addEventListener('resize', () => { cachedLayout = null; });
  window.addEventListener('orientationchange', () => { cachedLayout = null; });

  function renderCanvas(timestamp) {
    if (!timestamp) timestamp = performance.now();

    // Throttle rendering: 30 FPS when recording/counting down, 1 FPS when idle
    const targetFPS = (isRecording || isCountingDown) ? 30 : 1;
    const frameInterval = 1000 / targetFPS;

    if (timestamp - lastRenderTime < frameInterval) {
      animationFrameId = requestAnimationFrame(renderCanvas);
      return;
    }
    lastRenderTime = timestamp;

    // Force the output square resolution to be a crisp HD 1080x1080
    const outputSize = 1080;
    if (canvas.width !== outputSize) {
      canvas.width = outputSize;
      canvas.height = outputSize;
    }

    // Always draw camera even if not recording, so stream is valid
    if (canvas.width > 0 && canvas.height > 0) {
      // Create a clipping mask with a 36px (12px * 3) radius for the entire 1080p recording
      ctx.clearRect(0, 0, outputSize, outputSize);
      ctx.fillStyle = "#111111"; // Match the dark photocard background
      ctx.fillRect(0, 0, outputSize, outputSize);

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(0, 0, outputSize, outputSize, 36);
      ctx.clip();

      // Crop the center of the camera feed and mathematically fit it to the 1080p square
      const sourceSize = Math.min(preview.videoWidth || 1080, preview.videoHeight || 1920);
      const sx = (preview.videoWidth - sourceSize) / 2;
      const sy = (preview.videoHeight - sourceSize) / 2;

      if (currentFacingMode === 'user') {
        // Mirror the camera feed horizontally for the selfie camera
        ctx.save();
        ctx.translate(outputSize, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(preview, sx, sy, sourceSize, sourceSize, 0, 0, outputSize, outputSize);
        ctx.restore();
      } else {
        // Draw back camera normally
        ctx.drawImage(preview, sx, sy, sourceSize, sourceSize, 0, 0, outputSize, outputSize);
      }

      // Draw PIP video frame permanently on top
      if (!objektVideo.hidden) {
        if (!cachedLayout) {
          const photoCard = document.querySelector('.photocard');
          const PIPStyle = window.getComputedStyle(objektVideo);
          cachedLayout = {
            photoCardWidth: photoCard.clientWidth,
            width: parseFloat(PIPStyle.width),
            height: parseFloat(PIPStyle.height),
            left: parseFloat(PIPStyle.left),
            bottom: parseFloat(PIPStyle.bottom)
          };
        }

        const canvasScaleRatio = outputSize / cachedLayout.photoCardWidth;

        // Grasp the mathematically perfect layout dimensions computed by the live CSS engine
        const cssWidth = cachedLayout.width;
        const cssHeight = cachedLayout.height;

        // CSS left/bottom are strictly read in pixels to perfectly position on any device
        const cssLeft = cachedLayout.left;
        const cssBottom = cachedLayout.bottom;

        // Calculate exact 1080p canvas dimensions utilizing the 1:1 CSS bounding box 
        const bw = cssWidth * canvasScaleRatio;
        const bh = cssHeight * canvasScaleRatio;

        const bx = cssLeft * canvasScaleRatio;
        const by = outputSize - bh - (cssBottom * canvasScaleRatio);

        ctx.save();

        // Move to the exact geometric center of the PIP's relative layout position
        const cx = bx + (bw / 2);
        const cy = by + (bh / 2);
        ctx.translate(cx, cy);

        // Apply interactive multitouch transforms natively mapped into 1080p canvas space
        ctx.translate(objektState.x * canvasScaleRatio, objektState.y * canvasScaleRatio);
        ctx.rotate(objektState.rotation * Math.PI / 180);
        ctx.scale(objektState.scale, objektState.scale);

        // Draw the drop shadow matching the CSS box-shadow
        ctx.save();
        ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
        ctx.shadowBlur = 30;       // 10px CSS * 3 = 30px
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 12;    // 4px CSS * 3 = 12px
        ctx.fillStyle = "black";
        ctx.beginPath();
        ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 24);
        ctx.fill();
        ctx.restore();

        // Draw the inner video clipped safely inside its own rounded corners
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 24); // 8px * 3 = 24px radius
        ctx.clip();

        if (objektVideo.readyState >= 2) {
          // Replicate CSS object-fit: cover natively in HTML5 Canvas
          const vw = objektVideo.videoWidth;
          const vh = objektVideo.videoHeight;
          const videoRatio = vw / vh;
          const targetRatio = bw / bh;

          let drawW = vw;
          let drawH = vh;
          let drawX = 0;
          let drawY = 0;

          if (videoRatio > targetRatio) {
            drawH = vw / targetRatio;
            drawY = (vh - drawH) / 2;
          } else {
            drawW = vh * targetRatio;
            drawX = (vw - drawW) / 2;
          }
          ctx.drawImage(objektVideo, drawX, drawY, drawW, drawH, -bw / 2, -bh / 2, bw, bh);
        }
        ctx.restore(); // Exit video clipping path

        // Draw the white frame ON TOP of the video so it doesn't get covered
        ctx.beginPath();
        ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 24);
        ctx.lineWidth = 8; // 2.5px CSS * 3 roughly
        ctx.strokeStyle = "white";
        ctx.stroke();

        ctx.restore(); // Exit full PIP transform
      }

      // Restore outer photocard clipping region
      ctx.restore();
    }
    animationFrameId = requestAnimationFrame(renderCanvas);
  }

  // Initialize Camera
  async function initCamera() {
    if (stream) {
      // Stop the existing stream immediately to transition to the new camera
      stream.getTracks().forEach(track => track.stop());
    }

    // Toggle the UI mirror effect on the preview
    if (currentFacingMode === 'user') {
      preview.classList.add('mirrored');
    } else {
      preview.classList.remove('mirrored');
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: currentFacingMode,
          width: { ideal: 1080 },
          height: { ideal: 1920 }
        },
        audio: false // Do not request mic access on idle preview
      });
      preview.srcObject = stream;

      // Enable record button once stream is ready
      preview.onloadedmetadata = () => {
        recordBtn.disabled = false;
        statusText.textContent = "Ready to record";
        statusText.style.opacity = '1';

        clearTimeout(statusTimeout);
        statusTimeout = setTimeout(() => {
          if (!isRecording) statusText.style.opacity = '0';
        }, 2000);

        // Start rendering canvas immediately so captureStream won't be blank
        if (!animationFrameId) {
          renderCanvas();
        }
      };
    } catch (err) {
      console.error("Error accessing camera: ", err);
      statusText.textContent = "Camera access denied or unavailable.";
    }
  }

  initCamera();

  // --- Multi-touch Gesture Handling ---
  objektVideo.addEventListener('touchstart', (e) => {
    if (isRecording || objektVideo.hidden) return;
    e.preventDefault(); // Stop webpage scrolling
    const touches = Array.from(e.touches);
    startTouches = touches.map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
    initialObjektState = { ...objektState };
  }, { passive: false });

  objektVideo.addEventListener('touchmove', (e) => {
    if (!startTouches.length || isRecording) return;
    e.preventDefault();
    const touches = Array.from(e.touches);

    if (touches.length === 1 && startTouches.length === 1) {
      // 1-Finger drag (Panning)
      const dx = touches[0].clientX - startTouches[0].x;
      const dy = touches[0].clientY - startTouches[0].y;
      objektState.x = initialObjektState.x + dx;
      objektState.y = initialObjektState.y + dy;
    }
    else if (touches.length >= 2 && startTouches.length >= 2) {
      // 2-Finger Pitch and Rotate (and dragging simultaneously)
      const currentCenter = {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2
      };
      const startCenter = {
        x: (startTouches[0].x + startTouches[1].x) / 2,
        y: (startTouches[0].y + startTouches[1].y) / 2
      };

      const dx = currentCenter.x - startCenter.x;
      const dy = currentCenter.y - startCenter.y;

      const currentDist = Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
      const startDist = Math.hypot(startTouches[1].x - startTouches[0].x, startTouches[1].y - startTouches[0].y);
      const currentAngle = Math.atan2(touches[1].clientY - touches[0].clientY, touches[1].clientX - touches[0].clientX) * 180 / Math.PI;
      const startAngle = Math.atan2(startTouches[1].y - startTouches[0].y, startTouches[1].x - startTouches[0].x) * 180 / Math.PI;

      const scaleDelta = startDist > 0 ? (currentDist / startDist) : 1;
      const angleDelta = currentAngle - startAngle;

      objektState.x = initialObjektState.x + dx;
      objektState.y = initialObjektState.y + dy;
      objektState.scale = initialObjektState.scale * scaleDelta;
      objektState.rotation = initialObjektState.rotation + angleDelta;
    }

    // Push the math directly into UI rendering
    objektVideo.style.transform = `translate(${objektState.x}px, ${objektState.y}px) rotate(${objektState.rotation}deg) scale(${objektState.scale})`;
  }, { passive: false });

  objektVideo.addEventListener('touchend', (e) => {
    startTouches = [];
  });


  // --- Camera & Recording Controls ---
  flipBtn.addEventListener('click', () => {
    if (isRecording) {
      console.warn("Cannot flip camera while actively recording.");
      return;
    }
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

    // Disable temporarily
    flipBtn.disabled = true;
    setTimeout(() => { flipBtn.disabled = false; }, 800);

    initCamera();
  });

  // Start/Stop/Cancel Recording
  recordBtn.addEventListener('click', () => {
    if (isCountingDown) {
      cancelCountdown();
    } else if (!isRecording) {
      startRecording();
    } else {
      stopRecording();
    }
  });

  function cancelCountdown() {
    clearInterval(countdownTimerId);
    isCountingDown = false;
    recordBtn.classList.remove('recording');

    statusText.textContent = "Ready to record";
    statusText.style.opacity = '1';
    clearTimeout(statusTimeout);
    statusTimeout = setTimeout(() => {
      if (!isRecording && !isCountingDown) statusText.style.opacity = '0';
    }, 2000);

    // Restore UI
    seasonSelect.classList.remove('hidden');
    objektSelect.classList.remove('hidden');
    flipBtn.classList.remove('hidden');
    countdownProgress.classList.add('hidden');

    // Destroy microphone connection to halt background tracking
    if (activeMicStream) {
      activeMicStream.getTracks().forEach(track => track.stop());
      activeMicStream = null;
    }
  }

  async function startRecording() {
    recordedChunks = [];

    statusText.textContent = "Connecting Microphone...";
    statusText.style.opacity = '1';
    recordBtn.disabled = true;

    let micStream = null;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      activeMicStream = micStream;
    } catch (err) {
      console.warn("Could not get microphone access: ", err);
    }
    recordBtn.disabled = false;

    // Turn the button red and make it stoppable
    isCountingDown = true;
    recordBtn.classList.add('recording');

    try {
      // Mix audio tracks from the newly spawned dedicated micStream
      const audioTracks = micStream ? micStream.getAudioTracks() : [];
      let combinedStream;

      try {
        if (!canvasStream) {
          canvasStream = canvas.captureStream(30);
        }
        combinedStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...audioTracks
        ]);

        // Attach the micStream physically so the stop function can kill it
        combinedStream.micStream = micStream;
      } catch (e) {
        console.error("Stream build failed:", e);
        // Fallback to raw camera stream if canvas fails
        combinedStream = stream;
      }

      // Use mp4/webm depending on browser support. Enforce 2.5 Mbps compressed bitrate to maximize phone storage.
      let options = { mimeType: 'video/webm; codecs=vp9,opus', videoBitsPerSecond: 2500000 };
      if (MediaRecorder.isTypeSupported('video/mp4')) {
        options = { mimeType: 'video/mp4', videoBitsPerSecond: 2500000 };
      } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp8,opus')) {
        options = { mimeType: 'video/webm; codecs=vp8,opus', videoBitsPerSecond: 2500000 };
      } else if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm', videoBitsPerSecond: 2500000 };
      }

      mediaRecorder = new MediaRecorder(combinedStream, options);
    } catch (e) {
      console.error('Exception while creating MediaRecorder:', e);
      statusText.textContent = "Recording not supported.";
      return;
    }

    mediaRecorder.onstop = (event) => {
      // Determine the actual type recorded to keep playback compatible
      const type = mediaRecorder.mimeType || 'video/webm';
      const blob = new Blob(recordedChunks, { type });
      const videoURL = URL.createObjectURL(blob);
      playback.src = videoURL;

      // UI transitions
      preview.classList.add('hidden');
      playback.classList.remove('hidden');
      objektVideo.style.opacity = '0'; // Temporarily hide during playback
      objektVideo.style.pointerEvents = 'none'; // Prevent invisible Fancam from blocking Play/Pause clicks
      recordBtn.classList.add('hidden');
      downloadBtn.classList.remove('hidden');
      resetBtn.classList.remove('hidden');
      statusText.textContent = "Previewing Recording";
      statusText.style.opacity = '1';
    };

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    const beginFilming = () => {
      isCountingDown = false;
      countdownProgress.classList.add('hidden');

      // Hide UI selections when filming
      seasonSelect.classList.add('hidden');
      objektSelect.classList.add('hidden');
      flipBtn.classList.add('hidden');

      const finalizeStart = () => {
        mediaRecorder.start();
        isRecording = true;
        recordBtn.classList.add('recording');
        statusText.textContent = "Recording...";
        statusText.style.opacity = '1';
        renderCanvas();
      };

      if (objektVideo.src) {
        objektVideo.currentTime = 0;

        // Wait for the video element to actually emit frames before starting the recorder
        const onPlaying = () => {
          objektVideo.removeEventListener('playing', onPlaying);
          finalizeStart();
        };

        objektVideo.addEventListener('playing', onPlaying);
        objektVideo.play();

        // Auto-stop recording when the objekt video finishes
        objektVideo.onended = () => {
          if (isRecording) {
            stopRecording();
          }
        };
      } else {
        finalizeStart();
      }
    };

    // 3-second countdown before filming
    let count = 3;
    clearTimeout(statusTimeout);
    statusText.style.opacity = '1';
    statusText.textContent = `Starting in ${count}...`;

    // Trigger visual progress bar
    countdownProgress.classList.remove('hidden');
    progressFill.style.transition = 'none';
    progressFill.style.width = '0%';
    void progressFill.offsetWidth; // Force DOM reflow to restart animation
    progressFill.style.transition = 'width 3s linear';
    progressFill.style.width = '100%';

    // Hide menus early so they don't distract during countdown
    seasonSelect.classList.add('hidden');
    objektSelect.classList.add('hidden');
    flipBtn.classList.add('hidden');

    countdownTimerId = setInterval(() => {
      count--;
      if (count > 0) {
        statusText.textContent = `Starting in ${count}...`;
      } else {
        clearInterval(countdownTimerId);
        beginFilming();
      }
    }, 1000);
  }

  function stopRecording() {
    mediaRecorder.stop();
    isRecording = false;
    recordBtn.classList.remove('recording');

    // Turn off the microphone hardware completely to remove background tracking
    if (mediaRecorder.stream && mediaRecorder.stream.micStream) {
      mediaRecorder.stream.micStream.getTracks().forEach(track => track.stop());
    }

    if (!objektVideo.hidden) {
      objektVideo.pause();
    }
    // We no longer cancel AnimationFrame so canvas keeps ticking in background
  }

  // Reset to take another video
  resetBtn.addEventListener('click', () => {
    playback.pause();
    playback.src = "";
    preview.classList.remove('hidden');
    playback.classList.add('hidden');
    objektVideo.style.opacity = '1';
    objektVideo.style.pointerEvents = 'auto'; // Re-enable multitouch controls for next record

    recordBtn.classList.remove('hidden');
    downloadBtn.classList.add('hidden');
    resetBtn.classList.add('hidden');

    // Restore UI selections
    seasonSelect.classList.remove('hidden');
    objektSelect.classList.remove('hidden');
    flipBtn.classList.remove('hidden');

    statusText.textContent = "Ready to record";
    setTimeout(() => { statusText.style.opacity = '0'; }, 2000);
    recordedChunks = [];
  });

  // Download or Share the video
  downloadBtn.addEventListener('click', async () => {
    const type = mediaRecorder ? mediaRecorder.mimeType : 'video/mp4';
    const filename = `cosmo-${selectedObjektName.toLowerCase()}-${Date.now()}.mp4`;
    const blob = new Blob(recordedChunks, { type });

    // Attempt to use native Web Share API (Mobile: Saves directly to Camera Roll/Albums)
    const file = new File([blob], filename, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'Cosmo Recording'
        });
        return; // Success, exit out
      } catch (err) {
        console.warn("Share API failed or was cancelled:", err);
        // Fallback to normal download if share sheet fails
      }
    }

    // Fallback logic for Desktop or unsupported browsers
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    document.body.appendChild(a);
    a.style = 'display: none';
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  });
});
