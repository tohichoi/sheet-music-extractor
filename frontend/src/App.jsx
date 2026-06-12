import { useState, useEffect, useRef } from 'react';

// 🌟 새로 추가: 로컬 스토리지에서 숫자 값을 안전하게 불러오는 헬퍼 함수
const getSavedNumber = (key, defaultValue) => {
  const saved = localStorage.getItem(key);
  // 값이 0인 경우도 정상적인 여백 값일 수 있으므로 null 체크를 명확히 합니다.
  return saved !== null ? Number(saved) : defaultValue;
};


function App() {
  // 🌟 변경 전: const [isDarkMode, setIsDarkMode] = useState(false);
  // 🌟 변경 후: 로컬 스토리지에서 이전 테마 설정 불러오기
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    // 사용자의 OS 환경이 기본적으로 다크모드인지 확인하는 로직 추가 가능
    // 여기서는 저장된 값이 'dark'이면 true, 아니면 false를 반환합니다.
    return savedTheme === 'dark';
  });
  
  const [status, setStatus] = useState('Idle');
  const [videoInfo, setVideoInfo] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null); 
  // const [thumbSize, setThumbSize] = useState(250); 
  const [thumbSize, setThumbSize] = useState(() => getSavedNumber('thumbSize', 250));
  
  // const [marginTop, setMarginTop] = useState(50);
  // const [marginBottom, setMarginBottom] = useState(50);
  // const [marginLeft, setMarginLeft] = useState(50);
  // const [marginRight, setMarginRight] = useState(50);
  // const [innerMargin, setInnerMargin] = useState(10);
  const [marginTop, setMarginTop] = useState(() => getSavedNumber('marginTop', 50));
  const [marginBottom, setMarginBottom] = useState(() => getSavedNumber('marginBottom', 50));
  const [marginLeft, setMarginLeft] = useState(() => getSavedNumber('marginLeft', 50));
  const [marginRight, setMarginRight] = useState(() => getSavedNumber('marginRight', 50));
  const [innerMargin, setInnerMargin] = useState(() => getSavedNumber('innerMargin', 10));

  // 🌟 ROI 선택을 위한 상태 추가
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  
  // 드래그 상태 관리
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [cropRect, setCropRect] = useState(null); // { x, y, width, height } 비율 (0~1)
  const videoRef = useRef(null);

  const API_BASE_URL = 'http://localhost:8000/api/videos';
  const STATIC_BASE_URL = 'http://localhost:8000';

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    document.body.classList.toggle('dark', isDarkMode);
    
    // 🌟 새로 추가됨: 변경된 테마를 로컬 스토리지에 저장
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // 🌟 새로 추가됨: 앱이 처음 켜질 때 로컬 스토리지에서 마지막 작업 비디오 ID를 찾아 불러옴
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
          localStorage.removeItem('lastVideoId'); // Remove invalid saved data
          setStatus('Idle');
        });
    }
  }, []);

  // 백엔드 폴링 로직
  useEffect(() => {
    let intervalId;
    const checkProcessingStatus = async () => {
      if (!videoInfo || !videoInfo.id) return;
      try {
        const response = await fetch(`${API_BASE_URL}/${videoInfo.id}`);
        if (!response.ok) throw new Error('Status fetch failed');
        
        const data = await response.json();
        setVideoInfo(data);

        if (data.status === 'processing') {
          setStatus('⚙️ Extracting sheet music...');
        } else if (data.status === 'completed') {
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
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [videoInfo?.id, videoInfo?.status]);

  // 🌟 새로 추가: 썸네일 크기가 변경될 때마다 로컬 스토리지에 자동 저장
  useEffect(() => {
    localStorage.setItem('thumbSize', thumbSize);
  }, [thumbSize]);

  // 🌟 새로 추가: PDF 설정값이 하나라도 변경될 때마다 로컬 스토리지에 자동 저장
  useEffect(() => {
    localStorage.setItem('marginTop', marginTop);
    localStorage.setItem('marginBottom', marginBottom);
    localStorage.setItem('marginLeft', marginLeft);
    localStorage.setItem('marginRight', marginRight);
    localStorage.setItem('innerMargin', innerMargin);
  }, [marginTop, marginBottom, marginLeft, marginRight, innerMargin]);
  
  const uploadVideo = async (fileToUpload) => {
    setStatus('🚀 Uploading...');
    let formData = new FormData();
    formData.append('file', fileToUpload);
    // If crop region is selected, send the ratio. Otherwise use full frame (0,0,1,1).
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

      // 🌟 새로 추가됨: 성공적으로 업로드/조회 후 ID를 브라우저에 저장
      if (data.id) {
        localStorage.setItem('lastVideoId', data.id);
      }
    } catch (error) {
      console.error(error);
      setStatus(`Error: ${error.message}`);
    }
  };

  // 파일 선택 처리
  const handleManualUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setVideoFile(file);
      setVideoPreviewUrl(URL.createObjectURL(file));
      setCropRect(null); // 새로운 영상 업로드 시 크롭 초기화
    }
  };

  // 🌟 마우스 드래그 이벤트 핸들러
  const handleMouseDown = (e) => {
    const rect = videoRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setIsDrawing(true);
    setStartPos({ x, y });
    setCropRect({ x, y, width: 0, height: 0 });
  };

  const handleMouseMove = (e) => {
    if (!isDrawing) return;
    const rect = videoRef.current.getBoundingClientRect();
    const currentX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const currentY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    setCropRect({
      x: Math.min(startPos.x, currentX),
      y: Math.min(startPos.y, currentY),
      width: Math.abs(currentX - startPos.x),
      height: Math.abs(currentY - startPos.y),
    });
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
  };


  // 🌟 실제 서버로 전송하는 함수
  const executeUpload = async () => {
    if (!videoFile)
      return;
    
    // setStatus('🚀 업로드 중...');
    
    // const formData = new FormData();
    // formData.append('file', videoFile);
    
    // // 크롭 영역이 지정되었다면 해당 비율을 폼 데이터로 전송, 없으면 전체(0,0,1,1) 전송
    // if (cropRect && cropRect.width > 0.05 && cropRect.height > 0.05) {
    //   formData.append('crop_x', cropRect.x.toFixed(4));
    //   formData.append('crop_y', cropRect.y.toFixed(4));
    //   formData.append('crop_w', cropRect.width.toFixed(4));
    //   formData.append('crop_h', cropRect.height.toFixed(4));
    // } else {
    //   formData.append('crop_x', 0.0);
    //   formData.append('crop_y', 0.0);
    //   formData.append('crop_w', 1.0);
    //   formData.append('crop_h', 1.0);
    // }

    uploadVideo(videoFile); // 업로드 로직을 별도의 함수로 분리하여 재사용 가능하게 함
  };


  const handleAutoTestUpload = async () => {
    setStatus('Loading test file...');
    try {
      const response = await fetch('/data/test_video.webm');
      if (!response.ok) throw new Error('Test file not found');
      const blob = await response.blob();
      uploadVideo(new File([blob], "test_video.webm", { type: "video/webm" }));
    } catch (error) {
      console.error(error);
      setStatus(`Test load error: ${error.message}`);
    }
  };

  const handleExportPDF = async () => {
    if (!videoInfo || !videoInfo.id) return;
    try {
      setStatus('📄 Generating PDF...');
      const queryParams = new URLSearchParams({ marginTop, marginBottom, marginLeft, marginRight, innerMargin }).toString();
      const response = await fetch(`${API_BASE_URL}/${videoInfo.id}/pdf?${queryParams}`);
      if (!response.ok) throw new Error('PDF generation failed');

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `sheet_music_${videoInfo.id}.pdf`;
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

  // 🌟 새로 추가됨: 아예 초기화하고 싶을 때 사용하는 함수
  const handleReset = () => {
    localStorage.removeItem('lastVideoId');
    setVideoInfo(null);
    setStatus('Idle');
  };

  const formatDuration = (sec) => sec ? `${Math.floor(sec / 60)}m ${Math.floor(sec % 60).toString().padStart(2, '0')}s` : '-';
  const formatSize = (bytes) => bytes ? (bytes / (1024 * 1024)).toFixed(2) + ' MB' : '-';

  // 공통 Tailwind 클래스 모음
  const cardClass = "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 mb-6 shadow-sm transition-all duration-300";
  const btnClass = "inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm cursor-pointer transition-all duration-200 hover:-translate-y-0.5 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0";
  const inputNumClass = "w-16 px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-10">
      
      {/* 헤더 영역 */}
      <header className="flex justify-between items-center mb-10 pb-5 border-b-2 border-slate-200 dark:border-slate-700">
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
          🎵 Sheet Music Extractor
        </h1>
        <button 
          onClick={() => setIsDarkMode(!isDarkMode)} 
          className="w-12 h-12 flex items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors text-xl"
          title="Toggle theme"
        >
          {isDarkMode ? '☀️' : '🌙'}
        </button>
      </header>
      
      {/* 테스트 업로드 영역 */}
      <div className={`${cardClass} bg-slate-100/50 dark:bg-slate-800/50 flex flex-col md:flex-row justify-between items-center gap-4`}>
        <div>
          <h3 className="text-lg font-bold mb-2 flex items-center gap-2 text-slate-800 dark:text-slate-100">
            🛠️ Quick test
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">Upload a new video or reset the view.</p>
        </div>
        <div className="flex gap-3">
          <button 
            className={`${btnClass} bg-slate-500 hover:bg-slate-600 text-white shadow-slate-500/30`} 
            onClick={handleReset}
          >
            🔄 Reset view
          </button>
          <button 
            className={`${btnClass} bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/30`} 
            onClick={handleAutoTestUpload} 
            disabled={videoInfo?.status === 'processing'}
          >
            🚀 Run test upload
          </button>
        </div>
      </div>

      {/* 🌟 파일 업로드 및 ROI 선택 UI 영역 */}
      <div className={cardClass}>
        <h3 className="text-lg font-bold mb-4">📁 1. Select video and crop region</h3>
        {/* <input type="file" accept="video/*" onChange={handleManualUpload} className="mb-4 block w-full text-sm..." /> */}
        <input 
          type="file" 
          accept="video/*" 
          onChange={handleManualUpload} 
          disabled={videoInfo?.status === 'processing'}
          className="block w-full text-sm text-slate-500 dark:text-slate-400 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-slate-700 dark:file:text-blue-400 dark:hover:file:bg-slate-600 transition-all cursor-pointer border border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-4 bg-slate-50 dark:bg-slate-800/50"
        />
        
        {videoPreviewUrl && (
          <div className="mt-4">
            <p className="text-sm text-slate-500 mb-2">💡 Drag over the video to select the score area. If you skip this, the entire frame will be processed.</p>
            
            {/* 드래그 영역 컨테이너 */}
            <div 
              className="relative inline-block border-2 border-slate-300 rounded overflow-hidden cursor-crosshair select-none"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <video ref={videoRef} src={videoPreviewUrl} className="max-h-[500px] w-auto pointer-events-none" controls={false} muted />
              
              {/* 그려진 캡처 영역 표시 */}
              {cropRect && (
                <div 
                  className="absolute border-2 border-blue-500 bg-blue-500/20"
                  style={{
                    left: `${cropRect.x * 100}%`,
                    top: `${cropRect.y * 100}%`,
                    width: `${cropRect.width * 100}%`,
                    height: `${cropRect.height * 100}%`
                  }}
                />
              )}
            </div>

            <button 
              onClick={executeUpload}
              className={`${btnClass} bg-blue-600 text-white mt-4 block w-full md:w-auto`}
            >
              🚀 Start extraction
            </button>
          </div>
        )}
      </div>

      {/* 파일 업로드 및 상태 표시 */}
      <div className={`${cardClass} ${videoInfo?.status === 'processing' ? 'ring-2 ring-blue-500 shadow-lg shadow-blue-500/10' : ''}`}>
        <h3 className="text-lg font-bold mb-4 text-slate-800 dark:text-slate-100">📁 Video upload</h3>
        
        <input 
          type="file" 
          accept="video/*" 
          onChange={handleManualUpload} 
          disabled={videoInfo?.status === 'processing'}
          className="block w-full text-sm text-slate-500 dark:text-slate-400 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-slate-700 dark:file:text-blue-400 dark:hover:file:bg-slate-600 transition-all cursor-pointer border border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-4 bg-slate-50 dark:bg-slate-800/50"
        />
        
        <div className="mt-6 p-5 bg-blue-50/50 dark:bg-slate-900/50 rounded-xl border border-blue-100 dark:border-slate-700">
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

      {/* 비디오 메타데이터 */}
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
              <span className="font-medium text-slate-800 dark:text-slate-200 block">{formatDuration(videoInfo.duration)}</span>
            </div>
          </div>
        </div>
      )}

      {/* 갤러리 및 PDF 내보내기 영역 */}
      {videoInfo?.status === 'completed' && videoInfo?.keyframes && (
        <div className={cardClass}>
          
          {/* PDF 내보내기 설정 패널 */}
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

          <div className="flex flex-col md:flex-row justify-between items-center mb-6 pb-6 border-b border-slate-200 dark:border-slate-700 gap-4">
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 m-0">🖼️ Extracted sheets ({videoInfo.keyframes.length})</h3>
            <label className="flex items-center gap-3 text-sm font-medium text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 px-4 py-2 rounded-lg">
              🔍 Thumbnail size
              <input type="range" min="150" max="400" value={thumbSize} onChange={(e) => setThumbSize(Number(e.target.value))} className="accent-blue-500" />
            </label>
          </div>

          {/* 반응형 갤러리 그리드 */}
          <div className="grid gap-6" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))` }}>
            {videoInfo.keyframes.map((frame, index) => {
              const imageUrl = `${STATIC_BASE_URL}/${frame.image_filepath.replace('./', '')}`;
              return (
                <div 
                  key={frame.id} 
                  className="group bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden cursor-pointer hover:-translate-y-1 hover:shadow-lg hover:border-blue-500 dark:hover:border-blue-400 transition-all duration-300"
                  onClick={() => setSelectedImage(imageUrl)}
                >
                  <div className="aspect-video overflow-hidden bg-slate-100 dark:bg-slate-900">
                    <img src={imageUrl} alt={`Frame ${index + 1}`} loading="lazy" className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500" />
                  </div>
                  <div className="p-3 text-center bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700">
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">#{index + 1}</span>
                    <strong className="block text-slate-800 dark:text-slate-200 text-sm mt-0.5">{frame.timestamp.toFixed(2)}s</strong>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 이미지 크게 보기 모달 */}
      {selectedImage && (
        <div 
          className="fixed inset-0 bg-slate-900/90 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setSelectedImage(null)}
        >
          <div className="relative max-w-[95vw] max-h-[95vh]">
            <button 
              onClick={() => setSelectedImage(null)} 
              className="absolute -top-12 right-0 text-white hover:text-slate-300 text-4xl transition-colors"
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