import os
import shutil
import stat
from pathlib import Path

def remove_readonly(func, path, _):
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except Exception:
        pass

def reset_storage():
    # 이 스크립트는 backend 폴더 안에서 실행된다고 가정합니다.
    storage_dir = Path("storage")
    
    if not storage_dir.exists():
        print("❌ 'storage' 폴더를 찾을 수 없습니다. backend 폴더 내에서 스크립트를 실행해 주세요.")
        return

    # 초기화할 하위 폴더 목록
    directories_to_clear = [
        storage_dir / "cache",
        storage_dir / "keyframes",
        storage_dir / "pdfs",
        storage_dir / "temp",
        storage_dir / "videos"
    ]

    print("\n🧹 1. 파일 스토리지 정리 중...")
    for d in directories_to_clear:
        if d.exists():
            shutil.rmtree(d, onerror=remove_readonly)
            print(f"  - 삭제 완료: {d}")
        # 폴더 구조는 유지해야 하므로 다시 빈 폴더로 생성합니다.
        d.mkdir(parents=True, exist_ok=True)

    print("\n🗑️ 2. 데이터베이스 초기화 중...")
    db_file = storage_dir / "database" / "app.db"
    if db_file.exists():
        try:
            os.chmod(db_file, stat.S_IWRITE)
            db_file.unlink()
            print(f"  - 삭제 완료: {db_file}")
        except Exception as e:
            print(f"  - ❌ 데이터베이스 삭제 실패 (서버가 실행 중인지 확인하세요): {e}")
    else:
        print(f"  - 데이터베이스 파일이 존재하지 않습니다.")

    print("\n✅ 모든 초기화가 완료되었습니다!")
    print("이제 백엔드 서버를 다시 시작하시면 새로운 빈 데이터베이스가 생성됩니다.\n")

if __name__ == "__main__":
    print("======================================================")
    print("⚠️  경고: 이 작업은 모든 데이터를 영구적으로 삭제합니다.")
    print("모든 비디오, 추출된 악보(Keyframes), PDF 및 DB가 삭제됩니다.")
    print("======================================================")
    confirmation = input("정말로 모든 데이터를 초기화하시겠습니까? (y/n): ")
    
    if confirmation.strip().lower() == 'y':
        reset_storage()
    else:
        print("\n작업이 취소되었습니다.")
