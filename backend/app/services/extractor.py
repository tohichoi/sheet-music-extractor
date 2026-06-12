# backend/app/services/extractor.py
import cv2
import os
import subprocess
import numpy as np
import shutil
from typing import List, Dict, Callable, Optional
from sklearn.cluster import AgglomerativeClustering

from sqlalchemy.orm import Session
from app.core.database import SessionLocal
from app.models.video import Video, KeyFrame

KEYFRAME_DIR = "./storage/keyframes"
TEMP_DIR = "./storage/temp"

# ==========================================
# 1. DB 헬퍼 함수
# ==========================================
def update_video_status(db: Session, video: Video, status: str, progress: float):
    """비디오의 상태와 진행률을 업데이트합니다."""
    video.status = status
    video.progress = progress
    db.commit()

def save_keyframes_to_db(db: Session, video_id: int, keyframes_data: List[Dict]):
    """추출된 키프레임 정보를 데이터베이스에 일괄 저장합니다."""
    for kf in keyframes_data:
        db_filepath = f"./storage/keyframes/{video_id}/{kf['filename']}"
        new_keyframe = KeyFrame(video_id=video_id, timestamp=kf['timestamp'], image_filepath=db_filepath)
        db.add(new_keyframe)
    db.commit()


# ==========================================
# 2. 단위 기능 헬퍼 함수 (리팩토링 영역)
# ==========================================
def get_timestamps_via_ffprobe(file_path: str) -> List[float]:
    """FFprobe를 사용하여 I-Frame의 타임스탬프 배열을 추출합니다."""
    probe_cmd = [
        "ffprobe", "-loglevel", "error",
        "-skip_frame", "nokey", "-select_streams", "v:0",
        "-show_entries", "frame=pkt_pts_time", "-of", "csv=print_section=0",
        file_path
    ]
    probe_output = subprocess.check_output(probe_cmd).decode('utf-8')
    return [float(line.strip()) for line in probe_output.split('\n') if line.strip()]

def extract_iframes_via_ffmpeg(file_path: str, temp_dir: str) -> None:
    """FFmpeg를 사용하여 I-Frame 이미지를 임시 폴더에 디코딩합니다."""
    ffmpeg_cmd = [
        "ffmpeg", "-y", "-i", file_path,
        "-vf", "select='eq(pict_type,PICT_TYPE_I)'",
        "-vsync", "vfr", "-q:v", "2",
        os.path.join(temp_dir, "iframe_%04d.jpg")
    ]
    subprocess.run(ffmpeg_cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)

def crop_image_by_ratio(frame: np.ndarray, crop_rect: tuple) -> np.ndarray:
    """주어진 비율(crop_rect)에 따라 이미지를 일관되게 자릅니다."""
    if frame is None:
        return None
    cx, cy, cw, ch = crop_rect
    h, w = frame.shape[:2]
    x1, y1 = int(w * cx), int(h * cy)
    x2, y2 = int(w * (cx + cw)), int(h * (cy + ch))
    return frame[y1:y2, x1:x2]

def perform_clustering(features: List[np.ndarray], threshold: float = 0.03) -> np.ndarray:
    """특징 벡터를 기반으로 코사인 유사도 클러스터링을 수행합니다."""
    X = np.array(features)
    try:
        clustering = AgglomerativeClustering(n_clusters=None, distance_threshold=threshold, metric='cosine', linkage='average')
        return clustering.fit_predict(X)
    except TypeError:
        clustering = AgglomerativeClustering(n_clusters=None, distance_threshold=threshold, affinity='cosine', linkage='average')
        return clustering.fit_predict(X)


# ==========================================
# 3. 핵심 파일 처리 루틴 (DB 의존성 없음)
# ==========================================
def extract_keyframes_core(
        file_path: str,
        output_dir: str,
        temp_dir: str,
        crop_rect: tuple,
        progress_callback: Optional[Callable[[float], None]] = None
) -> List[Dict]:
    """
    모듈화된 헬퍼 함수들을 조율하여 최종 키프레임을 추출합니다.
    """
    if progress_callback: progress_callback(10.0)

    # 1. 타임스탬프 및 I-Frame 추출
    timestamps = get_timestamps_via_ffprobe(file_path)
    extract_iframes_via_ffmpeg(file_path, temp_dir)

    if progress_callback: progress_callback(40.0)

    # 2. ROI 크롭 및 특징(Feature) 추출
    extracted_files = sorted([f for f in os.listdir(temp_dir) if f.startswith("iframe_")])
    features, valid_files, valid_timestamps = [], [], []

    for i, filename in enumerate(extracted_files):
        filepath = os.path.join(temp_dir, filename)
        frame = cv2.imread(filepath)
        if frame is None: continue

        # ✨ 중복 제거된 크롭 헬퍼 함수 사용
        roi_frame = crop_image_by_ratio(frame, crop_rect)

        small_frame = cv2.resize(roi_frame, (64, 64))
        gray = cv2.cvtColor(small_frame, cv2.COLOR_BGR2GRAY)
        features.append(gray.flatten())
        valid_files.append(filename)

        ts = timestamps[i] if i < len(timestamps) else (i * 1.0)
        valid_timestamps.append(ts)

    if progress_callback: progress_callback(70.0)

    # 3. 클러스터링 기반 중복 제거 및 최종 저장
    results = []
    if len(features) > 0:
        labels = perform_clustering(features)
        seen_clusters = set()
        saved_count = 0

        for idx, label in enumerate(labels):
            if label not in seen_clusters:
                seen_clusters.add(label)

                src_path = os.path.join(temp_dir, valid_files[idx])
                frame = cv2.imread(src_path)

                if frame is not None:
                    # ✨ 중복 제거된 크롭 헬퍼 함수 재사용
                    roi_frame = crop_image_by_ratio(frame, crop_rect)

                    final_filename = f"frame_{saved_count:04d}.jpg"
                    dest_path = os.path.join(output_dir, final_filename)

                    cv2.imwrite(dest_path, roi_frame)

                    results.append({
                        "timestamp": valid_timestamps[idx],
                        "filename": final_filename
                    })
                    saved_count += 1

    if progress_callback: progress_callback(90.0)
    return results


# ==========================================
# 4. 백그라운드 오케스트레이터
# ==========================================
def process_video_background(video_id: int, crop_rect: tuple = (0.0, 0.0, 1.0, 1.0)):
    """DB 연동과 파일 처리 코어를 연결합니다."""
    db: Session = SessionLocal()
    try:
        video = db.query(Video).filter(Video.id == video_id).first()
        if not video:
            return

        update_video_status(db, video, "processing", 5.0)

        video_keyframe_dir = os.path.join(KEYFRAME_DIR, str(video.id))
        temp_video_dir = os.path.join(TEMP_DIR, str(video.id))
        os.makedirs(video_keyframe_dir, exist_ok=True)
        os.makedirs(temp_video_dir, exist_ok=True)

        def update_progress(p: float):
            update_video_status(db, video, "processing", p)

        keyframes_data = extract_keyframes_core(
            file_path=video.stored_filepath,
            output_dir=video_keyframe_dir,
            temp_dir=temp_video_dir,
            crop_rect=crop_rect,
            progress_callback=update_progress
        )

        save_keyframes_to_db(db, video.id, keyframes_data)
        update_video_status(db, video, "completed", 100.0)

    except Exception as e:
        print(f"Error processing video {video_id}: {e}")
        if 'video' in locals() and video:
            update_video_status(db, video, "failed", video.progress)

    finally:
        temp_video_dir_cleanup = os.path.join(TEMP_DIR, str(video_id))
        if os.path.exists(temp_video_dir_cleanup):
            shutil.rmtree(temp_video_dir_cleanup, ignore_errors=True)
        db.close()