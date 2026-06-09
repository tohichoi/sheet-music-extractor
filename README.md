# 🎵 Sheet Music Keyframe Extractor

## 📖 Overview

**Motivation:**
Have you ever watched a beautiful piano cover or sheet music video on YouTube and wanted to play it yourself, but found it frustrating to keep pausing or rewinding the video? This project was born out of the desire to easily extract only the sheet music from these videos, allowing you to focus purely on practicing and playing the music.

**✨ Advantages:**
* **Smart Noise Reduction:** Utilizes OpenCV algorithms to intelligently detect actual page turns while ignoring visual noise like moving playback progress bars or cursors.
* **Background Processing:** Heavy video frame processing is handled entirely in the background, keeping the user interface fast, responsive, and crash-free.
* **One-Click PDF Export:** Automatically formats and combines your extracted sheet music frames into a clean, A4-sized PDF, perfect for printing or viewing on a tablet.
* **Intuitive UI:** A sleek, interactive React gallery to preview, resize thumbnails, and manage your extracted sheets with ease.
* **Smart Deduplication:** Avoids redundant server processing by recognizing previously uploaded files instantly using MD5 file hashing.

**👥 Target Audience:**
* **Musicians & Instrumentalists:** Anyone who wants to practice offline or from printed sheets.
* *Note: The current architecture (SQLite + FastAPI BackgroundTasks) is optimized for **personal, local use**. To operate this as a multi-user public service, additional architecture improvements (e.g., Message Brokers like Redis, Task Queues like Celery, and an RDBMS like PostgreSQL) are required to handle concurrent processing.*

## 📸 Screenshots

*Uploading a video and tracking the background extraction progress in real-time. Viewing extracted keyframes in a grid layout and exporting them to a PDF.*

<img src="./screenshots/screenshot1.png" width="720">

*Exported PDF in the form of printer-friendly layout(customizerble paper margins).*

<img src="./screenshots/screenshot2.png" width="720">


## 🚀 How to Run (Step-by-Step Guide)

Follow these easy steps to get the project running on your local machine.

### Prerequisites
* **Python 3.8+**
* **Node.js**
* **uv** (An extremely fast Python package installer and resolver)

### 1. Clone the Repository
Open your terminal or command prompt and run:
```bash
git clone https://github.com/yourusername/sheet-music-extractor.git
cd sheet-music-extractor
```

### 2. Backend Setup (FastAPI)

```bash
# Navigate to the backend directory
cd backend

# Create a virtual environment using uv
uv venv

# Activate the virtual environment (Windows)
.venv\Scripts\activate
# Activate the virtual environment (Mac/Linux)
# source .venv/bin/activate

# Install the required dependencies
uv pip install fastapi uvicorn sqlalchemy opencv-python-headless pillow python-multipart

# Run the backend server
uv run uvicorn app.main:app --reload

```

*The backend API will now be running at `http://localhost:8000`.*

### 3. Prepare the Test Video (Optional but Recommended)

For quick development and testing without manually selecting a file every time, you can set up a test video:

1. Navigate to the `frontend/public/` directory and create a new folder named `data`.
2. Copy any sheet music video file you want to test into this `frontend/public/data/` folder.
3. Rename the copied video file to **`test_video.webm`**.
*(Now, clicking the "🚀 테스트 영상 자동 업로드 실행" button in the React UI will automatically use this file!)*

### 4. Frontend Setup (React/Vite)

Open a **new terminal window**, ensuring you start from the project root folder.

```bash
# Navigate to the frontend directory
cd frontend

# Install Node dependencies
npm install

# Start the development server
npm run dev
```

*The frontend will now be running at `http://localhost:5173`. Open this link in your browser to start extracting!*

---

**Enjoy playing! 🎹🎻**

