# backend/app/api/endpoints.py
import os
import shutil
import hashlib
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse # ✅ FileResponse 추가
from fastapi import Query
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.video import Video
from app.schemas.video import VideoResponse
from app.services.extractor import process_video_background
from PIL import Image, ImageDraw, ImageFont # ✅ Pillow 이미지 모듈 추가
import cv2  # ✅ OpenCV 임포트 추가
import numpy as np # ✅ NumPy 임포트 추가


router = APIRouter()
VIDEO_DIR = "./storage/videos"
os.makedirs(VIDEO_DIR, exist_ok=True)


def trim_white_margin(image: Image.Image, tol=240):
    """
    이미지의 가장자리에서 흰색 여백을 제거합니다.
    tol: 흰색으로 간주할 밝기 값 (0-255, 클수록 더 많은 영역을 흰색으로 간주)
    """
    # Pillow 이미지를 OpenCV 형식(numpy)으로 변환
    img_cv = np.array(image.convert('L')) # 흑백 변환
    
    # 마스크 생성: 픽셀 값이 tol보다 작으면(어두우면) True
    mask = img_cv < tol
    
    # 내용물이 있는 영역의 좌표 찾기
    coords = np.argwhere(mask)
    if coords.size == 0:
        return image # 내용이 없으면 원본 반환
        
    y0, x0 = coords.min(axis=0)
    y1, x1 = coords.max(axis=0) + 1
    
    # 여백 잘라내기
    trimmed_img = image.crop((x0, y0, x1, y1))
    return trimmed_img


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
def export_keyframes_to_pdf(
    video_id: int, 
    db: Session = Depends(get_db),
    marginTop: int = Query(50),
    marginBottom: int = Query(50),
    marginLeft: int = Query(20),
    marginRight: int = Query(20),
    innerMargin: int = Query(20)
):
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
    
    # CONTENT_WIDTH = A4_WIDTH - (2 * OUTER_MARGIN)
    CONTENT_WIDTH = A4_WIDTH - (marginLeft + marginRight)
    
    pdf_pages = []
    
    # 1. 모든 이미지를 열고, A4 가로 너비에 맞춰 높이를 조정
    processed_images = []
    for kf in video.keyframes:
        if os.path.exists(kf.image_filepath):
            img = Image.open(kf.image_filepath).convert('RGB')
            img = trim_white_margin(img)
            # 가로 너비를 A4 가로 너비로 맞춤
            ratio = CONTENT_WIDTH / img.width
            new_height = int(img.height * ratio)
            processed_images.append(img.resize((CONTENT_WIDTH, new_height)))

    # 2. 이미지를 페이지에 채우기
    def add_page_number(page: Image.Image, page_number: int):
        draw = ImageDraw.Draw(page)
        font_size = 24
        try:
            font = ImageFont.truetype("arial.ttf", font_size)
        except Exception:
            try:
                font = ImageFont.truetype("DejaVuSans.ttf", font_size)
            except Exception:
                font = ImageFont.load_default()
        text = str(page_number)
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        padding = 8
        box_width = text_width + padding * 2
        box_height = text_height + padding * 2
        x = A4_WIDTH - marginRight - box_width
        y = max(10, marginTop // 2 - box_height // 2)
        box_coords = [(x, y), (x + box_width, y + box_height)]
        draw.rectangle(box_coords, fill='white', outline='black')
        text_x = x + (box_width - text_width) // 2
        text_y = y + (box_height - text_height) // 2
        draw.text((text_x, text_y), text, fill='black', font=font)

    current_page = Image.new('RGB', (A4_WIDTH, A4_HEIGHT), 'white')
    current_y = marginTop
    page_number = 1
    
    for img in processed_images:
        # 이미지가 페이지를 넘어서는지 확인
        if current_y + img.height > A4_HEIGHT - marginBottom:
            add_page_number(current_page, page_number)
            pdf_pages.append(current_page) # 현재 페이지 완성
            current_page = Image.new('RGB', (A4_WIDTH, A4_HEIGHT), 'white') # 새 페이지
            current_y = marginTop
            page_number += 1
            
        # 페이지에 이미지 붙이기
        current_page.paste(img, (marginLeft, current_y))
        current_y += img.height + innerMargin
        
    add_page_number(current_page, page_number)
    pdf_pages.append(current_page) # 마지막 페이지 추가

    # PDF 저장
    if pdf_pages:
        pdf_pages[0].save(pdf_path, save_all=True, append_images=pdf_pages[1:], resolution=300.0, dpi=(300, 300))

    return FileResponse(path=pdf_path, filename=pdf_filename, media_type='application/pdf')