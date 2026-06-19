import { useState, useEffect, useRef } from 'react';

const getSavedNumber = (key, defaultValue) => {
  const saved = localStorage.getItem(key);
  return saved !== null ? Number(saved) : defaultValue;
};

function App() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme === 'dark';
  });
  
  const [status, setStatus] = useState('Idle');
  const [videoInfo, setVideoInfo] = useState(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(null);
  const [displayedImageIndex, setDisplayedImageIndex] = useState(null);
  const [imgVisible, setImgVisible] = useState(true);
  const [slideDir, setSlideDir] = useState(1);
  const imgTimeoutRef = useRef(null);
  const IMAGE_TRANS_MS = 220;
  const [thumbSize, setThumbSize] = useState(() => getSavedNumber('thumbSize', 250));
  const [isWide, setIsWide] = useState(() => {
    try { return localStorage.getItem('isWide') === 'true'; } catch { return false; }
  });
  
  const [marginTop, setMarginTop] = useState(() => getSavedNumber('marginTop', 50));
  const [marginBottom, setMarginBottom] = useState(() => getSavedNumber('marginBottom', 50));
  const [marginLeft, setMarginLeft] = useState(() => getSavedNumber('marginLeft', 50));
  const [marginRight, setMarginRight] = useState(() => getSavedNumber('marginRight', 50));
  const [innerMargin, setInnerMargin] = useState(() => getSavedNumber('innerMargin', 10));

  const [videoFile, setVideoFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  const [videoDuration, setVideoDuration] = useState(0); // 🌟 추가: 로드된 비디오의 전체 길이
  
  // 🌟 시간 구간 선택 상태 추가
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  
  const [isDrawing, setIsDrawing] = useState(false);
  // startPos removed: overlay updates happen via refs/RAF to avoid frequent React renders
  const [cropRect, setCropRect] = useState(null); 
  const videoRef = useRef(null);
  const maybeDrawingRef = useRef(false);
  const startClientRef = useRef({ x: 0, y: 0 });
  const overlayRef = useRef(null);
  const rafRef = useRef(null);
  const gridRef = useRef(null);
  const actionRef = useRef(''); // 'draw' | 'move' | ''
  const origCropRef = useRef(null); // { left, top, width, height } in px
  const cropDivRef = useRef(null);
  const resizeDirRef = useRef(null);
  const cursorTooltipRef = useRef(null);
  const fileInputRef = useRef(null);

  const [checkedFrames, setCheckedFrames] = useState(() => new Set());
  const [isDrawMode, setIsDrawMode] = useState(() => {
    try {
      return localStorage.getItem('drawMode') === 'true';
    } catch (e) {
      return false;
    }
  });

  // Snap-to-grid / snap-to-edges settings
  const [snapToGrid, setSnapToGrid] = useState(() => {
    try { return localStorage.getItem('snapToGrid') === 'true'; } catch { return true; }
  });
  const [snapToEdges, setSnapToEdges] = useState(() => {
    try { return localStorage.getItem('snapToEdges') === 'true'; } catch { return true; }
  });
  const [snapSize, setSnapSize] = useState(() => {
    try { return Number(localStorage.getItem('snapSize')) || 8; } catch { return 8; }
  });

  useEffect(() => { try { localStorage.setItem('snapToGrid', snapToGrid ? 'true' : 'false'); } catch {} }, [snapToGrid]);
  useEffect(() => { try { localStorage.setItem('snapToEdges', snapToEdges ? 'true' : 'false'); } catch {} }, [snapToEdges]);
  useEffect(() => { try { localStorage.setItem('snapSize', String(snapSize)); } catch {} }, [snapSize]);
  useEffect(() => {
    const g = gridRef.current;
    if (!g) return;
    g.style.display = snapToGrid ? 'block' : 'none';
    const size = Number(snapSize) || 8;
    g.style.backgroundImage = `linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)`;
    g.style.backgroundSize = `${size}px ${size}px`;
  }, [snapToGrid, snapSize]);

  const API_BASE_URL = 'http://localhost:8000/api/videos';
  const STATIC_BASE_URL = 'http://localhost:8000';

  const parseFilenameFromContentDisposition = (cd) => {
    if (!cd) return null;
    // Try RFC 5987 style first: filename*=utf-8''encoded-filename
    const filenameStar = /filename\*=(?:UTF-8''|utf-8''|UTF8'')?([^;\n]+)/i.exec(cd);
    if (filenameStar && filenameStar[1]) {
      const raw = filenameStar[1].trim().replace(/^"|"$/g, '');
      try {
        // Some servers percent-encode per RFC5987
        return decodeURIComponent(raw);
      } catch (e) {
        // Fallback: replace + with space and return raw
        return raw.replace(/\+/g, ' ');
      }
    }

    // Fallback to legacy filename="..." or filename=...
    const filenameMatch = /filename=(?:"([^"]+)"|([^;\n]+))/i.exec(cd);
    if (filenameMatch) {
      const raw = (filenameMatch[1] || filenameMatch[2]).trim();
      // decode percent-encoding if present
      try { return decodeURIComponent(raw); } catch (e) { return raw.replace(/\+/g, ' '); }
    }

    return null;
  };

  const detectIsWindows = () => {
    try {
      if (typeof navigator === 'undefined') return false;
      const ua = navigator.userAgent || '';
      const platform = navigator.platform || '';
      return /Win/i.test(ua) || /Win/i.test(platform);
    } catch (e) {
      return false;
    }
  };

  const sanitizeForWindows = (name) => {
    let s = name.replace(/[<>:\\"\/\|\?\*\x00-\x1F]/g, '_');
    s = s.replace(/[\.\s]+$/g, '');
    const base = s.split('.')[0].toUpperCase();
    const reserved = ['CON','PRN','AUX','NUL'];
    for (let i=1;i<=9;i++){ reserved.push('COM'+i); reserved.push('LPT'+i); }
    if (reserved.includes(base)) s = '_' + s;
    return s || 'download';
  };

  const sanitizeForLinux = (name) => {
    let s = name.replace(/[\x00/\x00-\x1F]/g, '_');
    s = s.replace(/\s+$/g, '');
    return s || 'download';
  };

  const ensurePdfExtension = (name) => {
    if (!name) return 'sheet_music.pdf';
    // If the name already ends with .pdf, normalize it by removing any
    // video extension that may appear immediately before .pdf
    if (/\.pdf$/i.test(name)) {
      // e.g. "file.webm.pdf" -> "file.pdf"
      name = name.replace(/\.(webm|mp4|mov|mkv|avi|flv|wmv|ogg)(?=\.pdf$)/i, '');
      return name;
    }

    // For names that don't end with .pdf, strip a trailing video extension
    // (if present) and then append .pdf
    name = name.replace(/\.(webm|mp4|mov|mkv|avi|flv|wmv|ogg)$/i, '');
    return name + '.pdf';
  };

  const getSafeFilename = (rawName) => {
    let name = (rawName || '').toString();
    if (name.length > 200) name = name.slice(0, 200);
    if (detectIsWindows()) name = sanitizeForWindows(name);
    else name = sanitizeForLinux(name);
    name = ensurePdfExtension(name);
    return name;
  };

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    document.body.classList.toggle('dark', isDarkMode);
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => { try { localStorage.setItem('isWide', isWide ? 'true' : 'false'); } catch {} }, [isWide]);

  useEffect(() => {
    const savedVideoId = localStorage.getItem('lastVideoId');
    if (savedVideoId) {
      setStatus('🔄 Loading previous session...');
      fetch(`${API_BASE_URL}/${savedVideoId}`)
        .then(res => {
          if (!res.ok) throw new Error('Data not found.');
          return res.json();
        })
        .then(data => {
          setVideoInfo(data);
          if (data.status === 'completed') setStatus('✅ Loaded previous extraction');
          else if (data.status === 'processing') setStatus('⚙️ Extracting sheet music...');
          else setStatus('📁 Waiting for upload');
        })
        .catch(error => {
          console.error("Failed to load previous data:", error);
          localStorage.removeItem('lastVideoId'); 
          setStatus('Idle');
        });
    }
  }, []);

  useEffect(() => {
    let intervalId;
    const checkProcessingStatus = async () => {
      if (!videoInfo || !videoInfo.id) return;
      try {
        const response = await fetch(`${API_BASE_URL}/${videoInfo.id}`);
        if (!response.ok) throw new Error('Status fetch failed');
        
        const data = await response.json();
        setVideoInfo(data);

        if (data.status === 'processing') setStatus('⚙️ Extracting sheet music...');
        else if (data.status === 'completed') {
          setStatus('✅ Extraction completed!');
          clearInterval(intervalId);
        } else if (data.status === 'failed') {
          setStatus('❌ Extraction failed');
          clearInterval(intervalId);
        }
      } catch (error) {
        console.error("Error checking status:", error);
      }
    };

    if (videoInfo && (videoInfo.status === 'uploaded' || videoInfo.status === 'processing')) {
      intervalId = setInterval(checkProcessingStatus, 2000);
    }
    return () => { if (intervalId) clearInterval(intervalId); };
  }, [videoInfo?.id, videoInfo?.status]);

  useEffect(() => { localStorage.setItem('thumbSize', thumbSize); }, [thumbSize]);
  useEffect(() => {
    localStorage.setItem('marginTop', marginTop);
    localStorage.setItem('marginBottom', marginBottom);
    localStorage.setItem('marginLeft', marginLeft);
    localStorage.setItem('marginRight', marginRight);
    localStorage.setItem('innerMargin', innerMargin);
  }, [marginTop, marginBottom, marginLeft, marginRight, innerMargin]);
  
  useEffect(() => {
    if (videoInfo && Array.isArray(videoInfo.keyframes)) {
      const all = new Set(videoInfo.keyframes.map((_, i) => i));
      setCheckedFrames((prev) => {
        if (prev && prev.size === all.size) return prev;
        return all;
      });
    } else {
      setCheckedFrames((prev) => (prev && prev.size === 0 ? prev : new Set()));
    }
  }, [videoInfo?.keyframes?.length]);

  // Keyboard navigation for selected image modal
  useEffect(() => {
    const handleKey = (ev) => {
      if (selectedImageIndex === null) return;
      if (!videoInfo || !videoInfo.keyframes) return;
      const total = videoInfo.keyframes.length;
      if (ev.key === 'ArrowLeft') {
        setSelectedImageIndex((i) => (i === null ? 0 : (i - 1 + total) % total));
      } else if (ev.key === 'ArrowRight') {
        setSelectedImageIndex((i) => (i === null ? 0 : (i + 1) % total));
      } else if (ev.key === 'Home') {
        setSelectedImageIndex(0);
      } else if (ev.key === 'End') {
        setSelectedImageIndex(total - 1);
      } else if (ev.key === 'Escape') {
        setSelectedImageIndex(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedImageIndex, videoInfo]);

  // Orchestrate fade/slide transitions when selectedImageIndex changes
  useEffect(() => {
    if (imgTimeoutRef.current) {
      clearTimeout(imgTimeoutRef.current);
      imgTimeoutRef.current = null;
    }
    // opening modal for first time
    if (selectedImageIndex === null) {
      setDisplayedImageIndex(null);
      setImgVisible(true);
      return;
    }
    if (displayedImageIndex === null) {
      // first show without animation
      setDisplayedImageIndex(selectedImageIndex);
      setImgVisible(true);
      return;
    }
    // determine slide direction for subtle slide effect
    try {
      setSlideDir(selectedImageIndex > displayedImageIndex ? 1 : -1);
    } catch {}
    // fade out, swap, fade in
    setImgVisible(false);
    imgTimeoutRef.current = setTimeout(() => {
      setDisplayedImageIndex(selectedImageIndex);
      setImgVisible(true);
      imgTimeoutRef.current = null;
    }, IMAGE_TRANS_MS);
    return () => { if (imgTimeoutRef.current) { clearTimeout(imgTimeoutRef.current); imgTimeoutRef.current = null; } };
  }, [selectedImageIndex, displayedImageIndex]);
  
  // 🌟 비디오 로드 시 전체 길이 설정
  const handleVideoLoadedMetadata = () => {
    if (videoRef.current) {
      const duration = videoRef.current.duration;
      setVideoDuration(duration);
      setStartTime(0);
      setEndTime(duration);
    }
  };

  const uploadVideo = async (fileToUpload) => {
    setStatus('🚀 Uploading...');
    let formData = new FormData();
    formData.append('file', fileToUpload);
    
    if (cropRect && cropRect.width > 0.05 && cropRect.height > 0.05) {
      formData.append('crop_x', cropRect.x.toFixed(4));
      formData.append('crop_y', cropRect.y.toFixed(4));
      formData.append('crop_w', cropRect.width.toFixed(4));
      formData.append('crop_h', cropRect.height.toFixed(4));
    } else {
      formData.append('crop_x', 0.0);
      formData.append('crop_y', 0.0);
      formData.append('crop_w', 1.0);
      formData.append('crop_h', 1.0);
    }

    // 🌟 시간 구간 파라미터 추가
    formData.append('start_time', startTime.toFixed(2));
    formData.append('end_time', endTime.toFixed(2));

    try {
      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error('Upload failed');
      
      const data = await response.json();
      
      if (data.status === 'completed') setStatus('✅ Loaded existing extraction');
      else if (data.status === 'processing') setStatus('⚙️ Extracting sheet music...');
      else setStatus('📁 Upload complete (waiting)');
      
      setVideoInfo(data);
      if (data.id) localStorage.setItem('lastVideoId', data.id);
    } catch (error) {
      console.error(error);
      setStatus(`Error: ${error.message}`);
    }
  };

  const handleManualUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setVideoFile(file);
      setVideoPreviewUrl(URL.createObjectURL(file));
      setCropRect(null); 
    }
  };

  // Pointer-based handlers + RAF-updated overlay to avoid frequent React renders
  const handlePointerDown = (e) => {
    if (!isDrawMode) return;
    const videoEl = videoRef.current;
    if (!videoEl) return;
    // Use the container (event currentTarget) rect so overlay coordinates match container
    const rect = e.currentTarget.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    // If an ROI exists and the pointer is inside it, start move mode
    if (cropRect && cropRect.width > 0 && cropRect.height > 0) {
      const cropLeft = cropRect.x * rect.width;
      const cropTop = cropRect.y * rect.height;
      const cropW = cropRect.width * rect.width;
      const cropH = cropRect.height * rect.height;
      if (localX >= cropLeft && localX <= cropLeft + cropW && localY >= cropTop && localY <= cropTop + cropH) {
        actionRef.current = 'move';
        maybeDrawingRef.current = true;
        setIsDrawing(false);
        startClientRef.current = { x: e.clientX, y: e.clientY, rect };
        origCropRef.current = { left: cropLeft, top: cropTop, width: cropW, height: cropH };
        e.target?.setPointerCapture?.(e.pointerId);
        const ov = overlayRef.current;
        if (ov) {
          ov.style.display = 'block';
          ov.style.left = `0px`;
          ov.style.top = `0px`;
          ov.style.transform = `translate3d(${cropLeft}px, ${cropTop}px, 0)`;
          ov.style.width = `${cropW}px`;
          ov.style.height = `${cropH}px`;
        }
        return;
      }
    }

    // otherwise start a new draw
    actionRef.current = 'draw';
    maybeDrawingRef.current = true;
    setIsDrawing(false);
    startClientRef.current = { x: e.clientX, y: e.clientY, rect };
    e.target?.setPointerCapture?.(e.pointerId);
    // ensure overlay exists
    const ov = overlayRef.current;
    if (ov) {
      ov.style.display = 'block';
      // reset left/top and use transform-only positioning (transform will place overlay)
      ov.style.left = `0px`;
      ov.style.top = `0px`;
      ov.style.transform = `translate3d(${e.clientX - rect.left}px, ${e.clientY - rect.top}px, 0)`;
      ov.style.width = `0px`;
      ov.style.height = `0px`;
    }
  };

  const handleResizeStart = (e, dir) => {
    // start resizing from a handle; prevent container from interpreting this as draw/move
    e.stopPropagation();
    if (!isDrawMode) return;
    const container = cropDivRef.current?.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    actionRef.current = 'resize';
    resizeDirRef.current = dir;
    maybeDrawingRef.current = true;
    setIsDrawing(false);
    startClientRef.current = { x: e.clientX, y: e.clientY, rect };
    // store original crop geometry in px
    if (cropRect) {
      origCropRef.current = {
        left: cropRect.x * rect.width,
        top: cropRect.y * rect.height,
        width: cropRect.width * rect.width,
        height: cropRect.height * rect.height,
      };
    } else {
      origCropRef.current = { left: 0, top: 0, width: 0, height: 0 };
    }
    e.target?.setPointerCapture?.(e.pointerId);
    const ov = overlayRef.current;
    if (ov && origCropRef.current) {
      ov.style.display = 'block';
      ov.style.left = `0px`;
      ov.style.top = `0px`;
      ov.style.transform = `translate3d(${origCropRef.current.left}px, ${origCropRef.current.top}px, 0)`;
      ov.style.width = `${origCropRef.current.width}px`;
      ov.style.height = `${origCropRef.current.height}px`;
    }
  };

  const scheduleOverlayUpdate = (left, top, width, height) => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      const ov = overlayRef.current;
      if (ov) {
        ov.style.transform = `translate3d(${left}px, ${top}px, 0)`;
        ov.style.width = `${width}px`;
        ov.style.height = `${height}px`;
      }
      rafRef.current = null;
    });
  };

  const handlePointerLeave = (e) => {
    if (cursorTooltipRef.current) cursorTooltipRef.current.style.display = 'none';
  };

  const handlePointerMove = (e) => {
    // Hover cursor: show 'grab' when pointer is over existing ROI, 'crosshair' when draw mode enabled
    const container = e.currentTarget;
    if (container) {
      const containerRect = container.getBoundingClientRect();
      
      // Update cursor tooltip position if draw mode is on and no ROI is selected
      if (cursorTooltipRef.current) {
        if (isDrawMode && !cropRect && !isDrawing) {
          cursorTooltipRef.current.style.display = 'block';
          const localX = e.clientX - containerRect.left;
          const localY = e.clientY - containerRect.top;
          cursorTooltipRef.current.style.transform = `translate3d(${localX + 15}px, ${localY + 15}px, 0)`;
        } else {
          cursorTooltipRef.current.style.display = 'none';
        }
      }

      if (isDrawMode) {
        if (cropRect && actionRef.current !== 'move' && !maybeDrawingRef.current && !isDrawing) {
          const localX = e.clientX - containerRect.left;
          const localY = e.clientY - containerRect.top;
          const cropLeft = cropRect.x * containerRect.width;
          const cropTop = cropRect.y * containerRect.height;
          const cropW = cropRect.width * containerRect.width;
          const cropH = cropRect.height * containerRect.height;
          const isOverCrop = (localX >= cropLeft && localX <= cropLeft + cropW && localY >= cropTop && localY <= cropTop + cropH);
          if (isOverCrop) {
            container.style.cursor = 'grab';
            if (cropDivRef.current) {
              cropDivRef.current.style.boxShadow = '0 0 0 4px rgba(59,130,246,0.12)';
              cropDivRef.current.style.borderColor = 'rgba(59,130,246,1)';
            }
            const handles = cropDivRef.current?.querySelectorAll('.resize-handle');
            if (handles) handles.forEach(h => h.style.display = 'block');
          } else {
            container.style.cursor = 'crosshair';
            if (cropDivRef.current) {
              cropDivRef.current.style.boxShadow = '';
              cropDivRef.current.style.borderColor = '';
            }
            const handles = cropDivRef.current?.querySelectorAll('.resize-handle');
            if (handles) handles.forEach(h => h.style.display = 'none');
          }
        }
      } else {
        container.style.cursor = '';
        if (cropDivRef.current) {
          cropDivRef.current.style.boxShadow = '';
          cropDivRef.current.style.borderColor = '';
        }
        const handles = cropDivRef.current?.querySelectorAll('.resize-handle');
        if (handles) handles.forEach(h => h.style.display = 'none');
      }
    }

    if (!maybeDrawingRef.current && !isDrawing) return;
    const { rect } = startClientRef.current;
    if (!rect) return;

    if (!isDrawing && maybeDrawingRef.current) {
      const dx = Math.abs(e.clientX - startClientRef.current.x);
      const dy = Math.abs(e.clientY - startClientRef.current.y);
      const dragThreshold = 6;
      if (dx < dragThreshold && dy < dragThreshold) return;
      setIsDrawing(true);
      maybeDrawingRef.current = false;
      if (e && e.currentTarget && e.currentTarget.style) e.currentTarget.style.cursor = 'grabbing';
    }

    // Move mode: translate existing ROI
    if (actionRef.current === 'move' && origCropRef.current) {
      const dx = e.clientX - startClientRef.current.x;
      const dy = e.clientY - startClientRef.current.y;
      const rectW = rect.width;
      const rectH = rect.height;
      let left = origCropRef.current.left + dx;
      let top = origCropRef.current.top + dy;
      const width = origCropRef.current.width;
      const height = origCropRef.current.height;

      // clamp within container
      left = Math.max(0, Math.min(rectW - width, left));
      top = Math.max(0, Math.min(rectH - height, top));

      // snapping for move (grid)
      if (snapToGrid) {
        const grid = Number(snapSize) || 8;
        left = Math.round(left / grid) * grid;
        top = Math.round(top / grid) * grid;
      }
      if (snapToEdges) {
        const thresh = 8;
        if (Math.abs(left - 0) <= thresh) left = 0;
        if (Math.abs(top - 0) <= thresh) top = 0;
        if (Math.abs(left + width - rectW) <= thresh) left = rectW - width;
        if (Math.abs(top + height - rectH) <= thresh) top = rectH - height;
      }

      scheduleOverlayUpdate(left, top, width, height);
      if (e && e.currentTarget && e.currentTarget.style) e.currentTarget.style.cursor = 'grabbing';
      return;
    }

    // Resize mode: adjust ROI by dragging a handle
    if (actionRef.current === 'resize' && origCropRef.current) {
      const dir = resizeDirRef.current || 'se';
      const dx = e.clientX - startClientRef.current.x;
      const dy = e.clientY - startClientRef.current.y;
      const rectW = startClientRef.current.rect.width;
      const rectH = startClientRef.current.rect.height;
      let left = origCropRef.current.left;
      let top = origCropRef.current.top;
      let width = origCropRef.current.width;
      let height = origCropRef.current.height;
      const minSize = 24;
      // adjust based on handle direction
      if (dir.includes('e')) {
        width = Math.max(minSize, origCropRef.current.width + dx);
      }
      if (dir.includes('s')) {
        height = Math.max(minSize, origCropRef.current.height + dy);
      }
      if (dir.includes('w')) {
        width = Math.max(minSize, origCropRef.current.width - dx);
        left = origCropRef.current.left + (origCropRef.current.width - width);
      }
      if (dir.includes('n')) {
        height = Math.max(minSize, origCropRef.current.height - dy);
        top = origCropRef.current.top + (origCropRef.current.height - height);
      }

      // clamp to bounds
      left = Math.max(0, Math.min(rectW - width, left));
      top = Math.max(0, Math.min(rectH - height, top));

      // snapping
      if (snapToGrid) {
        const grid = Number(snapSize) || 8;
        left = Math.round(left / grid) * grid;
        top = Math.round(top / grid) * grid;
        width = Math.round(width / grid) * grid;
        height = Math.round(height / grid) * grid;
      }
      if (snapToEdges) {
        const thresh = 8;
        if (Math.abs(left - 0) <= thresh) left = 0;
        if (Math.abs(top - 0) <= thresh) top = 0;
        if (Math.abs(left + width - rectW) <= thresh) left = rectW - width;
        if (Math.abs(top + height - rectH) <= thresh) top = rectH - height;
      }

      // set appropriate resize cursor
      if (e && e.currentTarget && e.currentTarget.style) {
        const cursorMap = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
        e.currentTarget.style.cursor = cursorMap[dir] || 'nwse-resize';
      }

      scheduleOverlayUpdate(left, top, width, height);
      return;
    }

    // Draw mode: resizing/creating new ROI
    if (isDrawing) {
      const x1 = Math.min(startClientRef.current.x, e.clientX);
      const y1 = Math.min(startClientRef.current.y, e.clientY);
      const x2 = Math.max(startClientRef.current.x, e.clientX);
      const y2 = Math.max(startClientRef.current.y, e.clientY);

      let left = Math.max(0, x1 - rect.left);
      let top = Math.max(0, y1 - rect.top);
      let width = Math.max(0, Math.min(rect.width, x2 - rect.left) - left);
      let height = Math.max(0, Math.min(rect.height, y2 - rect.top) - top);

      // Apply snapping if enabled
      if (snapToGrid) {
        const grid = Number(snapSize) || 8;
        left = Math.round(left / grid) * grid;
        top = Math.round(top / grid) * grid;
        width = Math.round(width / grid) * grid;
        height = Math.round(height / grid) * grid;
        width = Math.min(width, rect.width - left);
        height = Math.min(height, rect.height - top);
      }
      if (snapToEdges) {
        const thresh = 8; // pixels
        if (Math.abs(left - 0) <= thresh) left = 0;
        if (Math.abs(top - 0) <= thresh) top = 0;
        if (Math.abs((left + width) - rect.width) <= thresh) width = rect.width - left;
        if (Math.abs((top + height) - rect.height) <= thresh) height = rect.height - top;
        const thirds = [rect.width / 2, rect.width / 3, (rect.width * 2) / 3];
        for (const t of thirds) {
          if (Math.abs(left - t) <= thresh) { left = t; break; }
          if (Math.abs(left + width - t) <= thresh) { width = t - left; break; }
        }
      }

      scheduleOverlayUpdate(left, top, width, height);
      if (e && e.currentTarget && e.currentTarget.style) e.currentTarget.style.cursor = 'grabbing';
    }
  };

  const handlePointerUp = (e) => {
    if (!maybeDrawingRef.current && !isDrawing) {
      maybeDrawingRef.current = false;
      actionRef.current = '';
      return;
    }
    const rect = startClientRef.current.rect;
    if (!rect) return;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }

    // If we were moving an existing ROI
    if (actionRef.current === 'move' && origCropRef.current) {
      // overlay currently reflects the moved position; read its computed transform/width/height
      const ov = overlayRef.current;
      let left = origCropRef.current.left + (e.clientX - startClientRef.current.x);
      let top = origCropRef.current.top + (e.clientY - startClientRef.current.y);
      const width = origCropRef.current.width;
      const height = origCropRef.current.height;
      left = Math.max(0, Math.min(rect.width - width, left));
      top = Math.max(0, Math.min(rect.height - height, top));
      // finalize snapping again
      if (snapToGrid) {
        const grid = Number(snapSize) || 8;
        left = Math.round(left / grid) * grid;
        top = Math.round(top / grid) * grid;
      }
      if (snapToEdges) {
        const thresh = 8;
        if (Math.abs(left - 0) <= thresh) left = 0;
        if (Math.abs(top - 0) <= thresh) top = 0;
        if (Math.abs(left + width - rect.width) <= thresh) left = rect.width - width;
        if (Math.abs(top + height - rect.height) <= thresh) top = rect.height - height;
      }
      const norm = { x: left / rect.width, y: top / rect.height, width: width / rect.width, height: height / rect.height };
      setCropRect(norm);
      setIsDrawing(false);
      maybeDrawingRef.current = false;
      actionRef.current = '';
      origCropRef.current = null;
      if (ov) ov.style.display = 'none';
      if (e && e.currentTarget && e.currentTarget.style) e.currentTarget.style.cursor = isDrawMode ? 'crosshair' : 'auto';
      e.target?.releasePointerCapture?.(e.pointerId);
      return;
    }

    // If we were resizing an existing ROI
    if (actionRef.current === 'resize' && origCropRef.current) {
      const rect = startClientRef.current.rect;
      if (!rect) return;
      let left = origCropRef.current.left;
      let top = origCropRef.current.top;
      let width = origCropRef.current.width;
      let height = origCropRef.current.height;
      const dir = resizeDirRef.current || 'se';
      const dx = e.clientX - startClientRef.current.x;
      const dy = e.clientY - startClientRef.current.y;
      const minSize = 24;
      if (dir.includes('e')) width = Math.max(minSize, origCropRef.current.width + dx);
      if (dir.includes('s')) height = Math.max(minSize, origCropRef.current.height + dy);
      if (dir.includes('w')) { width = Math.max(minSize, origCropRef.current.width - dx); left = origCropRef.current.left + (origCropRef.current.width - width); }
      if (dir.includes('n')) { height = Math.max(minSize, origCropRef.current.height - dy); top = origCropRef.current.top + (origCropRef.current.height - height); }

      left = Math.max(0, Math.min(rect.width - width, left));
      top = Math.max(0, Math.min(rect.height - height, top));

      if (snapToGrid) {
        const grid = Number(snapSize) || 8;
        left = Math.round(left / grid) * grid;
        top = Math.round(top / grid) * grid;
        width = Math.round(width / grid) * grid;
        height = Math.round(height / grid) * grid;
        width = Math.min(width, rect.width - left);
        height = Math.min(height, rect.height - top);
      }
      if (snapToEdges) {
        const thresh = 8;
        if (Math.abs(left - 0) <= thresh) left = 0;
        if (Math.abs(top - 0) <= thresh) top = 0;
        if (Math.abs(left + width - rect.width) <= thresh) left = rect.width - width;
        if (Math.abs(top + height - rect.height) <= thresh) top = rect.height - height;
      }

      const norm = { x: left / rect.width, y: top / rect.height, width: width / rect.width, height: height / rect.height };
      setCropRect(norm);
      setIsDrawing(false);
      maybeDrawingRef.current = false;
      actionRef.current = '';
      origCropRef.current = null;
      resizeDirRef.current = null;
      const ov = overlayRef.current;
      if (ov) ov.style.display = 'none';
      if (e && e.currentTarget && e.currentTarget.style) e.currentTarget.style.cursor = isDrawMode ? 'crosshair' : 'auto';
      e.target?.releasePointerCapture?.(e.pointerId);
      return;
    }

    // otherwise treat as draw completion
    const x1 = Math.min(startClientRef.current.x, e.clientX);
    const y1 = Math.min(startClientRef.current.y, e.clientY);
    const x2 = Math.max(startClientRef.current.x, e.clientX);
    const y2 = Math.max(startClientRef.current.y, e.clientY);

    let left = Math.max(0, Math.min(rect.width, x1 - rect.left));
    let top = Math.max(0, Math.min(rect.height, y1 - rect.top));
    let width = Math.max(0, Math.min(rect.width, x2 - rect.left) - left);
    let height = Math.max(0, Math.min(rect.height, y2 - rect.top) - top);

    if (snapToGrid) {
      const grid = Number(snapSize) || 8;
      left = Math.round(left / grid) * grid;
      top = Math.round(top / grid) * grid;
      width = Math.round(width / grid) * grid;
      height = Math.round(height / grid) * grid;
      width = Math.min(width, rect.width - left);
      height = Math.min(height, rect.height - top);
    }
    if (snapToEdges) {
      const thresh = 8;
      if (Math.abs(left - 0) <= thresh) left = 0;
      if (Math.abs(top - 0) <= thresh) top = 0;
      if (Math.abs((left + width) - rect.width) <= thresh) width = rect.width - left;
      if (Math.abs((top + height) - rect.height) <= thresh) height = rect.height - top;
    }

    const norm = {
      x: left / rect.width,
      y: top / rect.height,
      width: width / rect.width,
      height: height / rect.height,
    };
    setCropRect(norm);
    setIsDrawing(false);
    maybeDrawingRef.current = false;
    actionRef.current = '';
    const ov = overlayRef.current;
    if (ov) {
      ov.style.display = 'none';
    }
    if (e && e.currentTarget && e.currentTarget.style) e.currentTarget.style.cursor = isDrawMode ? 'crosshair' : 'auto';
    e.target?.releasePointerCapture?.(e.pointerId);
  };

  const executeUpload = async () => {
    if (!videoFile) return;
    uploadVideo(videoFile); 
  };

  const handleExportPDF = async () => {
    if (!videoInfo || !videoInfo.id) return;
    try {
      setStatus('📄 Generating PDF...');
      const params = new URLSearchParams({ marginTop, marginBottom, marginLeft, marginRight, innerMargin });

      const selected = Array.from(checkedFrames).sort((a, b) => a - b).map(i => i);
      if (selected.length > 0) params.append('keyFrames', selected.join(','));

      const queryParams = params.toString();
      const response = await fetch(`${API_BASE_URL}/${videoInfo.id}/pdf?${queryParams}`);
      if (!response.ok) throw new Error('PDF generation failed');

      const cd = response.headers.get('content-disposition');
      const parsed = parseFilenameFromContentDisposition(cd);
      // Debugging: log server header and chosen filenames to help diagnose incorrect names
      console.debug('PDF download: content-disposition=', cd, 'parsed=', parsed, 'original_filename=', videoInfo?.original_filename);
      const fallback = videoInfo?.original_filename ? videoInfo.original_filename : `sheet_music_${videoInfo.id}.pdf`;
      const rawName = parsed || fallback;
      const safeName = getSafeFilename(rawName);

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = safeName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
      
      setStatus('✅ PDF download ready!');
    } catch (error) {
      alert(`Error: ${error.message}`);
      setStatus('❌ PDF failed');
    }
  };

  const handleReset = () => {
    localStorage.removeItem('lastVideoId');
    setVideoInfo(null);
    setStatus('Idle');
    setVideoFile(null);
    setVideoPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    
    // 이전에 입력했던 모든 파일 정보와 상태를 초기화
    setCheckedFrames(new Set());
    setSelectedImageIndex(null);
    setDisplayedImageIndex(null);
    setCropRect(null);
    setStartTime(0);
    setEndTime(0);
  };

  const handleDeleteVideo = async () => {
    if (!videoInfo || !videoInfo.id) return;
    
    const confirmDelete = window.confirm(
      "⚠️ [Permanent Server Data Deletion]\n\n" +
      "This action will permanently delete the uploaded source video, extracted keyframe images, and temporary/PDF files from the server storage.\n\n" +
      "Are you sure you want to delete all data from the server?"
    );
    if (!confirmDelete) return;

    try {
      setStatus('🗑️ Deleting server data...');
      const response = await fetch(`${API_BASE_URL}/${videoInfo.id}/delete`);
      if (!response.ok) {
        throw new Error(`Server response error (Status: ${response.status})`);
      }
      await response.json();
      alert('All video data and files have been successfully deleted from the server.');
      
      // Reset local state
      handleReset();

    } catch (error) {
      console.error('Delete error:', error);
      alert(`An error occurred while deleting data: ${error.message}`);
      setStatus('❌ Delete failed');
    }
  };

  const toggleFrameChecked = (index) => {
    setCheckedFrames(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleToggleDrawMode = () => {
    setIsDrawMode(prev => {
      const next = !prev;
      try { localStorage.setItem('drawMode', next ? 'true' : 'false'); } catch { /* ignore storage errors */ }
      if (!next) {
        maybeDrawingRef.current = false;
        setIsDrawing(false);
        setCropRect(null);
      }
      return next;
    });
  };

  const formatDurationStr = (sec) => {
    if (isNaN(sec)) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const formatDurationInfo = (sec) => sec ? `${Math.floor(sec / 60)}m ${Math.floor(sec % 60).toString().padStart(2, '0')}s` : '-';
  const formatSize = (bytes) => bytes ? (bytes / (1024 * 1024)).toFixed(2) + ' MB' : '-';

  // 🌟 시간 슬라이더 핸들러
  const handleStartTimeChange = (e) => {
    const val = Number(e.target.value);
    if (val < endTime) {
      setStartTime(val);
      if (videoRef.current) videoRef.current.currentTime = val; // 비디오 화면도 같이 이동
    }
  };

  const handleEndTimeChange = (e) => {
    const val = Number(e.target.value);
    if (val > startTime) {
      setEndTime(val);
      if (videoRef.current) videoRef.current.currentTime = val;
    }
  };

  const cardClass = "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 mb-6 shadow-sm transition-all duration-300";
  const btnClass = "inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm cursor-pointer transition-all duration-200 hover:-translate-y-0.5 shadow-md disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0";
  const inputNumClass = "w-16 px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className={`${isWide ? 'max-w-full mx-2 p-3 md:p-4' : 'max-w-5xl mx-auto p-6 md:p-10'}`}>
      
      <header className="flex justify-between items-center mb-10 pb-5 border-b-2 border-slate-200 dark:border-slate-700">
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
          🎵 Sheet Music Extractor
        </h1>
        <div className="flex gap-3 items-center">
          <div className="flex items-center rounded-md bg-slate-100 dark:bg-slate-800 p-1">
            <div className="relative group flex items-center">
              <button
                onClick={(e) => { e.stopPropagation(); setIsWide(false); }}
                className={`px-3 py-1 rounded-md text-sm font-medium transition ${!isWide ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
              >
                Default
              </button>
              <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 pointer-events-none bg-slate-800 dark:bg-slate-600 text-white font-medium text-xs rounded-md py-1.5 px-3 whitespace-nowrap w-max transition-all duration-200 shadow-lg z-50 translate-y-1 group-hover:translate-y-0">
                Default layout
              </div>
            </div>
            <div className="relative group flex items-center ml-1">
              <button
                onClick={(e) => { e.stopPropagation(); setIsWide(true); }}
                className={`px-3 py-1 rounded-md text-sm font-medium transition ${isWide ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
              >
                Wide
              </button>
              <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 pointer-events-none bg-slate-800 dark:bg-slate-600 text-white font-medium text-xs rounded-md py-1.5 px-3 whitespace-nowrap w-max transition-all duration-200 shadow-lg z-50 translate-y-1 group-hover:translate-y-0">
                Wide layout (minimal margins)
              </div>
            </div>
          </div>

          {videoInfo && (
            <div className="relative group flex items-center">
              <button 
                className={`px-4 py-2 rounded-lg font-semibold text-sm cursor-pointer transition-all duration-200 border ${
                  videoInfo.status === 'processing'
                    ? 'bg-red-50/30 text-red-400 border-red-200/20 cursor-not-allowed dark:bg-red-950/10 dark:text-red-800 dark:border-red-900/10'
                    : 'bg-red-50 hover:bg-red-100 text-red-600 border-red-200 dark:bg-red-950/20 dark:hover:bg-red-950/40 dark:text-red-400 dark:border-red-900/50'
                }`}
                onClick={handleDeleteVideo}
                disabled={videoInfo.status === 'processing'}
              >
                🗑️ Delete from Server
              </button>
              <div className="absolute top-full mt-2 right-0 lg:left-1/2 lg:-translate-x-1/2 opacity-0 group-hover:opacity-100 pointer-events-none bg-red-600 text-white font-medium text-xs rounded-md py-1.5 px-3 whitespace-nowrap w-max transition-all duration-200 shadow-lg z-50 translate-y-1 group-hover:translate-y-0">
                {videoInfo.status === 'processing' ? 'Processing in progress. Cannot delete.' : 'Permanently delete video & files from server'}
              </div>
            </div>
          )}

          <div className="relative group flex items-center">
            <button 
              className="px-4 py-2 rounded-lg font-semibold text-sm cursor-pointer transition-all duration-200 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-200"
              onClick={handleReset}
            >
              🔄 Start Over
            </button>
            <div className="absolute top-full mt-2 right-0 lg:left-1/2 lg:-translate-x-1/2 opacity-0 group-hover:opacity-100 pointer-events-none bg-slate-800 dark:bg-slate-600 text-white font-medium text-xs rounded-md py-1.5 px-3 whitespace-nowrap w-max transition-all duration-200 shadow-lg z-50 translate-y-1 group-hover:translate-y-0">
              Clear current video and start new session
            </div>
          </div>
          <div className="relative group flex items-center">
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)} 
              className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-lg shadow-sm"
            >
              {isDarkMode ? '☀️' : '🌙'}
            </button>
            <div className="absolute top-full mt-2 right-0 opacity-0 group-hover:opacity-100 pointer-events-none bg-slate-800 dark:bg-slate-600 text-white font-medium text-xs rounded-md py-1.5 px-3 whitespace-nowrap w-max transition-all duration-200 shadow-lg z-50 translate-y-1 group-hover:translate-y-0">
              Toggle theme
            </div>
          </div>
        </div>
      </header>
      
      <div className={cardClass}>
        <h3 className="text-lg font-bold mb-4">📁 1. Select video and extraction settings</h3>
        {videoInfo ? (
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
            <div className="flex items-center gap-3 overflow-hidden">
              <span className="text-2xl shrink-0">📄</span>
              <div className="truncate">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">Selected Video</p>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate" title={videoInfo.original_filename}>{videoInfo.original_filename}</p>
              </div>
            </div>
            {videoInfo.status !== 'processing' && (
              <button 
                onClick={handleReset} 
                className="shrink-0 ml-4 px-4 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-600 transition-colors shadow-sm"
              >
                Change File
              </button>
            )}
          </div>
        ) : (
          <input 
            type="file" 
            accept="video/*" 
            ref={fileInputRef}
            onChange={handleManualUpload} 
            disabled={status.includes('Uploading')}
            className="block w-full text-sm text-slate-500 dark:text-slate-400 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-slate-700 dark:file:text-blue-400 dark:hover:file:bg-slate-600 transition-all cursor-pointer border border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-4 bg-slate-50 dark:bg-slate-800/50"
          />
        )}
        
        {videoPreviewUrl && (
            <div className="mt-6 flex flex-col items-center">
            <div className="w-full flex items-center justify-between mb-2">
              <p className="text-sm text-slate-500 dark:text-slate-400 font-medium flex items-center gap-2">
                <span className="text-lg">💡</span> Drag over the video to select the score area.
              </p>
            </div>
            {/* 상단에 독립된 ROI 컨트롤 바 (비디오 밖) */}
            <div className="w-full max-w-4xl mb-4 flex items-center justify-end">
              <div className="flex items-center gap-4">
                {/* Draw toggle with label */}
                <div className="relative group flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleToggleDrawMode(); }}
                    className={`w-12 h-6 rounded-full transition-colors flex items-center px-1 ${isDrawMode ? 'bg-amber-500' : 'bg-slate-500/50 backdrop-blur-sm'}`}
                    aria-pressed={isDrawMode}
                    title={isDrawMode ? 'Draw ROI: ON' : 'Draw ROI: OFF'}
                  >
                    <span className={`w-4 h-4 bg-white rounded-full shadow transform transition-transform ${isDrawMode ? 'translate-x-6' : 'translate-x-0'}`} />
                  </button>
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-100">Draw ROI</div>
                  <div className="absolute -top-10 left-0 opacity-0 group-hover:opacity-100 pointer-events-none bg-slate-800 text-white text-xs rounded py-1.5 px-3 whitespace-nowrap transition-opacity shadow-lg">
                    Toggle draw mode to enable rectangular ROI selection over the video.
                  </div>
                </div>

                {/* Clear button */}
                <div className="relative group flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); if (!isDrawMode) return; setCropRect(null); maybeDrawingRef.current = false; setIsDrawing(false); }}
                    title="Clear ROI"
                    disabled={!isDrawMode}
                    className={`w-8 h-8 flex items-center justify-center rounded-md ${isDrawMode ? 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-100' : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'}`}
                    aria-disabled={!isDrawMode}
                  >
                    ✖
                  </button>
                  <div className="text-sm text-slate-700 dark:text-slate-300">Clear ROI</div>
                  <div className="absolute -top-10 left-0 opacity-0 group-hover:opacity-100 pointer-events-none bg-slate-800 text-white text-xs rounded py-1.5 px-3 whitespace-nowrap transition-opacity shadow-lg">
                    Clear the current ROI selection.
                  </div>
                </div>

                {/* Snap toggle */}
                <div className={`relative group flex items-center gap-2 ${!isDrawMode ? 'opacity-50 pointer-events-none' : ''}`}>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={snapToGrid} onChange={(e) => setSnapToGrid(e.target.checked)} className="w-4 h-4" disabled={!isDrawMode} />
                    <span className="text-xs text-slate-700 dark:text-slate-300">Snap</span>
                  </label>
                  <div className="absolute -top-10 left-0 opacity-0 group-hover:opacity-100 pointer-events-none bg-slate-800 text-white text-xs rounded py-1.5 px-3 whitespace-nowrap transition-opacity shadow-lg">
                    Snap the ROI to the visible grid while dragging.
                  </div>
                </div>

                {/* Grid size */}
                <div className={`relative group ${!isDrawMode ? 'opacity-50 pointer-events-none' : ''}`}>
                  <input type="number" min="2" max="200" value={snapSize} onChange={(e) => setSnapSize(Number(e.target.value) || 8)} className="w-14 text-xs p-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100" title="Grid size (px)" disabled={!isDrawMode} />
                  <div className="absolute -top-10 left-0 opacity-0 group-hover:opacity-100 pointer-events-none bg-slate-800 text-white text-xs rounded py-1.5 px-3 whitespace-nowrap transition-opacity shadow-lg">
                    Grid cell size (pixels) used when Snap is enabled.
                  </div>
                </div>

                {/* Edges toggle */}
                <div className={`relative group flex items-center gap-2 ${!isDrawMode ? 'opacity-50 pointer-events-none' : ''}`}>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={snapToEdges} onChange={(e) => setSnapToEdges(e.target.checked)} className="w-4 h-4" disabled={!isDrawMode} />
                    <span className="text-xs text-slate-700 dark:text-slate-300">Edges</span>
                  </label>
                  <div className="absolute -top-10 left-0 opacity-0 group-hover:opacity-100 pointer-events-none bg-slate-800 text-white text-xs rounded py-1.5 px-3 whitespace-nowrap transition-opacity shadow-lg">
                    Snap the ROI to container edges, centers, and thirds.
                  </div>
                </div>
              </div>
            </div>

              <div 
                className={`relative w-full max-w-4xl border-2 border-slate-300 dark:border-slate-600 rounded-xl bg-black overflow-hidden shadow-inner ${isDrawMode ? 'cursor-crosshair select-none' : ''}`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={handlePointerLeave}
              >
                <div
                  ref={cursorTooltipRef}
                  className="bg-slate-800/90 dark:bg-slate-700/90 text-white font-medium text-xs px-2.5 py-1.5 rounded-md shadow-lg whitespace-nowrap pointer-events-none backdrop-blur-sm"
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    display: 'none',
                    zIndex: 40,
                    willChange: 'transform'
                  }}
                >
                  Drag to select ROI
                </div>
                <div
                  ref={gridRef}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  right: 0,
                  bottom: 0,
                  display: snapToGrid ? 'block' : 'none',
                  pointerEvents: 'none',
                  zIndex: 15,
                  opacity: 0.6,
                }}
              />

              <div
                ref={overlayRef}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  display: 'none',
                  transform: 'translate3d(0px, 0px, 0)',
                  border: '2px solid rgba(59,130,246,0.9)',
                  background: 'rgba(59,130,246,0.16)',
                  pointerEvents: 'none',
                  zIndex: 25,
                  willChange: 'transform, width, height'
                }}
              />

              <video 
                ref={videoRef} 
                src={videoPreviewUrl} 
                onLoadedMetadata={handleVideoLoadedMetadata}
                className={`w-full max-h-[600px] object-contain ${isDrawMode ? 'pointer-events-none' : 'pointer-events-auto'}`} 
                controls={!isDrawMode} 
                muted 
              />
              
              {cropRect && (
                <div 
                  ref={cropDivRef}
                  className="absolute border-2 border-blue-500 bg-blue-500/20"
                  style={{
                    left: `${cropRect.x * 100}%`,
                    top: `${cropRect.y * 100}%`,
                    width: `${cropRect.width * 100}%`,
                    height: `${cropRect.height * 100}%`,
                    pointerEvents: 'auto'
                  }}
                >
                  {/* Resize handles (hidden by default, shown on hover) */}
                  <div onPointerDown={(e)=>handleResizeStart(e,'nw')} className="resize-handle" style={{ position: 'absolute', left: -6, top: -6, width: 12, height: 12, background: '#fff', border: '2px solid rgba(37,99,235,0.9)', borderRadius: 2, display: 'none', zIndex: 50, cursor: 'nwse-resize' }} />
                  <div onPointerDown={(e)=>handleResizeStart(e,'n')} className="resize-handle" style={{ position: 'absolute', left: '50%', top: -6, transform: 'translateX(-50%)', width: 12, height: 12, background: '#fff', border: '2px solid rgba(37,99,235,0.9)', borderRadius: 2, display: 'none', zIndex: 50, cursor: 'ns-resize' }} />
                  <div onPointerDown={(e)=>handleResizeStart(e,'ne')} className="resize-handle" style={{ position: 'absolute', right: -6, top: -6, width: 12, height: 12, background: '#fff', border: '2px solid rgba(37,99,235,0.9)', borderRadius: 2, display: 'none', zIndex: 50, cursor: 'nesw-resize' }} />
                  <div onPointerDown={(e)=>handleResizeStart(e,'e')} className="resize-handle" style={{ position: 'absolute', right: -6, top: '50%', transform: 'translateY(-50%)', width: 12, height: 12, background: '#fff', border: '2px solid rgba(37,99,235,0.9)', borderRadius: 2, display: 'none', zIndex: 50, cursor: 'ew-resize' }} />
                  <div onPointerDown={(e)=>handleResizeStart(e,'se')} className="resize-handle" style={{ position: 'absolute', right: -6, bottom: -6, width: 12, height: 12, background: '#fff', border: '2px solid rgba(37,99,235,0.9)', borderRadius: 2, display: 'none', zIndex: 50, cursor: 'nwse-resize' }} />
                  <div onPointerDown={(e)=>handleResizeStart(e,'s')} className="resize-handle" style={{ position: 'absolute', left: '50%', bottom: -6, transform: 'translateX(-50%)', width: 12, height: 12, background: '#fff', border: '2px solid rgba(37,99,235,0.9)', borderRadius: 2, display: 'none', zIndex: 50, cursor: 'ns-resize' }} />
                  <div onPointerDown={(e)=>handleResizeStart(e,'sw')} className="resize-handle" style={{ position: 'absolute', left: -6, bottom: -6, width: 12, height: 12, background: '#fff', border: '2px solid rgba(37,99,235,0.9)', borderRadius: 2, display: 'none', zIndex: 50, cursor: 'nesw-resize' }} />
                  <div onPointerDown={(e)=>handleResizeStart(e,'w')} className="resize-handle" style={{ position: 'absolute', left: -6, top: '50%', transform: 'translateY(-50%)', width: 12, height: 12, background: '#fff', border: '2px solid rgba(37,99,235,0.9)', borderRadius: 2, display: 'none', zIndex: 50, cursor: 'ew-resize' }} />
                </div>
              )}
            </div>

            {/* 🌟 시간 구간 선택 (Dual Range Slider) */}
            {videoDuration > 0 && (
              <div className="w-full max-w-4xl mt-6 p-5 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">⏱️ Select Extraction Time Range</h4>
                  <div className="font-mono text-sm font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 px-3 py-1 rounded-md">
                    {formatDurationStr(startTime)} <span className="text-slate-400 mx-1">~</span> {formatDurationStr(endTime)}
                  </div>
                </div>
                
                <div className="relative h-6 flex items-center">
                  <div className="absolute w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full pointer-events-none"></div>
                  
                  {/* 선택된 구간 하이라이트 (파란 선) */}
                  <div 
                    className="absolute h-2 bg-blue-500 rounded-full pointer-events-none"
                    style={{ 
                      left: `${(startTime / videoDuration) * 100}%`, 
                      right: `${100 - (endTime / videoDuration) * 100}%` 
                    }}
                  ></div>

                  {/* 투명한 듀얼 슬라이더 (CSS 이벤트 투과 로직 적용) */}
                  <input 
                    type="range" min="0" max={videoDuration} step="0.1" 
                    value={startTime} onChange={handleStartTimeChange}
                    className="absolute w-full appearance-none bg-transparent pointer-events-none z-10 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-blue-500 [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto"
                  />
                  <input 
                    type="range" min="0" max={videoDuration} step="0.1" 
                    value={endTime} onChange={handleEndTimeChange}
                    className="absolute w-full appearance-none bg-transparent pointer-events-none z-20 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-blue-500 [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto"
                  />
                </div>
              </div>
            )}

            {/* 🌟 캡처/추출 버튼 (하단으로 이동) */}
            <button 
              onClick={executeUpload}
              disabled={videoInfo?.status === 'processing'}
              className={`${btnClass} bg-blue-600 hover:bg-blue-700 text-white mt-8 w-full max-w-md shadow-blue-500/30 text-lg`}
            >
              🚀 Start extraction
            </button>
          </div>
        )}
      </div>

      <div className={`${cardClass} ${videoInfo?.status === 'processing' ? 'ring-2 ring-blue-500 shadow-lg shadow-blue-500/10' : ''}`}>
        <h3 className="text-lg font-bold mb-4 text-slate-800 dark:text-slate-100">📁 Processing status</h3>
        
        <div className="p-5 bg-blue-50/50 dark:bg-slate-900/50 rounded-xl border border-blue-100 dark:border-slate-700">
          <strong className="text-blue-600 dark:text-blue-400 text-lg block mb-2">{status}</strong>
          
          {videoInfo?.status === 'processing' && (
            <div className="w-full h-6 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mt-3 shadow-inner">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 flex items-center justify-center text-white text-xs font-bold transition-all duration-500 ease-out" 
                style={{ width: `${videoInfo.progress || 0}%` }}
              >
                {videoInfo.progress || 0}%
              </div>
            </div>
          )}
        </div>
      </div>

      {videoInfo && videoInfo.width && (
        <div className={cardClass}>
          <h3 className="text-lg font-bold mb-4 text-slate-800 dark:text-slate-100">📊 Video metadata</h3>
          <div className="flex flex-col gap-4">
            {/* First row: Filename spans full width and allows wrapping */}
            <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl w-full">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">Filename</span>
              <div className="font-medium text-slate-800 dark:text-slate-200 break-words whitespace-normal">{videoInfo.original_filename}</div>
            </div>

            {/* Extended Metadata Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">Format / FPS</span>
                <span className="font-medium text-slate-800 dark:text-slate-200 block">
                  {videoInfo.original_filename?.split('.').pop()?.toUpperCase() || 'VIDEO'} ({videoInfo.fps ? videoInfo.fps.toFixed(2) : '--'} FPS)
                </span>
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">File size</span>
                <span className="font-medium text-slate-800 dark:text-slate-200 block">{formatSize(videoInfo.file_size)}</span>
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">Resolution</span>
                <span className="font-medium text-slate-800 dark:text-slate-200 block">{videoInfo.width} x {videoInfo.height}</span>
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">Duration</span>
                <span className="font-medium text-slate-800 dark:text-slate-200 block">{formatDurationInfo(videoInfo.duration)}</span>
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">Processing Date</span>
                <span className="font-medium text-slate-800 dark:text-slate-200 block">
                  {videoInfo.upload_time ? new Date(videoInfo.upload_time).toLocaleString() : '--'}
                </span>
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">Time Range</span>
                <span className="font-medium text-slate-800 dark:text-slate-200 block">
                  {videoInfo.start_time != null && videoInfo.end_time != null ? `${formatDurationStr(videoInfo.start_time)} ~ ${formatDurationStr(videoInfo.end_time)}` : 'Full Video'}
                </span>
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">Crop (ROI)</span>
                <span className="font-medium text-slate-800 dark:text-slate-200 block">
                  {videoInfo.crop_w && (videoInfo.crop_w < 1.0 || videoInfo.crop_h < 1.0) ? `Applied (${(videoInfo.crop_w * 100).toFixed(0)}% x ${(videoInfo.crop_h * 100).toFixed(0)}%)` : 'Not Applied'}
                </span>
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-blue-100 dark:border-blue-900/50">
                <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider block mb-1">Extracted Pages</span>
                <span className="font-bold text-blue-700 dark:text-blue-300 block text-lg">
                  {videoInfo.keyframes?.length > 0 ? `${videoInfo.keyframes.length} pages` : (videoInfo.status === 'completed' ? '0 pages' : 'Processing...')}
                </span>
              </div>
            </div>

            {/* 🗑️ Delete Video from Server option */}
            <div className="flex justify-end mt-2">
              <button 
                onClick={handleDeleteVideo}
                disabled={videoInfo.status === 'processing'}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm cursor-pointer transition-all duration-200 border ${
                  videoInfo.status === 'processing'
                    ? 'bg-red-50/30 text-red-400 border-red-200/20 cursor-not-allowed dark:bg-red-950/10 dark:text-red-800 dark:border-red-900/10'
                    : 'bg-red-50 hover:bg-red-100 text-red-600 border-red-200 dark:bg-red-950/20 dark:hover:bg-red-950/40 dark:text-red-400 dark:border-red-900/50'
                }`}
                title={videoInfo.status === 'processing' ? 'Cannot delete while processing.' : 'Permanently delete this video and all generated files from the server storage'}
              >
                🗑️ Delete from Server
              </button>
            </div>
          </div>
        </div>
      )}

      {videoInfo?.status === 'completed' && videoInfo?.keyframes && (
        <div className={cardClass}>
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/30 rounded-xl p-5 mb-8">
            <h4 className="text-md font-bold mb-4 text-amber-900 dark:text-amber-400">📄 PDF export settings</h4>
            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-700 dark:text-slate-300">
              <label className="flex items-center gap-2">Top: <input type="number" className={inputNumClass} value={marginTop} onChange={e => setMarginTop(Number(e.target.value))} /> px</label>
              <label className="flex items-center gap-2">Bottom: <input type="number" className={inputNumClass} value={marginBottom} onChange={e => setMarginBottom(Number(e.target.value))} /> px</label>
              <label className="flex items-center gap-2">Left: <input type="number" className={inputNumClass} value={marginLeft} onChange={e => setMarginLeft(Number(e.target.value))} /> px</label>
              <label className="flex items-center gap-2">Right: <input type="number" className={inputNumClass} value={marginRight} onChange={e => setMarginRight(Number(e.target.value))} /> px</label>
              <label className="flex items-center gap-2">Spacing: <input type="number" className={inputNumClass} value={innerMargin} onChange={e => setInnerMargin(Number(e.target.value))} /> px</label>
              
              <button 
                className={`${btnClass} bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/30 ml-auto`} 
                onClick={handleExportPDF}
              >
                ⬇️ Download PDF
              </button>
            </div>
          </div>

          <div className="mb-6 p-4 rounded-lg bg-white/70 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700 flex items-center gap-3">
            <div className="flex-shrink-0 text-2xl">📝</div>
            <div className="text-sm text-slate-700 dark:text-slate-300">
              <strong className="font-medium">Include only checked images in the PDF</strong>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Use the checkbox at the top-left of each thumbnail to select which pages to include. Selected: <strong className="text-slate-800 dark:text-slate-100">{checkedFrames.size}</strong> / {videoInfo.keyframes.length}
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row justify-between items-center mb-6 pb-6 border-b border-slate-200 dark:border-slate-700 gap-4">
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 m-0">🖼️ Extracted sheets ({videoInfo.keyframes.length})</h3>
            <label className="flex items-center gap-3 text-sm font-medium text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 px-4 py-2 rounded-lg">
              🔍 Thumbnail size
              <input type="range" min="150" max="400" value={thumbSize} onChange={(e) => setThumbSize(Number(e.target.value))} className="accent-blue-500" />
            </label>
          </div>

          <div className="grid gap-6" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))` }}>
            {videoInfo.keyframes.map((frame, index) => {
              const imageUrl = `${STATIC_BASE_URL}/${frame.image_filepath.replace('./', '')}`;
              return (
                <div 
                  key={frame.id} 
                  className="group bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden cursor-pointer hover:-translate-y-1 hover:shadow-lg hover:border-blue-500 dark:hover:border-blue-400 transition-all duration-300"
                  onClick={() => setSelectedImageIndex(index)}
                >
                  <div className="relative">
                    <div className="absolute top-2 left-2 z-10">
                      <label className="flex items-center gap-2 bg-white/80 dark:bg-slate-900/80 p-1.5 rounded-md shadow-sm">
                        <input
                          type="checkbox"
                          checked={checkedFrames.has(index)}
                          onChange={() => toggleFrameChecked(index)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-4 h-4 cursor-pointer"
                        />
                      </label>
                    </div>

                    <div className="aspect-video overflow-hidden bg-slate-100 dark:bg-slate-900 flex items-center justify-center">
                      <img src={imageUrl} alt={`Frame ${index + 1}`} loading="lazy" className="max-w-full max-h-full object-contain group-hover:scale-105 transition-transform duration-500" />
                    </div>
                  </div>
                  <div className="p-3 flex justify-between items-center bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700">
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium font-mono">#{index + 1}</span>
                    <strong className="text-slate-800 dark:text-slate-200 text-sm font-mono bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded">{formatDurationStr(frame.timestamp)}</strong>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {selectedImageIndex !== null && videoInfo && videoInfo.keyframes && (
        (() => {
          const total = videoInfo.keyframes.length;
          const displayed = (displayedImageIndex !== null) ? displayedImageIndex : selectedImageIndex;
          if (displayed === null || displayed === undefined) return null;
          const frame = videoInfo.keyframes[displayed];
          const imgUrl = `${STATIC_BASE_URL}/${frame.image_filepath.replace('./', '')}`;
          const idx = displayed;
          return (
            <div 
              className="fixed inset-0 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
              onClick={(e) => { if (e.target === e.currentTarget) { setSelectedImageIndex(null); setDisplayedImageIndex(null); } }}
              tabIndex={-1}
            >
              {/* Close button at the top-right corner of the viewport */}
              <button 
                onClick={(e) => { e.stopPropagation(); setSelectedImageIndex(null); setDisplayedImageIndex(null); }} 
                className="absolute top-4 right-4 text-slate-800 dark:text-white text-2xl transition-colors bg-slate-200/80 dark:bg-slate-800/90 dark:border dark:border-slate-600 p-2 rounded-full hover:bg-slate-300 dark:hover:bg-slate-700 shadow-lg backdrop-blur-sm"
                style={{ zIndex: 70 }}
                aria-label="Close"
              >
                ×
              </button>

              {/* Fixed Left Navigation Controls */}
              <div className="absolute left-8 top-1/2 transform -translate-y-1/2 flex flex-col gap-3" style={{ zIndex: 60 }}>
                <button onClick={(e) => { e.stopPropagation(); setSelectedImageIndex(0); }} className="bg-slate-200 dark:bg-slate-800/90 dark:border dark:border-slate-600 text-slate-800 dark:text-white px-5 py-3 rounded-xl hover:bg-slate-300 dark:hover:bg-slate-700 transition-all text-base font-semibold shadow-lg backdrop-blur-sm">Start</button>
                <button onClick={(e) => { e.stopPropagation(); setSelectedImageIndex((cur) => (cur === null ? 0 : (cur - 1 + total) % total)); }} className="bg-slate-200 dark:bg-slate-800/90 dark:border dark:border-slate-600 text-slate-800 dark:text-white px-5 py-3 rounded-xl hover:bg-slate-300 dark:hover:bg-slate-700 transition-all text-base font-semibold shadow-lg backdrop-blur-sm">◀ Prev</button>
              </div>

              {/* Fixed Right Navigation Controls */}
              <div className="absolute right-8 top-1/2 transform -translate-y-1/2 flex flex-col gap-3" style={{ zIndex: 60 }}>
                <button onClick={(e) => { e.stopPropagation(); setSelectedImageIndex((cur) => (cur === null ? 0 : (cur + 1) % total)); }} className="bg-slate-200 dark:bg-slate-800/90 dark:border dark:border-slate-600 text-slate-800 dark:text-white px-5 py-3 rounded-xl hover:bg-slate-300 dark:hover:bg-slate-700 transition-all text-base font-semibold shadow-lg backdrop-blur-sm">Next ▶</button>
                <button onClick={(e) => { e.stopPropagation(); setSelectedImageIndex(total - 1); }} className="bg-slate-200 dark:bg-slate-800/90 dark:border dark:border-slate-600 text-slate-800 dark:text-white px-5 py-3 rounded-xl hover:bg-slate-300 dark:hover:bg-slate-700 transition-all text-base font-semibold shadow-lg backdrop-blur-sm">End</button>
              </div>

              {/* Left/Right click zones for easy click-navigation */}
              <div
                onClick={(e) => { e.stopPropagation(); setSelectedImageIndex((cur) => (cur === null ? 0 : (cur - 1 + total) % total)); }}
                className="absolute left-0 top-0 h-full w-[20vw] cursor-pointer"
                style={{ zIndex: 30 }}
                aria-hidden
              />
              <div
                onClick={(e) => { e.stopPropagation(); setSelectedImageIndex((cur) => (cur === null ? 0 : (cur + 1) % total)); }}
                className="absolute right-0 top-0 h-full w-[20vw] cursor-pointer"
                style={{ zIndex: 30 }}
                aria-hidden
              />

              {/* Centered Image Container - keeps a safe distance from side controls */}
              <div className="flex items-center justify-center w-full max-w-[calc(100vw-360px)] max-h-[80vh]" style={{ zIndex: 40 }} onClick={(e) => e.stopPropagation()}>
                <img 
                  src={imgUrl} 
                  alt={`Enlarged frame ${idx + 1}`} 
                  style={{
                    position: 'relative',
                    opacity: imgVisible ? 1 : 0,
                    transition: `opacity ${IMAGE_TRANS_MS}ms ease, transform ${IMAGE_TRANS_MS}ms ease`,
                    transform: imgVisible ? 'translateX(0)' : `translateX(${ - (slideDir || 1) * 12 }px)`
                  }}
                  className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/50"
                />
              </div>

              {/* Counter Label */}
              <div className="absolute bottom-16 left-1/2 transform -translate-x-1/2 text-slate-800 dark:text-white text-sm font-semibold bg-slate-200 dark:bg-slate-800/90 px-5 py-2.5 rounded-xl shadow-lg font-mono border border-slate-300/50 dark:border-slate-600 backdrop-blur-sm" style={{ zIndex: 60 }}>
                {idx + 1} / {total}
              </div>

              {/* Keyboard Navigation Hints */}
              <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-xs text-slate-600 dark:text-white/80 bg-slate-200/50 dark:bg-slate-800/80 px-4 py-2 rounded-xl flex items-center gap-3 backdrop-blur-md border border-slate-300/30 dark:border-slate-600" style={{ zIndex: 60 }}>
                <span className="font-semibold">← / →</span>
                <span className="opacity-90">navigate</span>
                <span className="opacity-40">•</span>
                <span className="opacity-90">Home/End jump</span>
                <span className="opacity-40">•</span>
                <span className="opacity-90">Esc close</span>
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}

export default App;