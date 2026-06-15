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
# 🌟 1. FFprobe 타임스탬프 추출 함수 (파이썬 필터링 방식으로 에러 완벽 해결)
def get_timestamps_via_ffprobe(file_path: str, start_time: Optional[float] = None, end_time: Optional[float] = None) -> List[float]:
    probe_cmd = [
        "ffprobe", "-loglevel", "error",
        "-skip_frame", "nokey", "-select_streams", "v:0",
        "-show_entries", "frame=pkt_pts_time", "-of", "csv=print_section=0",
        file_path
    ]
    probe_output = subprocess.check_output(probe_cmd).decode('utf-8')
    all_timestamps = [float(line.strip()) for line in probe_output.split('\n') if line.strip()]

    # 🌟 Python에서 구간을 정확하게 필터링하여 ffprobe 옵션 에러 방지
    # ffmpeg이 추출하는 프레임 동작(-ss, -to)과 100% 완벽하게 매칭됩니다.
    s_time = start_time if start_time is not None else 0.0
    e_time = end_time if end_time is not None else float('inf')

    return [ts for ts in all_timestamps if s_time <= ts <= e_time]


# 🌟 2. FFmpeg 이미지 추출 함수 (유지 - ffmpeg은 -ss 와 -to를 정상 지원합니다)
def extract_iframes_via_ffmpeg(file_path: str, temp_dir: str, start_time: Optional[float] = None, end_time: Optional[float] = None) -> None:
    ffmpeg_cmd = ["ffmpeg", "-y"]

    if start_time is not None and start_time > 0:
        ffmpeg_cmd.extend(["-ss", str(start_time)])
    if end_time is not None and end_time > 0:
        ffmpeg_cmd.extend(["-to", str(end_time)])

    ffmpeg_cmd.extend([
        "-i", file_path,
        "-vf", "select='eq(pict_type,PICT_TYPE_I)'",
        "-vsync", "vfr", "-q:v", "2",
        os.path.join(temp_dir, "iframe_%04d.jpg")
    ])
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

# 🌟 새로 추가된 Pixel Projection 기반 자동 크롭 알고리즘
def auto_crop_by_projection(image: np.ndarray, margin: int = 10) -> np.ndarray:
    if image is None or image.size == 0:
        return image

    # ✨ 1. 블러를 추가하여 비디오 특유의 미세한 압축 노이즈를 부드럽게 뭉갭니다.
    blurred = cv2.GaussianBlur(image, (3, 3), 0)
    gray = cv2.cvtColor(blurred, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    h, w = thresh.shape

    # --- 1단계: 가장자리 검은색 띠(레터박스) 제거 ---
    row_density = np.sum(thresh == 255, axis=1) / w
    col_density = np.sum(thresh == 255, axis=0) / h

    # 검은색 띠의 기준을 50%로 낮추어 더 확실하게 잡습니다.
    def get_valid_bounds(density_array, threshold=0.50):
        start, end = 0, len(density_array) - 1
        # 바깥에서부터 안쪽으로 탐색
        while start < end and density_array[start] > threshold:
            start += 1
        while end > start and density_array[end] > threshold:
            end -= 1
        return start, end

    r_start, r_end = get_valid_bounds(row_density, 0.50)
    c_start, c_end = get_valid_bounds(col_density, 0.50)

    # ✨ 2. 핵심 방어: 검은색 띠가 발견된 경우, 그라데이션 찌꺼기를 피하기 위해 안쪽으로 15픽셀 더 깎아냅니다.
    safe_trim = 15
    if r_start > 0: r_start = min(r_start + safe_trim, h - 1)
    if r_end < h - 1: r_end = max(r_end - safe_trim, 0)
    if c_start > 0: c_start = min(c_start + safe_trim, w - 1)
    if c_end < w - 1: c_end = max(c_end - safe_trim, 0)

    if r_start >= r_end or c_start >= c_end:
        return image

    cropped_img = image[r_start:r_end+1, c_start:c_end+1]
    cropped_thresh = thresh[r_start:r_end+1, c_start:c_end+1]

    # --- 2단계: 내용물이 있는 영역으로 Pixel Projection (타이트 핏) ---
    row_proj = np.sum(cropped_thresh, axis=1)
    col_proj = np.sum(cropped_thresh, axis=0)

    # ✨ 3. 노이즈 허용치 대폭 상향 (2픽셀 -> 15픽셀)
    # 먼지나 안티앨리어싱 찌꺼기가 아닌, 최소 15픽셀 이상의 '진짜 잉크(음표/오선지)'만 내용으로 인정합니다.
    noise_tol = 255 * 15
    valid_rows = np.where(row_proj > noise_tol)[0]
    valid_cols = np.where(col_proj > noise_tol)[0]

    if len(valid_rows) == 0 or len(valid_cols) == 0:
        return cropped_img

    y_min, y_max = valid_rows[0], valid_rows[-1]
    x_min, x_max = valid_cols[0], valid_cols[-1]

    # 여백(margin) 추가 로직
    new_h, new_w = cropped_img.shape[:2]
    y_min = max(0, y_min - margin)
    y_max = min(new_h, y_max + margin)
    x_min = max(0, x_min - margin)
    x_max = min(new_w, x_max + margin)

    return cropped_img[y_min:y_max, x_min:x_max]

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
# 🌟 3. 핵심 코어 함수 (파라미터 추가 및 헬퍼 함수 호출부 수정)
def extract_keyframes_core(
        file_path: str,
        output_dir: str,
        temp_dir: str,
        cache_dir: str,
        crop_rect: tuple,
        start_time: Optional[float] = None, # 파라미터 추가
        end_time: Optional[float] = None,   # 파라미터 추가
        progress_callback: Optional[Callable[[float], None]] = None
) -> List[Dict]:
    if progress_callback: progress_callback(10.0)

    timestamps_file = os.path.join(cache_dir, "timestamps.txt")
    cached_files = [f for f in os.listdir(cache_dir) if f.startswith("iframe_")] if os.path.exists(cache_dir) else []

    if os.path.exists(timestamps_file) and len(cached_files) > 0:
        print(f"🚀 [Cache Hit] 이미 추출된 원본 I-Frame ({len(cached_files)}장)을 작업 폴더로 복사합니다!")
        shutil.copytree(cache_dir, temp_dir, dirs_exist_ok=True)
        with open(timestamps_file, 'r') as f:
            timestamps = [float(line.strip()) for line in f.readlines()]
    else:
        print("⏳ [Cache Miss] FFmpeg로 I-Frame 추출을 시작합니다...")
        os.makedirs(cache_dir, exist_ok=True)

        # 수정된 함수들에 start_time과 end_time을 넘겨줍니다.
        timestamps = get_timestamps_via_ffprobe(file_path, start_time, end_time)
        with open(timestamps_file, 'w') as f:
            for ts in timestamps:
                f.write(f"{ts}\n")

        extract_iframes_via_ffmpeg(file_path, cache_dir, start_time, end_time)
        shutil.copytree(cache_dir, temp_dir, dirs_exist_ok=True)

    if progress_callback: progress_callback(40.0)

    # 🌟 2. ROI 크롭 및 특징(Feature) 추출 + 파일 교체(덮어쓰기)
    extracted_files = sorted([f for f in os.listdir(temp_dir) if f.startswith("iframe_")])
    features, valid_files, valid_timestamps = [], [], []

    for i, filename in enumerate(extracted_files):
        filepath = os.path.join(temp_dir, filename)
        frame = cv2.imread(filepath)
        if frame is None: continue

        roi_frame = crop_image_by_ratio(frame, crop_rect)
        roi_frame = auto_crop_by_projection(roi_frame, margin=10)

        if roi_frame is None or roi_frame.size == 0:
            continue

        # ✨ 핵심: 크롭된 이미지를 원본 파일에 완벽하게 덮어쓰기!
        cv2.imwrite(filepath, roi_frame)

        small_frame = cv2.resize(roi_frame, (64, 64))
        gray = cv2.cvtColor(small_frame, cv2.COLOR_BGR2GRAY)

        features.append(gray.flatten())
        valid_files.append(filename)
        ts = timestamps[i] if i < len(timestamps) else (i * 1.0)
        valid_timestamps.append(ts)

    if progress_callback: progress_callback(70.0)

    # 🌟 3. 클러스터링 기반 중복 제거 및 최종 저장
    results = []
    if len(features) > 0:
        labels = perform_clustering(features)
        seen_clusters = set()
        saved_count = 0

        for idx, label in enumerate(labels):
            if label not in seen_clusters:
                seen_clusters.add(label)

                # Step 2에서 덮어씌워진(이미 완벽하게 크롭된) 파일을 그대로 가져옴
                src_path = os.path.join(temp_dir, valid_files[idx])
                final_filename = f"frame_{saved_count:04d}.jpg"
                dest_path = os.path.join(output_dir, final_filename)

                # 🚀 다시 읽고 자를 필요 없이 가장 빠른 파일 복사(shutil.copy)로 마무리!
                shutil.copy(src_path, dest_path)

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
def process_video_background(
    video_id: int,
    crop_rect: tuple = (0.0, 0.0, 1.0, 1.0),
    base_file_hash: str = "",
    start_time: Optional[float] = None, # 🌟 추가
    end_time: Optional[float] = None    # 🌟 추가
):
    db: Session = SessionLocal()
    try:
        video = db.query(Video).filter(Video.id == video_id).first()
        if not video:
            return

        update_video_status(db, video, "processing", 5.0)

        video_keyframe_dir = os.path.join(KEYFRAME_DIR, str(video.id))

        # 🌟 캐시 폴더 이름에 시간 구간 반영 (캐시 꼬임 완벽 방지)
        if base_file_hash:
            s_str = f"{start_time:.2f}" if start_time else "start"
            e_str = f"{end_time:.2f}" if end_time else "end"
            cache_folder_name = f"{base_file_hash}_{s_str}_{e_str}"
            cache_dir = os.path.join(CACHE_DIR, cache_folder_name)
        else:
            cache_dir = os.path.join(CACHE_DIR, f"temp_{video.id}")

        temp_video_dir = os.path.join(TEMP_DIR, str(video.id)) # 무조건 고유 임시 폴더 사용

        os.makedirs(video_keyframe_dir, exist_ok=True)
        os.makedirs(temp_video_dir, exist_ok=True)

        def update_progress(p: float):
            update_video_status(db, video, "processing", p)

        # 🌟 핵심 코어에 시간 구간 파라미터 전달
        keyframes_data = extract_keyframes_core(
            file_path=video.stored_filepath,
            output_dir=video_keyframe_dir,
            temp_dir=temp_video_dir,
            cache_dir=cache_dir,
            crop_rect=crop_rect,
            start_time=start_time, # 추가
            end_time=end_time,     # 추가
            progress_callback=update_progress
        )

        save_keyframes_to_db(db, video.id, keyframes_data)
        update_video_status(db, video, "completed", 100.0)

    except Exception as e:
        print(f"Error processing video {video_id}: {e}")
        if 'video' in locals() and video:
            update_video_status(db, video, "failed", video.progress)

    finally:
        # 🌟 작업이 끝나면 고유 임시 폴더(temp_video_dir)는 무조건 삭제! (공용 캐시 폴더는 유지됨)
        temp_video_dir_cleanup = os.path.join(TEMP_DIR, str(video_id))
        if os.path.exists(temp_video_dir_cleanup):
            shutil.rmtree(temp_video_dir_cleanup, ignore_errors=True)
        db.close()