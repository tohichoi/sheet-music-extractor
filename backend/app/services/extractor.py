# backend/app/services/extractor.py
import cv2
import os
import subprocess
import numpy as np
import shutil
from typing import List, Dict, Callable, Optional
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics import silhouette_score

from sqlalchemy.orm import Session
from app.core.database import SessionLocal
from app.models.video import Video, KeyFrame

KEYFRAME_DIR = "./storage/keyframes"
TEMP_DIR = "./storage/temp"
CACHE_DIR = "./storage/cache/iframes" # 🌟 공용 캐시 폴더 추가

# ==========================================
# 1. DB 헬퍼 함수
# ==========================================
def update_video_status(db: Session, video: Video, status: str, progress: float):
    video.status = status
    video.progress = progress
    db.commit()

def save_keyframes_to_db(db: Session, video_id: int, keyframes_data: List[Dict]):
    for kf in keyframes_data:
        db_filepath = f"./storage/keyframes/{video_id}/{kf['filename']}"
        new_keyframe = KeyFrame(video_id=video_id, timestamp=kf['timestamp'], image_filepath=db_filepath)
        db.add(new_keyframe)
    db.commit()

# ==========================================
# 2. 단위 기능 헬퍼 함수
# ==========================================
def get_timestamps_via_ffprobe(file_path: str) -> List[float]:
    probe_cmd = [
        "ffprobe", "-loglevel", "error",
        "-skip_frame", "nokey", "-select_streams", "v:0",
        "-show_entries", "frame=pkt_pts_time", "-of", "csv=print_section=0",
        file_path
    ]
    probe_output = subprocess.check_output(probe_cmd).decode('utf-8')
    return [float(line.strip()) for line in probe_output.split('\n') if line.strip()]

def extract_iframes_via_ffmpeg(file_path: str, temp_dir: str) -> None:
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

    # 🌟 에러 방지(Safeguard) 로직 추가
    # 사용자가 마우스를 클릭만 하고 드래그하지 않았거나, 영역 값이 비정상적으로 작아
    # 너비나 높이가 0 이하가 되는 경우 프로그램이 터지지 않도록 원본 프레임을 반환합니다.
    if x1 >= x2 or y1 >= y2:
        return frame

    return frame[y1:y2, x1:x2]

def find_best_threshold_silhouette(X: np.ndarray, thresholds: List[float] = [0.01, 0.02, 0.03, 0.04, 0.05, 0.08, 0.1]) -> float:
    best_threshold = 0.03
    best_score = -1
    for th in thresholds:
        try:
            clustering = AgglomerativeClustering(n_clusters=None, distance_threshold=th, metric='cosine', linkage='average')
            labels = clustering.fit_predict(X)
        except TypeError:
            clustering = AgglomerativeClustering(n_clusters=None, distance_threshold=th, affinity='cosine', linkage='average')
            labels = clustering.fit_predict(X)
        n_clusters = len(set(labels))
        if 1 < n_clusters < len(X):
            score = silhouette_score(X, labels, metric='cosine')
            if score > best_score:
                best_score = score
                best_threshold = th
    return best_threshold

def perform_clustering(features: List[np.ndarray]) -> np.ndarray:
    X = np.array(features)
    best_threshold = find_best_threshold_silhouette(X)
    print(f"💡 [Clustering] 동적 최적 Threshold 적용: {best_threshold}")
    try:
        clustering = AgglomerativeClustering(n_clusters=None, distance_threshold=best_threshold, metric='cosine', linkage='average')
        return clustering.fit_predict(X)
    except TypeError:
        clustering = AgglomerativeClustering(n_clusters=None, distance_threshold=best_threshold, affinity='cosine', linkage='average')
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
    if progress_callback: progress_callback(10.0)

    # 🌟 1. I-Frame 캐시 확인 및 재사용
    timestamps_file = os.path.join(temp_dir, "timestamps.txt")
    cached_files = [f for f in os.listdir(temp_dir) if f.startswith("iframe_")]

    # 타임스탬프 기록 파일과 이미지들이 이미 존재한다면 FFmpeg 실행 생략
    if os.path.exists(timestamps_file) and len(cached_files) > 0:
        print(f"🚀 [Cache Hit] 이미 추출된 I-Frame ({len(cached_files)}장)을 재사용합니다!")
        with open(timestamps_file, 'r') as f:
            timestamps = [float(line.strip()) for line in f.readlines()]
    else:
        print("⏳ [Cache Miss] FFmpeg로 I-Frame 추출을 시작합니다...")
        timestamps = get_timestamps_via_ffprobe(file_path)
        # 나중을 위해 타임스탬프 저장
        with open(timestamps_file, 'w') as f:
            for ts in timestamps:
                f.write(f"{ts}\n")
        extract_iframes_via_ffmpeg(file_path, temp_dir)

    if progress_callback: progress_callback(40.0)

    # 2. ROI 크롭 및 특징(Feature) 추출
    extracted_files = sorted([f for f in os.listdir(temp_dir) if f.startswith("iframe_")])
    features, valid_files, valid_timestamps = [], [], []

    for i, filename in enumerate(extracted_files):
        filepath = os.path.join(temp_dir, filename)
        frame = cv2.imread(filepath)
        if frame is None: continue

        roi_frame = crop_image_by_ratio(frame, crop_rect)

        # 🌟 roi_frame이 정상적인지 한 번 더 확인
        if roi_frame is None or roi_frame.size == 0:
            continue

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
def process_video_background(video_id: int, crop_rect: tuple = (0.0, 0.0, 1.0, 1.0), base_file_hash: str = ""):
    db: Session = SessionLocal()
    try:
        video = db.query(Video).filter(Video.id == video_id).first()
        if not video:
            return

        update_video_status(db, video, "processing", 5.0)

        video_keyframe_dir = os.path.join(KEYFRAME_DIR, str(video.id))

        # 🌟 base_file_hash가 있으면 공용 캐시 폴더를, 없으면 기존처럼 임시 폴더를 사용
        if base_file_hash:
            temp_video_dir = os.path.join(CACHE_DIR, base_file_hash)
        else:
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
        # 🌟 캐시 폴더는 삭제하지 않고 보존! (base_file_hash가 전달된 경우)
        if not base_file_hash:
            temp_video_dir_cleanup = os.path.join(TEMP_DIR, str(video_id))
            if os.path.exists(temp_video_dir_cleanup):
                shutil.rmtree(temp_video_dir_cleanup, ignore_errors=True)
        db.close()