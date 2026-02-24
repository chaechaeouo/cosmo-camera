document.addEventListener('DOMContentLoaded', () => {
  const preview = document.getElementById('camera-preview');
  const playback = document.getElementById('video-playback');
  const recordBtn = document.getElementById('record-btn');
  const downloadBtn = document.getElementById('download-btn');
  const resetBtn = document.getElementById('reset-btn');
  const statusText = document.getElementById('status-text');
  const objektSelect = document.getElementById('objekt-select');
  const objektVideo = document.getElementById('objekt-video');
  const flipBtn = document.getElementById('flip-camera-btn');

  let stream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecording = false;
  let selectedObjektName = "Cosmo";
  let currentFacingMode = 'user';

  // List of videos
  const videos = [
    "binary02-chaewon-501z.mp4",
    "binary02-chaeyeon-501z.mp4",
    "binary02-dahyun-501z.mp4",
    "binary02-hayeon-501z.mp4",
    "binary02-hyerin-501z.mp4",
    "binary02-jiwoo-501z.mp4",
    "binary02-jiyeon-501z.mp4",
    "binary02-joobin-501z.mp4",
    "binary02-kaede-501z.mp4",
    "binary02-kotone-501z.mp4",
    "binary02-lynn-501z.mp4",
    "binary02-mayu-501z.mp4",
    "binary02-nakyoung-501z.mp4",
    "binary02-nien-501z.mp4",
    "binary02-seoah-501z.mp4",
    "binary02-seoyeon-501z.mp4",
    "binary02-shion-501z.mp4",
    "binary02-sohyun-501z.mp4",
    "binary02-soomin-501z.mp4",
    "binary02-sullin-501z.mp4",
    "binary02-xinyu-501z.mp4",
    "binary02-yeonji-501z.mp4",
    "binary02-yooyeon-501z.mp4",
    "binary02-yubin-501z.mp4"
  ];

  videos.forEach(fileName => {
    // e.g. "binary02-chaewon-501z.mp4"
    const namePart = fileName.split('-')[1]; // chaewon
    const displayName = namePart ? namePart.charAt(0).toUpperCase() + namePart.slice(1) : fileName;

    const option = document.createElement('option');
    option.value = `videos/tripleS/Binary02 501z/${fileName}`;
    option.textContent = displayName;
    option.dataset.name = displayName;
    objektSelect.appendChild(option);
  });

  // Handle video selection
  objektSelect.addEventListener('change', (e) => {
    const selectedOption = e.target.options[e.target.selectedIndex];
    if (e.target.value) {
      // Required to prevent canvas tainting on GitHub pages / CDNs
      objektVideo.crossOrigin = "anonymous";
      objektVideo.src = e.target.value;
      objektVideo.classList.remove('hidden');
      selectedObjektName = selectedOption.dataset.name;
    } else {
      objektVideo.removeAttribute('crossOrigin');
      objektVideo.src = "";
      objektVideo.classList.add('hidden');
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

  function renderCanvas() {
    // Force the output square resolution to be a crisp HD 1080x1080
    const outputSize = 1080;
    if (canvas.width !== outputSize) {
      canvas.width = outputSize;
      canvas.height = outputSize;
    }

    // Always draw camera even if not recording, so stream is valid
    if (canvas.width > 0 && canvas.height > 0) {
      // Crop the center of the camera feed and mathematically fit it to the 1080p square
      const sourceSize = Math.min(preview.videoWidth, preview.videoHeight);
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

      // Draw PIP video on top if active or selected
      if (!objektVideo.hidden && objektVideo.src) {
        const bw = outputSize * 0.35; // 35% of the square width

        // Use a default 9:16 aspect ratio (1.5 height modifier) if video hasn't loaded metadata yet
        const videoAspect = (objektVideo.videoWidth && objektVideo.videoHeight)
          ? (objektVideo.videoHeight / objektVideo.videoWidth)
          : 1.5;

        const bh = bw * videoAspect;
        const bx = 20;
        const by = outputSize - bh - 20;

        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
        ctx.strokeRect(bx, by, bw, bh);

        if (objektVideo.readyState >= 2) {
          if (currentFacingMode === 'user') {
            ctx.save();
            ctx.translate(bx + bw / 2, by + bh / 2);
            ctx.scale(-1, 1);
            ctx.drawImage(objektVideo, -bw / 2, -bh / 2, bw, bh);
            ctx.restore();
          } else {
            ctx.drawImage(objektVideo, bx, by, bw, bh);
          }
        }
      }
    }
    animationFrameId = requestAnimationFrame(renderCanvas);
  }

  // Initialize Camera
  async function initCamera() {
    if (stream) {
      // Stop the existing stream immediately to transition to the new camera
      stream.getTracks().forEach(track => track.stop());
    }

    // Toggle the UI mirror effect on the preview and objekt video
    if (currentFacingMode === 'user') {
      preview.classList.add('mirrored');
      objektVideo.classList.add('mirrored');
    } else {
      preview.classList.remove('mirrored');
      objektVideo.classList.remove('mirrored');
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: currentFacingMode,
          width: { ideal: 1080 },
          height: { ideal: 1920 }
        },
        audio: true
      });
      preview.srcObject = stream;

      // Enable record button once stream is ready
      preview.onloadedmetadata = () => {
        recordBtn.disabled = false;
        statusText.textContent = "Ready to record";
        statusText.style.opacity = '1';
        setTimeout(() => {
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

  // Flip Camera
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

  // Start/Stop Recording
  recordBtn.addEventListener('click', () => {
    if (!isRecording) {
      startRecording();
    } else {
      stopRecording();
    }
  });

  function startRecording() {
    recordedChunks = [];
    try {
      // Mix audio tracks from camera
      const audioTracks = stream ? stream.getAudioTracks() : [];
      let combinedStream;

      try {
        if (!canvasStream) {
          canvasStream = canvas.captureStream(30);
        }
        combinedStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...audioTracks
        ]);
      } catch (e) {
        console.error("Stream build failed:", e);
        // Fallback to raw camera stream if canvas fails
        combinedStream = stream;
      }

      // Use mp4/webm depending on browser support. Enforce 8Mbps high quality bitrate.
      let options = { mimeType: 'video/webm; codecs=vp9,opus', videoBitsPerSecond: 8000000 };
      if (MediaRecorder.isTypeSupported('video/mp4')) {
        options = { mimeType: 'video/mp4', videoBitsPerSecond: 8000000 };
      } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp8,opus')) {
        options = { mimeType: 'video/webm; codecs=vp8,opus', videoBitsPerSecond: 8000000 };
      } else if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm', videoBitsPerSecond: 8000000 };
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

    const finalizeStart = () => {
      mediaRecorder.start();
      isRecording = true;
      recordBtn.classList.add('recording');

      // Hide UI selections when filming
      objektSelect.classList.add('hidden');
      flipBtn.classList.add('hidden');

      statusText.textContent = "Recording...";
      statusText.style.opacity = '1';
      renderCanvas();
    };

    if (!objektVideo.hidden) {
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
  }

  function stopRecording() {
    mediaRecorder.stop();
    isRecording = false;
    recordBtn.classList.remove('recording');

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

    recordBtn.classList.remove('hidden');
    downloadBtn.classList.add('hidden');
    resetBtn.classList.add('hidden');

    // Restore UI selections
    objektSelect.classList.remove('hidden');
    flipBtn.classList.remove('hidden');

    statusText.textContent = "Ready to record";
    setTimeout(() => { statusText.style.opacity = '0'; }, 2000);
    recordedChunks = [];
  });

  // Download the video
  downloadBtn.addEventListener('click', () => {
    const type = mediaRecorder ? mediaRecorder.mimeType : 'video/mp4';
    const blob = new Blob(recordedChunks, { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    document.body.appendChild(a);
    a.style = 'display: none';
    a.href = url;
    a.download = `cosmo-${selectedObjektName.toLowerCase()}-${Date.now()}.mp4`;
    a.click();
    window.URL.revokeObjectURL(url);
  });
});
