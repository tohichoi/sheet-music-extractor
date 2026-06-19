# backend/app/models/video.py
from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base

class Video(Base):
    __tablename__ = "videos"

    id = Column(Integer, primary_key=True, index=True)
    original_filename = Column(String, index=True)
    stored_filepath = Column(String)  
    file_hash = Column(String, unique=True, index=True)
    
    file_size = Column(Integer)
    width = Column(Integer)
    height = Column(Integer)
    duration = Column(Float)
    fps = Column(Float)
    
    # ✅ 새로 추가된 컬럼: 진행률 (0.0 ~ 100.0)
    progress = Column(Float, default=0.0) 

    # Extraction settings
    crop_x = Column(Float, nullable=True)
    crop_y = Column(Float, nullable=True)
    crop_w = Column(Float, nullable=True)
    crop_h = Column(Float, nullable=True)
    start_time = Column(Float, nullable=True)
    end_time = Column(Float, nullable=True)
    
    upload_time = Column(DateTime, default=datetime.utcnow)
    status = Column(String, default="uploaded") 

    keyframes = relationship("KeyFrame", back_populates="video", cascade="all, delete-orphan")

class KeyFrame(Base):
    __tablename__ = "keyframes"

    id = Column(Integer, primary_key=True, index=True)
    video_id = Column(Integer, ForeignKey("videos.id"))
    timestamp = Column(Float) 
    image_filepath = Column(String) 

    video = relationship("Video", back_populates="keyframes")