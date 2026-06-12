import hashlib
import shutil
from pathlib import Path
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from PIL import Image, ImageDraw, ImageFont
import cv2
import numpy as np

from app.core.database import get_db
from app.models.video import Video
from app.schemas.video import VideoResponse
from app.services.extractor import process_video_background

router = APIRouter()
VIDEO_DIR = Path('storage/videos')
PDF_DIR = Path('storage/pdfs')
A4_WIDTH = 1240
A4_HEIGHT = 1754
DEFAULT_FONT_SIZE = 24

VIDEO_DIR.mkdir(parents=True, exist_ok=True)
PDF_DIR.mkdir(parents=True, exist_ok=True)


def trim_white_margin(image: Image.Image, tol: int = 240) -> Image.Image:
    """Trim white border from the edges of a Pillow image."""
    grayscale = np.array(image.convert('L'))
    mask = grayscale < tol
    coords = np.argwhere(mask)

    if coords.size == 0:
        return image

    y0, x0 = coords.min(axis=0)
    y1, x1 = coords.max(axis=0) + 1
    return image.crop((x0, y0, x1, y1))


def get_page_number_font(font_size: int = DEFAULT_FONT_SIZE):
    for font_name in ('arial.ttf', 'DejaVuSans.ttf'):
        try:
            return ImageFont.truetype(font_name, font_size)
        except Exception:
            continue
    return ImageFont.load_default()


def add_page_number(
    page: Image.Image,
    page_number: int,
    page_width: int,
    margin_right: int,
    margin_top: int,
) -> None:
    """Draw the page number inside a small boxed label aligned to the top-right."""
    draw = ImageDraw.Draw(page)
    font = get_page_number_font()
    text = str(page_number)

    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    padding = 8
    box_width = text_width + padding * 2
    box_height = text_height + padding * 2

    x = page_width - margin_right - box_width
    y = max(10, margin_top // 2 - box_height // 2)

    draw.rectangle([(x, y), (x + box_width, y + box_height)], fill='white', outline='black')
    draw.text(
        (x + (box_width - text_width) // 2, y + (box_height - text_height) // 2),
        text,
        fill='black',
        font=font,
    )


def create_canvas(width: int, height: int, color: str = 'white') -> Image.Image:
    return Image.new('RGB', (width, height), color)


def get_pdf_path(
    video_id: int,
    margin_top: int,
    margin_bottom: int,
    margin_left: int,
    margin_right: int,
    inner_margin: int,
) -> Path:
    filename = (
        f'sheet_music_video_{video_id}'
        f'_mt{margin_top}'
        f'_mb{margin_bottom}'
        f'_ml{margin_left}'
        f'_mr{margin_right}'
        f'_im{inner_margin}.pdf'
    )
    return PDF_DIR / filename


def process_keyframes_to_images(keyframes, content_width: int) -> List[Image.Image]:
    processed_images: List[Image.Image] = []
    for keyframe in keyframes:
        image_path = Path(keyframe.image_filepath)
        if not image_path.exists():
            continue

        with Image.open(image_path) as opened_image:
            image = opened_image.convert('RGB')
            trimmed = trim_white_margin(image)
            ratio = content_width / trimmed.width
            resized = trimmed.resize((content_width, int(trimmed.height * ratio)))
            processed_images.append(resized)

    return processed_images


def build_pdf_pages(
    images: List[Image.Image],
    page_width: int,
    page_height: int,
    margin_top: int,
    margin_bottom: int,
    margin_left: int,
    margin_right: int,
    inner_margin: int,
) -> List[Image.Image]:
    pages: List[Image.Image] = []
    current_page = create_canvas(page_width, page_height)
    current_y = margin_top
    page_number = 1

    for image in images:
        if current_y + image.height > page_height - margin_bottom:
            add_page_number(current_page, page_number, page_width, margin_right, margin_top)
            pages.append(current_page)
            current_page = create_canvas(page_width, page_height)
            current_y = margin_top
            page_number += 1

        current_page.paste(image, (margin_left, current_y))
        current_y += image.height + inner_margin

    add_page_number(current_page, page_number, page_width, margin_right, margin_top)
    pages.append(current_page)
    return pages


def save_pdf(pages: List[Image.Image], pdf_path: Path) -> None:
    if not pages:
        return

    pages[0].save(
        pdf_path,
        save_all=True,
        append_images=pages[1:],
        resolution=300.0,
        dpi=(300, 300),
    )


def get_db_video(video_id: int, db: Session) -> Video:
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail='Video not found')
    return video


def save_uploaded_video(upload_file: UploadFile, file_hash: str) -> Path:
    destination = VIDEO_DIR / f'{file_hash}_{upload_file.filename}'
    if not destination.exists():
        with destination.open('wb+') as buffer:
            shutil.copyfileobj(upload_file.file, buffer)
    return destination


def read_video_metadata(file_path: Path) -> tuple[int, int, float, float]:
    capture = cv2.VideoCapture(str(file_path))
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = capture.get(cv2.CAP_PROP_FPS)
    frame_count = capture.get(cv2.CAP_PROP_FRAME_COUNT)
    capture.release()

    duration = frame_count / fps if fps > 0 else 0.0
    return width, height, fps, duration


def create_video_record(
    db: Session,
    original_filename: str,
    stored_filepath: str,
    file_hash: str,
    file_size: int,
    width: int,
    height: int,
    duration: float,
    fps: float,
) -> Video:
    video = Video(
        original_filename=original_filename,
        stored_filepath=stored_filepath,
        file_hash=file_hash,
        file_size=file_size,
        width=width,
        height=height,
        duration=duration,
        fps=fps,
        status='uploaded',
    )
    db.add(video)
    db.commit()
    db.refresh(video)
    return video


@router.post('/upload', response_model=VideoResponse)
async def upload_video(
        background_tasks: BackgroundTasks,
        file: UploadFile = File(...),
        crop_x: float = Form(0.0),
        crop_y: float = Form(0.0),
        crop_w: float = Form(1.0),
        crop_h: float = Form(1.0),
        db: Session = Depends(get_db),
) -> Video:
    # 1. 파일 원본의 고유 해시(Base Hash) 추출
    md5_hash = hashlib.md5()
    while chunk := await file.read(8192):
        md5_hash.update(chunk)
    base_file_hash = md5_hash.hexdigest()
    await file.seek(0) # 커서 초기화

    # 🌟 2. 원본 해시와 ROI를 결합한 새로운 '작업 해시(Task Hash)' 생성
    task_data_string = f"{base_file_hash}_{crop_x:.4f}_{crop_y:.4f}_{crop_w:.4f}_{crop_h:.4f}"
    task_hash = hashlib.md5(task_data_string.encode()).hexdigest()

    # 이미 정확히 동일한 영상 + 동일한 ROI로 작업된 결과가 있는지 확인
    existing_video = db.query(Video).filter(Video.file_hash == task_hash).first()
    if existing_video:
        return existing_video

    # 🌟 3. 원본 비디오 파일은 base_file_hash 기준으로 단 1번만 저장 (중복 저장 방지)
    saved_path = save_uploaded_video(file, base_file_hash)
    file_size = saved_path.stat().st_size
    width, height, fps, duration = read_video_metadata(saved_path)

    # DB에는 task_hash로 기록하여 독립된 결과물로 취급
    new_video = create_video_record(
        db=db,
        original_filename=file.filename,
        stored_filepath=str(saved_path),
        file_hash=task_hash,
        file_size=file_size,
        width=width,
        height=height,
        duration=duration,
        fps=fps,
    )

    # 🌟 4. 백그라운드 워커에 base_file_hash도 함께 전달하여 캐시 폴더를 찾게 함
    background_tasks.add_task(
        process_video_background,
        video_id=new_video.id,
        crop_rect=(crop_x, crop_y, crop_w, crop_h),
        base_file_hash=base_file_hash # 새롭게 추가
    )

    return new_video


@router.get('/{video_id}', response_model=VideoResponse)
def get_video_status(video_id: int, db: Session = Depends(get_db)) -> Video:
    return get_db_video(video_id, db)


@router.get('/{video_id}/pdf')
def export_keyframes_to_pdf(
    video_id: int,
    db: Session = Depends(get_db),
    marginTop: int = Query(100),
    marginBottom: int = Query(20),
    marginLeft: int = Query(20),
    marginRight: int = Query(20),
    innerMargin: int = Query(20),
) -> FileResponse:
    video = get_db_video(video_id, db)
    if not video.keyframes:
        raise HTTPException(status_code=404, detail='No keyframes found for this video')

    pdf_path = get_pdf_path(
        video_id,
        margin_top=marginTop,
        margin_bottom=marginBottom,
        margin_left=marginLeft,
        margin_right=marginRight,
        inner_margin=innerMargin,
    )
    if pdf_path.exists():
        return FileResponse(path=str(pdf_path), filename=pdf_path.name, media_type='application/pdf')

    content_width = A4_WIDTH - (marginLeft + marginRight)
    processed_images = process_keyframes_to_images(video.keyframes, content_width)
    pdf_pages = build_pdf_pages(
        processed_images,
        page_width=A4_WIDTH,
        page_height=A4_HEIGHT,
        margin_top=marginTop,
        margin_bottom=marginBottom,
        margin_left=marginLeft,
        margin_right=marginRight,
        inner_margin=innerMargin,
    )

    save_pdf(pdf_pages, pdf_path)
    return FileResponse(path=str(pdf_path), filename=pdf_path.name, media_type='application/pdf')
