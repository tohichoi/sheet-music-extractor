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


def parse_comma_separated_ints(keyFrames: str = Query(default="", description="콤마로 구분된 숫자들 (예: 1,2,3,4)")) -> list[int]:
    if not keyFrames:
        return []
    try:
        # 콤마로 나누고 양쪽 공백을 제거한 뒤 정수로 변환
        return [int(item.strip()) for item in keyFrames.split(",")]
    except ValueError:
        # 숫자가 아닌 값이 섞여 있을 경우 에러 처리
        raise HTTPException(status_code=422, detail="keyFrames must be a comma-separated list of integers.")


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
    keyframe_ids: List[int],
) -> Path:
    filename = (
        f'sheet_music_video_{video_id}'
        f'_mt{margin_top}'
        f'_mb{margin_bottom}'
        f'_ml{margin_left}'
        f'_mr{margin_right}'
        f'_im{inner_margin}'
        f'_{",".join(str(x) for x in keyframe_ids)}'
        '.pdf'
    )
    return PDF_DIR / filename


def process_keyframes_to_images(keyframes, keyframe_ids: List[int], content_width: int) -> List[Image.Image]:
    processed_images: List[Image.Image] = []

    if len(keyframe_ids) == 0:
        keyframe_ids = range(len(keyframes))

    for index, keyframe in enumerate(keyframes):
        if index not in keyframe_ids:
            continue

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
    keyFrames: List[int] = Depends(parse_comma_separated_ints),
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
        keyframe_ids=keyFrames,
    )

    download_filename = Path(video.original_filename).with_suffix('.pdf')
    if pdf_path.exists():
        return FileResponse(path=str(pdf_path), filename=download_filename.name, media_type='application/pdf')

    content_width = A4_WIDTH - (marginLeft + marginRight)
    processed_images = process_keyframes_to_images(video.keyframes, keyFrames, content_width)
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
    return FileResponse(path=str(pdf_path), filename=download_filename.name, media_type='application/pdf')

@router.get('/{video_id}/delete')
def delete_video(video_id: int, db: Session = Depends(get_db)):
    video = get_db_video(video_id, db)

    # 1. 연관된 PDF 파일들 삭제
    # 파일명이 'sheet_music_video_{video_id}_' 로 시작하는 모든 PDF 검색 및 삭제
    for pdf_file in PDF_DIR.glob(f'sheet_music_video_{video_id}_*.pdf'):
        pdf_file.unlink(missing_ok=True)

    # 2. 해당 비디오 전용 키프레임 및 임시 폴더 삭제
    keyframe_dir = Path(f'storage/keyframes/{video_id}')
    if keyframe_dir.exists() and keyframe_dir.is_dir():
        shutil.rmtree(keyframe_dir, ignore_errors=True)

    temp_dir = Path(f'storage/temp/{video_id}')
    if temp_dir.exists() and temp_dir.is_dir():
        shutil.rmtree(temp_dir, ignore_errors=True)

    # 3. 원본 비디오 파일 및 공용 캐시 폴더 삭제 (안전 검사)
    # 다른 ROI 설정으로 동일한 원본 파일을 참조하는 Video 레코드가 있는지 확인합니다.
    shared_count = db.query(Video).filter(Video.stored_filepath == video.stored_filepath).count()

    if shared_count <= 1:
        # 아무도 이 원본 파일을 공유하지 않는다면(나 혼자 쓴다면) 원본 파일 삭제
        video_file = Path(video.stored_filepath)
        if video_file.exists():
            video_file.unlink(missing_ok=True)

        # 파일명 구조({base_file_hash}_{filename})에서 base_file_hash를 역추적하여 캐시 폴더도 삭제
        base_file_hash = video_file.name.split('_')[0]
        cache_dir = Path(f'storage/cache/iframes/{base_file_hash}')
        if cache_dir.exists() and cache_dir.is_dir():
            shutil.rmtree(cache_dir, ignore_errors=True)

    # 4. 데이터베이스 레코드 삭제
    # KeyFrame 테이블 레코드는 삭제 전 연결된 외래키를 통해 지우거나 명시적으로 지웁니다.
    from app.models.video import KeyFrame
    db.query(KeyFrame).filter(KeyFrame.video_id == video_id).delete()

    db.delete(video)
    db.commit()

    return {"status": "success", "message": f"비디오(ID: {video_id}) 및 관련 데이터가 모두 삭제되었습니다."}