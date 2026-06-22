import os
import json
import shutil
from app.services.extractor import extract_keyframes_core
import argparse
from pathlib import Path


def run_strategy_test(video_file:Path):
    """
    키프레임 추출 전략(FFmpeg I-Frame + Sklearn Clustering)을 테스트합니다.
    검증을 위해 temp 폴더와 keyframes 폴더의 파일을 삭제하지 않고 보존합니다.
    """
    # 1. 테스트 파일 및 경로 설정
    video_filename = "P. Tchaikovsky - June (Barcarolle) [4ZuuXklkbrM].webm"
    video_filename = video_file.name
    
    # 실제 비디오 파일이 위치한 경로 (기존 논의된 프론트엔드 테스트 경로 또는 로컬 경로)
    # 필요에 따라 실제 파일이 있는 절대 경로로 수정하세요.
    # video_path = os.path.abspath(f"../frontend/public/data/{video_filename}")
    video_path = video_file.absolute()
    
    if not os.path.exists(video_path):
        print(f"❌ 비디오 파일을 찾을 수 없습니다: {video_path}")
        print("경로를 실제 테스트 파일이 있는 곳으로 수정해 주세요.")
        return

    # 전략 분석을 위한 독립적인 출력 폴더 설정
    base_dir = os.path.abspath(os.path.dirname(__file__))
    output_dir = os.path.join(base_dir, "strategy_test_output", "keyframes")
    temp_dir = os.path.join(base_dir, "strategy_test_output", "temp")
    cache_dir = os.path.join(base_dir, "strategy_test_output", "cache")

    # 기존 테스트 결과가 있다면 깨끗하게 비우고 새로 생성 (보존을 원하면 이 부분 제거)
    if os.path.exists(output_dir): shutil.rmtree(output_dir)
    if os.path.exists(temp_dir): shutil.rmtree(temp_dir)
    if os.path.exists(cache_dir): shutil.rmtree(cache_dir)
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(temp_dir, exist_ok=True)
    os.makedirs(cache_dir, exist_ok=True)

    print(f"🎬 전략 테스트 시작: {video_filename}")
    print(f"📂 FFmpeg 원본 I-Frame 폴더 (temp): {temp_dir}")
    print(f"📂 최종 선택된 키프레임 폴더 (output): {output_dir}")

    # 진행 상태를 터미널에 출력하기 위한 콜백 함수
    def progress_logger(progress: float):
        print(f"⏳ 진행률: {progress:.1f}%")

    # 테스트할 캡처 영역 (실제 악보 영역: 0.0, 0.0, 0.9821, 0.6646)
    test_crop_rect = (0.0, 0.0, 0.9821, 0.6646)

    try:
        # 🌟 DB 접근 없이 순수 파일 처리 코어만 실행 [cite: 1036]
        results = extract_keyframes_core(
            file_path=video_path,
            output_dir=output_dir,
            temp_dir=temp_dir,
            cache_dir=cache_dir,
            crop_rect=test_crop_rect,
            progress_callback=progress_logger
        )

        print("\n✅ 추출 전략 테스트 완료!")
        print(f"💡 FFmpeg가 추출한 전체 I-Frame 수: {len(os.listdir(temp_dir))}장")
        print(f"💡 클러스터링 후 최종 선택된 키프레임 수: {len(results)}장")
        
        print("\n📊 데이터베이스 저장용 추출 결과 데이터:")
        print(json.dumps(results, indent=2, ensure_ascii=False))
        
        print("\n👉 다음 단계를 통해 전략을 튜닝하세요:")
        print("  1. 'strategy_test_output/temp' 폴더를 열어 코덱이 I-Frame을 얼마나 자주 추출했는지 확인합니다.")
        print("  2. 'strategy_test_output/keyframes' 폴더를 열어 중복된 악보가 없는지, 누락된 악보가 없는지 확인합니다.")
        print("  3. 결과가 아쉽다면 app/services/extractor.py 의 'distance_threshold' (현재 0.03) 값을 수정하고 다시 실행해 보세요.")

    except Exception as e:
        print(f"\n❌ 오류 발생: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('file', type=Path)
    args = parser.parse_args()

    run_strategy_test(args.file)