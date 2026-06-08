# backend/app/api/endpoints.py
import os
import shutil
import hashlib
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse # ✅ FileResponse 추가
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.video import Video
from app.schemas.video import VideoResponse
from app.services.extractor import process_video_background
from PIL import Image # ✅ Pillow 이미지 모듈 추가
import cv2  # ✅ OpenCV 임포트 추가


router = APIRouter()
VIDEO_DIR = "./storage/videos"
os.makedirs(VIDEO_DIR, exist_ok=True)

@router.post("/upload", response_model=VideoResponse)
async def upload_video(
    background_tasks: BackgroundTasks, 
    file: UploadFile = File(...), 
    db: Session = Depends(get_db)
):
    md5_hash = hashlib.md5()
    while chunk := await file.read(8192):
        md5_hash.update(chunk)
    file_hash = md5_hash.hexdigest()
    await file.seek(0)

    existing_video = db.query(Video).filter(Video.file_hash == file_hash).first()
    if existing_video:
        return existing_video

    safe_filename = f"{file_hash}_{file.filename}"
    file_location = f"{VIDEO_DIR}/{safe_filename}"
    
    with open(file_location, "wb+") as file_object:
        shutil.copyfileobj(file.file, file_object)

    # ✅ 파일 크기 추출 (Bytes)
    file_size = os.path.getsize(file_location)

    # ✅ OpenCV를 이용해 비디오 메타데이터 추출
    cap = cv2.VideoCapture(file_location)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    duration = frame_count / fps if fps > 0 else 0.0
    cap.release()

    # 데이터베이스에 새 메타데이터 함께 저장
    new_video = Video(
        original_filename=file.filename,
        stored_filepath=file_location,
        file_hash=file_hash,
        file_size=file_size, # ✅ 메타데이터 추가
        width=width,
        height=height,
        duration=duration,
        fps=fps,
        status="uploaded"
    )
    db.add(new_video)
    db.commit()
    db.refresh(new_video)

    background_tasks.add_task(process_video_background, new_video.id)

    return new_video

@router.get("/{video_id}", response_model=VideoResponse)
def get_video_status(video_id: int, db: Session = Depends(get_db)):
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    return video

@router.get("/{video_id}/pdf")
def export_keyframes_to_pdf(video_id: int, db: Session = Depends(get_db)):
    """추출된 키프레임 이미지들을 모아 하나의 PDF로 병합하여 반환합니다."""
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    if not video.keyframes:
        raise HTTPException(status_code=404, detail="No keyframes found for this video")

    # PDF 저장용 전용 디렉토리 생성
    PDF_DIR = "./storage/pdfs"
    os.makedirs(PDF_DIR, exist_ok=True)

    pdf_filename = f"sheet_music_video_{video_id}.pdf"
    pdf_path = os.path.join(PDF_DIR, pdf_filename)

    # 🌟 최적화: 이미 PDF가 생성되어 있다면 연산을 생략하고 기존 파일 반환
    if os.path.exists(pdf_path):
        return FileResponse(path=pdf_path, filename=pdf_filename, media_type='application/pdf')

    A4_WIDTH = 1240
    A4_HEIGHT = 1754
    
    # 이미지들을 PIL Image 객체로 로드
    image_list = []
    for kf in video.keyframes:
        img_path = kf.image_filepath
        if os.path.exists(img_path):
            img = Image.open(img_path).convert('RGB')
            
            # 1. A4 가로 너비에 맞춰 원본 이미지 크기 조절 (비율 유지)
            aspect_ratio = img.height / img.width
            new_width = A4_WIDTH
            new_height = int(A4_WIDTH * aspect_ratio)
            img_resized = img.resize((new_width, new_height))

            # 2. 하얀색 바탕의 A4 세로 캔버스 생성
            a4_canvas = Image.new('RGB', (A4_WIDTH, A4_HEIGHT), 'white')

            # 3. 캔버스 중앙에 크기를 조절한 악보 이미지 붙이기
            y_offset = (A4_HEIGHT - new_height) // 2 # 세로 중앙 정렬
            a4_canvas.paste(img_resized, (0, y_offset))

            # 4. 완성된 A4 캔버스를 리스트에 추가
            image_list.append(a4_canvas)

    if not image_list:
        raise HTTPException(status_code=404, detail="Image files not found on disk")

    # 첫 번째 이미지를 기준으로 나머지 이미지를 뒤에 붙여서 PDF로 저장
    image_list[0].save(pdf_path, save_all=True, append_images=image_list[1:])

    # 생성된 PDF 파일을 클라이언트로 전송
    return FileResponse(path=pdf_path, filename=pdf_filename, media_type='application/pdf')