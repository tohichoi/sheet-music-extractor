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
  const [selectedImage, setSelectedImage] = useState(null); 
  const [thumbSize, setThumbSize] = useState(() => getSavedNumber('thumbSize', 250));
  
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
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [cropRect, setCropRect] = useState(null); 
  const videoRef = useRef(null);
  const maybeDrawingRef = useRef(false);
  const startClientRef = useRef({ x: 0, y: 0 });

  const [checkedFrames, setCheckedFrames] = useState(() => new Set());
  const [isDrawMode, setIsDrawMode] = useState(() => {
    try {
      return localStorage.getItem('drawMode') === 'true';
    } catch (e) {
      return false;
    }
  });

  const API_BASE_URL = 'http://localhost:8000/api/videos';
  const STATIC_BASE_URL = 'http://localhost:8000';

  const parseFilenameFromContentDisposition = (cd) => {
    if (!cd) return null;
    const filenameStar = /filename\*=(?:UTF-8'')?([^;\n]+)/i.exec(cd);
    if (filenameStar) {
      try {
        return decodeURIComponent(filenameStar[1].trim().replace(/^"|"$/g, ''));
      } catch (e) {
        return filenameStar[1].trim().replace(/^"|"$/g, '');
      }
    }
    const filenameMatch = /filename=(?:"([^"]+)"|([^;\n]+))/i.exec(cd);
    if (filenameMatch) return (filenameMatch[1] || filenameMatch[2]).trim();
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
    if (!/\.pdf$/i.test(name)) return name + '.pdf';
    return name;
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
      setCheckedFrames(all);
    } else setCheckedFrames(new Set());
  }, [videoInfo?.keyframes?.length]);
  
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

  const handleMouseDown = (e) => {
    const rect = videoRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (!isDrawMode) return;
    maybeDrawingRef.current = true;
    startClientRef.current = { x: e.clientX, y: e.clientY };
    setStartPos({ x, y });
  };

  const handleMouseMove = (e) => {
    if (!maybeDrawingRef.current && !isDrawing) return;

    const rect = videoRef.current.getBoundingClientRect();
    if (!isDrawing && maybeDrawingRef.current) {
      const dx = Math.abs(e.clientX - startClientRef.current.x);
      const dy = Math.abs(e.clientY - startClientRef.current.y);
      const dragThreshold = 6; 
      if (dx < dragThreshold && dy < dragThreshold) return;
      setIsDrawing(true);
      maybeDrawingRef.current = false;
      setCropRect({ x: startPos.x, y: startPos.y, width: 0, height: 0 });
    }

    if (isDrawing) {
      const currentX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const currentY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

      setCropRect({
        x: Math.min(startPos.x, currentX),
        y: Math.min(startPos.y, currentY),
        width: Math.abs(currentX - startPos.x),
        height: Math.abs(currentY - startPos.y),
      });
    }
  };

  const handleMouseUp = () => {
    if (isDrawing) setIsDrawing(false);
    maybeDrawingRef.current = false;
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
      try { localStorage.setItem('drawMode', next ? 'true' : 'false'); } catch (e) {}
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
    <div className="max-w-5xl mx-auto p-6 md:p-10">
      
      <header className="flex justify-between items-center mb-10 pb-5 border-b-2 border-slate-200 dark:border-slate-700">
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
          🎵 Sheet Music Extractor
        </h1>
        <div className="flex gap-3">
          <button 
            className="px-4 py-2 rounded-lg font-semibold text-sm cursor-pointer transition-all duration-200 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-200"
            onClick={handleReset}
          >
            🔄 Reset
          </button>
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)} 
            className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-lg"
            title="Toggle theme"
          >
            {isDarkMode ? '☀️' : '🌙'}
          </button>
        </div>
      </header>
      
      <div className={cardClass}>
        <h3 className="text-lg font-bold mb-4">📁 1. Select video and extraction settings</h3>
        <input 
          type="file" 
          accept="video/*" 
          onChange={handleManualUpload} 
          disabled={videoInfo?.status === 'processing'}
          className="block w-full text-sm text-slate-500 dark:text-slate-400 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-slate-700 dark:file:text-blue-400 dark:hover:file:bg-slate-600 transition-all cursor-pointer border border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-4 bg-slate-50 dark:bg-slate-800/50"
        />
        
        {videoPreviewUrl && (
          <div className="mt-6 flex flex-col items-center">
            <div className="w-full flex items-center justify-between mb-2">
              <p className="text-sm text-slate-500 dark:text-slate-400 font-medium flex items-center gap-2">
                <span className="text-lg">💡</span> Drag over the video to select the score area.
              </p>
            </div>
            
            {/* 비디오 및 드래그 영역 컨테이너 */}
            <div 
              className={`relative w-full max-w-4xl border-2 border-slate-300 dark:border-slate-600 rounded-xl bg-black overflow-hidden shadow-inner ${isDrawMode ? 'cursor-crosshair select-none' : ''}`}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <div className="absolute top-3 right-3 z-20 flex flex-col items-end gap-2">
                <div className="relative group">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleToggleDrawMode(); }}
                    className={`w-12 h-6 rounded-full transition-colors flex items-center px-1 ${isDrawMode ? 'bg-amber-500' : 'bg-slate-500/50 backdrop-blur-sm'}`}
                    title={isDrawMode ? 'Draw ROI: ON' : 'Draw ROI: OFF'}
                  >
                    <span className={`w-4 h-4 bg-white rounded-full shadow transform transition-transform ${isDrawMode ? 'translate-x-6' : 'translate-x-0'}`} />
                  </button>
                  <div className="absolute -top-10 right-0 opacity-0 group-hover:opacity-100 pointer-events-none bg-slate-800 text-white text-xs rounded py-1.5 px-3 whitespace-nowrap transition-opacity shadow-lg">
                    {isDrawMode ? 'Draw ROI: ON — drag to select an area' : 'Draw ROI: OFF — video controls enabled'}
                  </div>
                </div>
                {cropRect && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setCropRect(null); maybeDrawingRef.current = false; setIsDrawing(false); }}
                    className="text-xs font-bold bg-white/90 hover:bg-white text-slate-800 px-3 py-1.5 rounded-md shadow backdrop-blur-sm transition-colors"
                  >
                    ✖ Clear ROI
                  </button>
                )}
              </div>

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
                  className="absolute border-2 border-blue-500 bg-blue-500/20 pointer-events-none"
                  style={{
                    left: `${cropRect.x * 100}%`,
                    top: `${cropRect.y * 100}%`,
                    width: `${cropRect.width * 100}%`,
                    height: `${cropRect.height * 100}%`
                  }}
                />
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">Filename</span>
              <span className="font-medium text-slate-800 dark:text-slate-200 truncate block">{videoInfo.original_filename}</span>
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
                  onClick={() => setSelectedImage(imageUrl)}
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

      {selectedImage && (
        <div 
          className="fixed inset-0 bg-slate-900/95 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setSelectedImage(null)}
        >
          <div className="relative max-w-[95vw] max-h-[95vh] flex items-center justify-center">
            <button 
              onClick={() => setSelectedImage(null)} 
              className="absolute -top-12 right-0 text-white/70 hover:text-white text-4xl transition-colors"
            >
              &times;
            </button>
            <img 
              src={selectedImage} 
              alt="Enlarged" 
              className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl bg-white dark:bg-slate-900" 
              onClick={(e) => e.stopPropagation()} 
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;