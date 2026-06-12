# backend/app/main.py 최상단 import 영역
from pathlib import Path

from fastapi.staticfiles import StaticFiles
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.database import engine, Base
from app.api import endpoints

def init_storages_directories():
    storage = Path(__file__).parent.parent / 'storage'
    for d in ['database', 'videos', 'pdfs']:
        (storage / d).mkdir(parents=True, exist_ok=True)


init_storages_directories()

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Sheet Music Extractor API")

# CORS 설정 추가
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], # React 개발 서버 주소 허용
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(endpoints.router, prefix="/api/videos", tags=["videos"])

app.mount("/storage", StaticFiles(directory="./storage"), name="storage")


@app.get('/')
def read_root():
    return {'message': 'Welcome to Sheet Music Extractor API'}