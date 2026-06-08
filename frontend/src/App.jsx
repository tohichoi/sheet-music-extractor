import { useState, useEffect } from 'react';

function App() {
  const [status, setStatus] = useState('Waiting...');
  const [videoInfo, setVideoInfo] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [thumbSize, setThumbSize] = useState(200);

  const API_BASE_URL = 'http://localhost:8000/api/videos';
  const STATIC_BASE_URL = 'http://localhost:8000';

  // Polling logic to periodically check backend status
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
          // Keep the text stable and omit any percentage display.
          setStatus('⚙️ Extracting sheet-music keyframes... (background processing)');
        } else if (data.status === 'completed') {
          setStatus('✅ Extraction completed!');
          clearInterval(intervalId);
        } else if (data.status === 'failed') {
          setStatus('❌ Extraction failed');
          clearInterval(intervalId);
        }
      } catch (error) {
        console.error('Error checking status:', error);
      }
    };

    if (videoInfo && (videoInfo.status === 'uploaded' || videoInfo.status === 'processing')) {
      intervalId = setInterval(checkProcessingStatus, 2000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [videoInfo?.id, videoInfo?.status]);

  const uploadVideo = async (fileToUpload) => {
    setStatus('🚀 Uploading...');
    const formData = new FormData();
    formData.append('file', fileToUpload);

    try {
      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error('Upload failed');
      
      const data = await response.json();
      
      if (data.status === 'completed') {
        setStatus('✅ Video already processed. Loading existing result.');
      } else if (data.status === 'processing') {
        setStatus('⚙️ Extracting sheet-music keyframes... (background processing)');
      } else {
        setStatus('📁 Upload complete! Waiting for extraction.');
      }

      setVideoInfo(data);
    } catch (error) {
      console.error(error);
      setStatus(`Error occurred: ${error.message}`);
    }
  };

  const handleManualUpload = (e) => {
    const file = e.target.files[0];
    if (file) uploadVideo(file);
  };

  const handleAutoTestUpload = async () => {
    setStatus('Loading test file...');
    try {
      const response = await fetch('/data/test_video.webm');
      if (!response.ok) throw new Error('Test file not found.');
      
      const blob = await response.blob();
      const testFile = new File([blob], 'test_video.webm', { type: 'video/webm' });
      
      uploadVideo(testFile);
    } catch (error) {
      console.error(error);
      setStatus(`Test file load error: ${error.message}`);
    }
  };

  const handleExportPDF = async () => {
    if (!videoInfo || !videoInfo.id) return;
    try {
      setStatus('📄 Generating and downloading PDF...');
      const response = await fetch(`${API_BASE_URL}/${videoInfo.id}/pdf`);
      if (!response.ok) throw new Error('Failed to create PDF.');

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `sheet_music_video_${videoInfo.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
      
      setStatus('✅ PDF download complete!');
    } catch (error) {
      console.error('PDF Export Error:', error);
      alert(`Error: ${error.message}`);
      setStatus('❌ PDF download failed');
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return 'Unknown';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}m ${s.toString().padStart(2, '0')}s`;
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return 'Unknown';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '1000px', margin: '0 auto' }}>
      <h1>🎵 Sheet Music Keyframe Extractor</h1>
      
      <div style={{ padding: '1rem', background: '#f0f0f0', borderRadius: '8px', marginBottom: '2rem' }}>
        <h3>🛠️ Quick Test for Development</h3>
        <button 
          onClick={handleAutoTestUpload}
          disabled={videoInfo?.status === 'processing'}
          style={{ padding: '0.5rem 1rem', background: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          🚀 Upload test video automatically
        </button>
      </div>

      <div style={{ marginBottom: '2rem', padding: '1rem', background: '#f8f9fa', borderRadius: '8px' }}>
        <h3>📁 Upload Video File</h3>
        <input type="file" accept="video/*" onChange={handleManualUpload} disabled={videoInfo?.status === 'processing'} />
      </div>

      {videoInfo && videoInfo.width && (
        <div style={{ marginBottom: '2rem', padding: '1.5rem', background: '#e9ecef', borderRadius: '8px', borderLeft: '5px solid #6c757d' }}>
          <h3 style={{ marginTop: 0, color: '#495057' }}>📊 Original Video Info</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.95rem' }}>
            <div><strong>Filename:</strong> {videoInfo.original_filename}</div>
            <div><strong>File size:</strong> {formatFileSize(videoInfo.file_size)}</div>
            <div><strong>Resolution:</strong> {videoInfo.width} x {videoInfo.height}</div>
            <div><strong>Duration:</strong> {formatDuration(videoInfo.duration)}</div>
            <div><strong>Frame rate:</strong> {videoInfo.fps ? videoInfo.fps.toFixed(2) : 'Unknown'} FPS</div>
            <div><strong>Upload time:</strong> {new Date(videoInfo.upload_time).toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* 🌟 Status display and progress bar area */}
      <div style={{ marginTop: '2rem', padding: '1.5rem', border: '2px solid #007bff', borderRadius: '8px', background: '#e9f5ff' }}>
        <h3 style={{ margin: 0, marginBottom: videoInfo?.status === 'processing' ? '1rem' : '0' }}>
          <strong>Current status:</strong> {status}
        </h3>
        
        {/* Show a visual progress bar only while processing */}
        {videoInfo?.status === 'processing' && (
          <div style={{ width: '100%', background: '#e0e0e0', borderRadius: '12px', overflow: 'hidden', height: '24px', marginTop: '1rem', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)' }}>
            <div style={{
              width: `${videoInfo.progress || 0}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #4facfe 0%, #00f2fe 100%)', // Nice gradient color
              transition: 'width 0.5s ease-in-out', // Smooth fill animation
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: 'bold',
              fontSize: '0.85rem',
              textShadow: '1px 1px 1px rgba(0,0,0,0.3)'
            }}>
              {videoInfo.progress || 0}%
            </div>
          </div>
        )}
      </div>

      {videoInfo?.status === 'completed' && videoInfo?.keyframes && (
        <div style={{ marginTop: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #ccc' }}>
            <h3>🖼️ Extracted sheet music ({videoInfo.keyframes.length} frames)</h3>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                🔍 Thumbnail size:
                <input type="range" min="100" max="400" value={thumbSize} onChange={(e) => setThumbSize(Number(e.target.value))} />
              </label>
              <button onClick={handleExportPDF} style={{ padding: '0.5rem 1rem', background: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                📄 Download as PDF bundle
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))`, gap: '1rem' }}>
            {videoInfo.keyframes.map((frame, index) => {
              const imageUrl = `${STATIC_BASE_URL}/${frame.image_filepath.replace('./', '')}`;
              return (
                <div 
                  key={frame.id} 
                  style={{ border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.2s' }}
                  onClick={() => setSelectedImage(imageUrl)}
                  onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                  onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                  <img src={imageUrl} alt={`Frame ${index + 1}`} style={{ width: '100%', height: 'auto', display: 'block', borderBottom: '1px solid #eee' }} />
                  <div style={{ padding: '0.5rem', textAlign: 'center', background: '#fafafa', fontSize: '0.9em' }}>
                    <strong>#{index + 1}</strong> ({frame.timestamp.toFixed(2)}s)
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {selectedImage && (
        <div 
          style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}
          onClick={() => setSelectedImage(null)}
        >
          <div style={{ position: 'relative', maxWidth: '90%', maxHeight: '90%' }}>
            <button onClick={() => setSelectedImage(null)} style={{ position: 'absolute', top: '-40px', right: '0', background: 'transparent', color: 'white', border: 'none', fontSize: '2rem', cursor: 'pointer' }}>
              &times;
            </button>
            <img src={selectedImage} alt="Enlarged" style={{ maxWidth: '100%', maxHeight: '90vh', objectFit: 'contain', background: 'white' }} onClick={(e) => e.stopPropagation()} />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;