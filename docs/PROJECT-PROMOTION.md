# Sheet Music Extractor: 연주 영상에서 A4 인쇄용 악보 PDF까지

> 디렉터(Mike)가 2026년 6월 10일간 단독 개발한 로컬 전용 영상 처리 파이프라인을,
> Aether Turing Dynamics(ATD)가 편입하여 전수 분석·감사·문서화한 기술 케이스 스터디입니다.

---

## 1. 프로젝트 목적 및 배경 (Goal & Mission)

### 해결 과제: 연주 영상으로는 연습할 수 없다

연주 영상을 보며 악보를 익히는 사람은 같은 마디를 수십 번 되감습니다. 필요한 악보는 화면에 잠깐 머물다 넘어가고, 화면 캡처로는 악보 영역만 깔끔하게 뜯어낼 수 없습니다. 기존 방식은 영상 편집기에서 프레임을 수동 캡처하고, 이미지 편집기에서 악보 영역을 크롭하고, 다시 PDF로 묶는 3단 수작업입니다. 30분짜리 연주 영상에서 인쇄용 악보를 만들려면 몇 시간이 걸립니다.

### 프로젝트 핵심 목표

1. 영상에서 악보가 표시된 프레임만 자동으로 추출한다.
2. 악보 영역을 자동 검출·크롭하여 레터박스와 배경을 제거한다.
3. 추출된 프레임을 골라 A4 인쇄용 PDF로 합성한다.
4. 모든 처리를 로컬에서 수행하여 연주 영상을 외부로 전송하지 않는다.

```mermaid
flowchart TD
    A["연주 영상 업로드"] --> B["MD5 기반 중복 검사<br/>task_hash = md5(file + ROI + 구간)"]
    B --> C["FastAPI BackgroundTasks<br/>비동기 분석 시작"]
    C --> D["ffprobe<br/>I-frame 타임스탬프 추출"]
    D --> E["ffmpeg<br/>I-frame 이미지 추출"]
    E --> F["ROI 비율 크롭<br/>또는 자동 악보 영역 검출"]
    F --> G["64x64 grayscale 특징 벡터"]
    G --> H["AgglomerativeClustering<br/>silhouette 기반 threshold 자동 탐색"]
    H --> I["클러스터별 대표 프레임 채택"]
    I --> J["갤러리에서 선택·정렬"]
    J --> K["PIL 조판<br/>A4 1240x1754, 300 DPI"]
    K --> L["인쇄용 PDF 다운로드"]
```

---

## 2. 개발 및 ATD 편입 경과

### 2-1. 디렉터 단독 개발 (2026.06.08 ~ 2026.06.17)

디렉터가 10일간 단독으로 설계부터 배포 스크립트까지 완성했습니다. 총 30 커밋, 최종 코드 규모는 백엔드 애플리케이션 Python 865행과 프론트엔드 소스 JS/JSX 1,359행입니다. 외부 라이브러리 의존을 최소화하는 방향으로 진행되어, 프론트엔드에는 라우터·상태관리·HTTP 클라이언트·PDF 라이브러리가 모두 들어가지 않았습니다.

### 2-2. ATD 허브 편입 (2026.09.20)

6월 완성 이후 방치되어 있던 저장소를 ATD 허브에 편입했습니다. 이 프로젝트는 ATD 편성 하에 개발된 것이 아니므로, ATD는 기능 구현에 참여하지 않았습니다. 대신 편입 시점의 코드베이스를 전수 분석하고 감사하여 문서화했습니다.

| 단계 | 담당 | 수행 내용 |
| :--- | :--- | :--- |
| 전수 분석 | Atlas | 코드베이스 구조·알고리즘·이력 분석, 편입 파이프라인 편성 |
| 아키텍처 명세 | Leo | 호출 그래프 및 데이터 흐름 정리, 개선 백로그 도출 |
| 보안 결함 해소 | Kai | 삭제 엔드포인트의 비멱등 HTTP 메서드 위반 전환 |
| 에셋 제작 | Sora | 세로 장첩 스크린샷에서 대표 썸네일 크롭 및 에셋 최적화 |
| 감사 | Elena | README 서술과 실제 구현의 불일치 전수 적발, 시크릿/PII 감사 |
| 검증 | Noah | 빌드 무결성 및 실행 환경 재현성 확인 |

---

## 3. 시스템 아키텍처 및 핵심 기술

### 3-1. 백엔드 API

FastAPI 단일 프로세스에 SQLite를 물린 구조입니다. 라우터 prefix는 `/api/videos`이며 엔드포인트는 4개뿐입니다.

| Method | Path | 용도 |
| :--- | :--- | :--- |
| POST | `/api/videos/upload` | 업로드, task_hash 중복 검사, 백그라운드 분석 등록 |
| GET | `/api/videos/{video_id}` | 상태·진행률·키프레임 조회 (프론트 2초 폴링) |
| GET | `/api/videos/{video_id}/pdf` | PDF 생성 또는 캐시 반환 (마진, 프레임 목록 쿼리) |
| DELETE | `/api/videos/{video_id}` | 비디오·키프레임·PDF·캐시 연쇄 삭제 |

데이터 모델은 `videos`와 `keyframes` 두 테이블입니다. `videos`는 파일 해시에 unique 제약을 걸어 중복 업로드를 차단하고, `keyframes`는 cascade delete-orphan으로 부모 삭제 시 함께 정리됩니다.

### 3-2. 악보 영역 자동 검출 (`extractor.py:92`)

사용자가 ROI를 지정하지 않아도 동작하도록 OpenCV 기반 투영(projection) 기법을 조합했습니다. 사람이 눈으로 "악보가 있는 네모"를 찾는 과정을 픽셀 밀도 계산으로 옮긴 구현입니다.

1. GaussianBlur(3,3)로 노이즈를 누그러뜨리고 grayscale로 변환
2. `THRESH_BINARY_INV` + `THRESH_OTSU`로 자동 임계 이진화 (조명 편차를 임계값 자동 산출로 흡수)
3. 행·열 밀도 50% 임계로 레터박스 경계를 찾고, 경계에서 안쪽 15px를 안전 여백으로 확보
4. 행·열 픽셀 합 투영으로 악보 내용에 타이트하게 맞춤
5. 픽셀 합 허용치 `255 × 15`로 잔노이즈를 무시하고 최종 10px 마진 확장

PDF 단계에서는 `trim_white_margin`(`endpoints.py:41`)이 PIL로 grayscale 240 미만 마스크의 bbox를 잘라, 스캔본 특유의 흰 테두리를 한 번 더 제거합니다.

### 3-3. 키프레임 선별: I-frame + 계층적 클러스터링

핵심 아이디어는 "영상에서 화면이 바뀌는 순간은 I-frame 근처에 몰려 있다"는 관찰입니다.

- `ffprobe -skip_frame nokey`로 I-frame 타임스탬프만 뽑고, 사용자가 지정한 시작·종료 구간으로 필터링합니다 (`extractor.py:38`).
- `ffmpeg select='eq(pict_type,PICT_TYPE_I)'`로 해당 프레임을 JPEG로 덤프합니다 (`extractor.py:57`).
- 각 프레임을 64×64 grayscale로 축소해 특징 벡터를 만듭니다 (`extractor.py:244`).
- `AgglomerativeClustering`에 cosine 거리와 average linkage를 적용합니다 (`extractor.py:175`).
- 거리 임계값은 고정하지 않고 후보 `[0.01, 0.02, 0.03, 0.04, 0.05, 0.08, 0.1]`에 대해 silhouette score를 계산해 자동 선택합니다 (`extractor.py:157`). 기본값은 0.03입니다.
- 클러스터마다 첫 프레임 하나만 남깁니다 (`extractor.py:261`).

이 구조의 장점은 I-frame만 디코딩하므로 전체 프레임을 훑는 것보다 훨씬 가볍다는 점입니다. 반면 한계도 분명합니다. 클러스터링은 "비슷한 프레임을 묶는" 작업이지 "악보가 넘어갔는지 판정하는" 작업이 아닙니다. 악보가 넘어가지 않고 연주자만 움직인 구간도 별개 클러스터로 갈라질 수 있습니다. 이 한계는 편입 감사에서 지적사항으로 기록했습니다.

### 3-4. 중복 제거 및 캐싱

같은 영상을 다른 ROI로 다시 올리는 경우까지 고려한 2단 해시 구조입니다 (`endpoints.py:257`).

- `base_file_hash`: 파일 내용 MD5 (8192바이트 청크 스트리밍)
- `task_hash`: `md5(base_file_hash + crop_x + crop_y + crop_w + crop_h + start_time + end_time)`

`task_hash`가 일치하는 기존 레코드가 있으면 분석을 건너뛰고 즉시 반환합니다. 파일 자체는 `{base_file_hash}_{원본파일명}`으로 한 번만 저장하고 여러 레코드가 공유합니다. I-frame 캐시는 `storage/cache/iframes/{base_file_hash}_{start}_{end}`에 남고, `timestamps.txt`와 `iframe_*` 파일이 모두 있으면 캐시 히트로 판정해 복사만 수행합니다 (`extractor.py:203`).

삭제 시에도 공유 카운트를 먼저 확인합니다. 같은 원본 파일을 참조하는 레코드가 1개 이하일 때만 원본과 캐시 디렉토리를 지웁니다 (`endpoints.py:375`). 다른 ROI 설정이 남아 있는데 원본이 사라지는 사고를 막는 장치입니다.

### 3-5. PDF 조판

Pillow로 A4 캔버스(`1240 × 1754`)에 이미지를 순서대로 배치합니다. 저장 시 `resolution=300.0`을 지정하므로 실효 해상도 기준의 캔버스입니다.

- 캐시 파일명에 마진 5종(상·하·좌·우·내부)과 프레임 ID 목록을 인코딩해, 설정이 다르면 별도 PDF가 생성됩니다 (`endpoints.py:99`).
- 페이지 넘침 판정은 단순합니다. 현재 y좌표에 이미지 높이를 더한 값이 `페이지 높이 - 하단 마진`을 넘으면 새 페이지로 넘깁니다 (`endpoints.py:145`).
- 페이지 번호는 우상단에 흰 배경·검정 테두리 박스로 찍고, 폰트는 arial → DejaVuSans → Pillow 기본 폰트 순으로 폴백합니다 (`endpoints.py:55`). OS별 폰트 부재로 조판이 죽지 않게 한 처리입니다.

### 3-6. 프론트엔드

React 19 + Vite 8 + Tailwind CSS v4 조합이며, 상태관리 라이브러리 없이 `useState`/`useEffect`/`useRef`만 사용합니다. 26개의 `useState`와 다수의 `useRef`로 구성되어 있고, 테마·레이아웃 폭·썸네일 크기·스냅 설정·마진 설정은 localStorage에 영속화됩니다.

주목할 구현은 ROI 선택기입니다. 8방향 리사이즈 핸들을 두고, `requestAnimationFrame` 기반 `scheduleOverlayUpdate`(`App.jsx:455`)로 포인터 이동 시 오버레이 갱신을 프레임 단위로 조율합니다. 그리드·가장자리 스냅도 함께 동작합니다. 확대 미리보기 모달은 좌→우 페이드/슬라이드 전환과 키보드 `←`/`→`/`Home`/`End`/`Esc` 내비게이션을 지원합니다.

![업로드, ROI 드래그 선택, 시간 구간 지정](assets/ui_overview_1.jpg)

![처리 진행 상태, 영상 메타데이터, PDF 내보내기 설정](assets/ui_overview_2.jpg)

![추출된 악보 프레임 갤러리와 선택 체크박스](assets/ui_overview_3.jpg)

![생성된 A4 악보 PDF (앞부분)](assets/pdf_result.jpg)

---

## 4. ATD 편입 감사 결과

편입 감사에서 16건을 적발했습니다. 이 중 비멱등 삭제 1건은 편입 과정에서 해소했고, 나머지 15건은 코드를 수정하지 않은 채 개선 백로그로 이관했습니다. 백로그 번호는 프로젝트 명세서(`PROJECT-DESCRIPTION.md` §4.2)의 BL-01 ~ BL-15와 대응하며, 총계는 §4-7에 정리했습니다.

### 4-1. 서술과 구현의 불일치

README가 안내하거나 설명하는 기능 중 실제 코드에 없는 항목입니다. 인수인계 문서로서 README의 신뢰도에 직접 영향을 주는 문제입니다.

| README 서술 | 실제 구현 상태 |
| :--- | :--- |
| 설치 절차와 Prerequisites | `requirements.txt` 파일 자체가 없음 (`pyproject.toml` + `uv.lock`만 존재). Prerequisites는 `Python 3.8+`로 적혀 있으나 실제 요구는 `>=3.12`이고, 하드 런타임 의존인 `ffmpeg`/`ffprobe`가 Prerequisites에 없음 |
| 개별 이미지 삭제 기능 | 백엔드 엔드포인트만 존재, 프론트엔드 호출 코드 0건 |
| 이미지 순서 바꾸기 | 정렬 UI 없음. 체크된 인덱스 오름차순으로 고정됨 |
| 테스트 영상 자동 업로드 버튼 | `App.jsx`에 참조 없음. `frontend/public/data/` 디렉토리도 없음 |
| 재시도 전략(retry strategies) | retry/backoff 로직 0건 |
| AI/heuristics 기반 페이지 넘김 검출 | 실제로는 I-frame 클러스터링. 내용 기반 넘김 판정이 아님 |

### 4-2. ATD 코드 품질 물리 제약 위반

| 대상 | 실측 | 제약 |
| :--- | :--- | :--- |
| `frontend/src/App.jsx` | 1,349행, 하위 컴포넌트 0개 | 파일 300행 |
| `backend/app/api/endpoints.py` · `backend/app/services/extractor.py` | 396행 · 344행 | 파일 300행 |

`App.jsx`는 단일 `App()` 컴포넌트 안에 UI·상태·유틸·스타일 문자열 상수가 모두 들어 있습니다. 파일명 sanitize 유틸(Windows 예약어 `COM1`~`LPT9` 처리 포함)까지 같은 파일에 있습니다.

### 4-3. 보안 및 견고성

| 항목 | 내용 |
| :--- | :--- |
| 비멱등 삭제 | 삭제가 `GET`으로 노출되어 링크 프리페치·CSRF에 노출 (편입 시 `DELETE`로 전환 완료) |
| 오리진 하드코딩 | `allow_origins=["http://localhost:5173"]`, 프론트 API 주소 `http://localhost:8000` (`App.jsx:87`) |
| 작업 유실 | `BackgroundTasks` 단일 프로세스 구조라 서버 재시작 시 진행 중 분석이 소실됨 |
| 오류 은폐 | 예외를 print만 하고 status만 failed로 기록 (`extractor.py:335`). 에러 메시지 미저장, 재시도 없음 |
| 비권장 API | `sqlalchemy.ext.declarative.declarative_base` 사용 (SQLAlchemy 2.x 권장 경로 아님) |

### 4-4. 검증 자산 부재

자동 테스트가 0건입니다. pytest·unittest·assert 사용이 없고 테스트 프레임워크도 의존성에 없습니다. `backend/test_strategy.py`는 argparse로 비디오 경로를 받아 `extract_keyframes_core`를 DB 없이 호출하고 `print`로 결과를 출력하는 수동 CLI 하네스이며, `backend/test_minimal.py`는 5행 스텁입니다. 자동 판정이 없으므로 회귀를 감지할 장치가 없습니다.

### 4-5. 잔재 파일

`frontend/pyproject.toml`은 uv가 잘못 생성한 잔재입니다. `requires-python = ">=3.14"`, dependencies 없음, description이 "Add your description here"로 남아 있어 프론트엔드 디렉토리에 Python 프로젝트 정의가 섞여 있습니다.

### 4-6. 배포 및 운영 인프라 부재

`Dockerfile`, `backend/Dockerfile`, `.github/` 가 모두 없습니다. 빌드·린트·테스트를 자동으로 돌리는 파이프라인이 없어, 회귀를 감지할 자동화 계층이 전혀 없습니다. 외부 바이너리 `ffmpeg`/`ffprobe` 의존이 시스템 명세로 고정되어 있지 않고 README의 Prerequisites에도 누락되어 있어, 다른 환경에서는 수동 설치가 필요합니다.

### 4-7. 감사 총계

| 구분 | 건수 |
| :--- | :--- |
| 적발 | 16 |
| 편입 과정에서 해소 (비멱등 삭제 GET → DELETE) | 1 |
| 개선 백로그 이관 | 15 |

백로그 15건은 프로젝트 명세서(`PROJECT-DESCRIPTION.md` §4.2)의 BL-01 ~ BL-15와 1:1로 대응합니다.

---

## 5. 결론 및 향후 확장

Sheet Music Extractor는 10일 단독 개발로 "영상 → 인쇄용 악보 PDF"라는 개인적 불편을 실제로 해소한 도구입니다. 특히 I-frame만 디코딩해 클러스터링으로 대표 프레임을 고르는 접근과, `task_hash` 2단 해시로 ROI 재실험까지 캐시하는 설계는 2,224행 규모에서 얻기 어려운 완성도입니다. 자동 크롭이 조명 편차를 Otsu 임계값 자동 산출로 흡수하고, PDF 폰트를 3단 폴백으로 처리하는 부분도 실사용에서 부딪힌 문제를 정면으로 다룬 흔적입니다.

동시에 편입 감사는 이 프로젝트가 개인 도구로는 충분하지만 인수인계 가능한 소프트웨어는 아니라는 점을 드러냈습니다. README가 안내하는 설치 절차가 깨져 있고, 문서가 설명하는 기능 6건이 코드에 없으며, 자동 테스트가 0건입니다. `App.jsx` 1,349행 단일 컴포넌트는 기능 추가보다 유지보수를 먼저 막는 구조입니다.

ATD는 이 상태를 정직하게 기록하는 쪽을 택했습니다. 감사에서 적발한 항목은 삭제하지 않고 개선 백로그로 프로젝트 명세서에 이관했으며, README의 과장 서술도 그대로 둔 채 불일치 사실을 문서화했습니다. 다음 작업의 우선순위는 프로젝트 명세서(`PROJECT-DESCRIPTION.md` §4)에 정리되어 있습니다.

이 케이스는 ATD 편입 프레임의 성격을 잘 보여줍니다. 편입은 기존 프로젝트에 ATD의 이름을 붙이는 일이 아니라, 그 프로젝트가 실제로 무엇인지 밝히고 다음 사람이 이어받을 수 있게 만드는 일입니다.
