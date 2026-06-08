# backend/app/services/extractor.py
import cv2
import os
from sqlalchemy.orm import Session
from app.core.database import SessionLocal
from app.models.video import Video, KeyFrame

KEYFRAME_DIR = "./storage/keyframes"

def process_video_background(video_id: int):
    db: Session = SessionLocal()
    video = db.query(Video).filter(Video.id == video_id).first()
    
    if not video:
        db.close()
        return

    video.status = "processing"
    video.progress = 0.0 # 진행률 초기화
    db.commit()

    try:
        video_keyframe_dir = os.path.join(KEYFRAME_DIR, str(video.id))
        os.makedirs(video_keyframe_dir, exist_ok=True)

        cap = cv2.VideoCapture(video.stored_filepath)
        fps = cap.get(cv2.CAP_PROP_FPS)
        # ✅ 전체 프레임 수 가져오기
        total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) 
        
        # fps가 0이거나 전체 프레임을 알 수 없는 오류 방지
        if fps <= 0: fps = 30.0 
        update_interval = int(fps) # 1초 분량마다 DB 업데이트

        prev_frame = None
        frame_count = 0
        saved_count = 0

        PIXEL_DIFF_THRESHOLD = 30 
        AREA_CHANGE_RATIO = 0.15   

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            small_frame = cv2.resize(frame, (160, 90))
            gray = cv2.cvtColor(small_frame, cv2.COLOR_BGR2GRAY)
            blurred = cv2.GaussianBlur(gray, (5, 5), 0)

            if prev_frame is not None:
                diff = cv2.absdiff(prev_frame, blurred)
                _, thresh = cv2.threshold(diff, PIXEL_DIFF_THRESHOLD, 255, cv2.THRESH_BINARY)
                
                changed_pixels = cv2.countNonZero(thresh)
                total_pixels = blurred.shape[0] * blurred.shape[1]
                change_ratio = changed_pixels / total_pixels

                if change_ratio > AREA_CHANGE_RATIO:
                    timestamp = frame_count / fps
                    filename = f"frame_{saved_count:04d}.jpg"
                    filepath = os.path.join(video_keyframe_dir, filename)
                    cv2.imwrite(filepath, frame)

                    db_filepath = f"./storage/keyframes/{video.id}/{filename}"
                    new_keyframe = KeyFrame(video_id=video.id, timestamp=timestamp, image_filepath=db_filepath)
                    db.add(new_keyframe)
                    saved_count += 1
            elif frame_count == 0:
                timestamp = 0.0
                filename = f"frame_{saved_count:04d}.jpg"
                filepath = os.path.join(video_keyframe_dir, filename)
                cv2.imwrite(filepath, frame)
                
                db_filepath = f"./storage/keyframes/{video.id}/{filename}"
                db.add(KeyFrame(video_id=video.id, timestamp=timestamp, image_filepath=db_filepath))
                saved_count += 1

            prev_frame = blurred
            frame_count += 1

            # ✅ 진행률 DB 업데이트 로직 (1초마다 한 번씩만 업데이트하여 DB 부하 방지)
            if total_frames > 0 and frame_count % update_interval == 0:
                current_progress = (frame_count / total_frames) * 100
                video.progress = round(current_progress, 1) # 소수점 첫째 자리까지
                db.commit()

        cap.release()
        
        # ✅ 작업 완료 시 진행률 100% 반영
        video.progress = 100.0
        video.status = "completed"
        db.commit()

    except Exception as e:
        print(f"Error processing video {video_id}: {e}")
        video.status = "failed"
        db.commit()
    finally:
        db.close()