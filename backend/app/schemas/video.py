# backend/app/schemas/video.py
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class KeyFrameResponse(BaseModel):
    id: int
    timestamp: float
    image_filepath: str

    class Config:
        from_attributes = True

class VideoResponse(BaseModel):
    id: int
    original_filename: str
    status: str
    upload_time: datetime
    
    file_size: Optional[int] = None
    width: Optional[int] = None
    height: Optional[int] = None
    duration: Optional[float] = None
    fps: Optional[float] = None
    
    # ✅ 추가: 프론트엔드로 전달할 진행률 필드
    progress: Optional[float] = 0.0
    
    keyframes: List[KeyFrameResponse] = []

    class Config:
        from_attributes = True