# Live Voice Agent: 실시간 음성 AI 상담원 (Web Application)

[![React](https://img.shields.io/badge/React-18+-61DAFB.svg?logo=react)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688.svg?logo=fastapi)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3.9+-3776AB.svg?logo=python)](https://www.python.org/)
[![Azure](https://img.shields.io/badge/Azure-Voice%20Live%20API-0078D4?logo=microsoftazure)](https://azure.microsoft.com/en-us/products/ai-services/ai-speech/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**React와 FastAPI, 그리고 Azure Voice Live API를 기반으로 구축된 실시간 대화형 AI 음성 상담원 웹 애플리케이션입니다. 사용자의 음성을 웹 브라우저에서 실시간으로 스트리밍하여, 마치 사람과 대화하는 듯한 자연스럽고 지연 시간이 짧은 AI 상담 경험을 제공합니다.**

이 프로젝트는 기존 Python 스크립트에서 발전하여, WebSocket을 통해 클라이언트(React)와 서버(FastAPI) 간의 양방향 오디오 스트림을 중계하고, Azure의 최첨단 음성 AI 기술을 웹 환경에서 완벽하게 구현하는 것을 목표로 합니다.

---

## 주요 기능 (Key Features)

* **웹 기반 실시간 통신**: 브라우저의 마이크를 통해 음성을 입력받고, 스피커로 AI의 음성을 실시간 스트리밍하여 별도의 프로그램 설치 없이 웹에서 바로 사용할 수 있습니다.
* **지능형 발화 감지 (Semantic VAD)**: Azure의 시맨틱 VAD를 활용하여 사용자의 발화가 끝나는 시점을 의미적으로 감지하고, AI가 즉시 반응하여 자연스러운 대화 흐름을 만듭니다.
* **다국어 음성 모델**: `en-US-Ava:DragonHDLatestNeural`과 같은 다국어 음성 모델을 통해, 사용자가 어떤 언어로 말하든 AI가 해당 언어로 자연스럽게 응답합니다.
* **고품질 오디오 처리**: Azure의 딥러닝 기반 소음 제거(DNS) 및 에코 캔슬링(AEC) 기능으로 명확한 음성 인식을 보장합니다.
* **현대적인 UI/UX**: React와 `lucide-react` 아이콘, `tailwindcss`를 사용하여 직관적이고 미려한 사용자 인터페이스를 제공하며, 채팅 기록과 Push-to-Talk(스페이스바) 기능을 지원합니다.
* **비동기 서버 아키텍처**: FastAPI와 `asyncio`를 기반으로 여러 클라이언트의 동시 접속과 데이터 스트림을 효율적으로 처리합니다.

---

## 아키텍처 (Architecture)

이 프로젝트는 React 프론트엔드, FastAPI 백엔드, 그리고 Azure Voice Live API가 WebSocket으로 통신하는 3-Tier 아키텍처를 따릅니다.

### 1. 사용자 요청 흐름 (User → AI)

**[🎤 React Frontend]** → `Audio Stream` → **[⚙️ FastAPI Server]** → `Audio Stream` → **[☁️ Azure STT]** → `Text` → **[🤖 Azure OpenAI]**

### 2. AI 응답 흐름 (AI → User)

**[🤖 Azure OpenAI]** → `Text` → **[☁️ Azure TTS]** → `Audio & Text Stream` → **[⚙️ FastAPI Server]** → `Audio & Text Stream` → **[🎧 React Frontend]**

1.  **React ↔ FastAPI**: 사용자가 마이크에 말하면, React는 오디오 데이터를 캡처하여 FastAPI 서버로 WebSocket을 통해 전송합니다. FastAPI는 AI의 음성/텍스트 응답을 다시 React로 전송합니다.
2.  **FastAPI (Proxy)**: FastAPI 서버는 React 클라이언트와 Azure API 사이의 중계자(Proxy) 역할을 합니다.
3.  **FastAPI ↔ Azure**: FastAPI는 클라이언트로부터 받은 오디오 스트림을 Azure Voice Live API로 전달합니다.
4.  **Azure → FastAPI**: Azure는 실시간 음성 인식(STT), AI 모델(GPT-4o) 추론, 음성 합성(TTS)을 거쳐 생성된 오디오와 텍스트 스트림을 FastAPI 서버로 다시 보냅니다.

---

## 기술 스택 (Technology Stack)

* **Frontend**:
    * React 18+
    * Tailwind CSS
    * Lucide React (Icons)
* **Backend**:
    * Python 3.9+
    * FastAPI
    * Uvicorn (ASGI Server)
* **핵심 Azure 서비스**:
    * Azure AI Speech - Voice Live API (Preview)
    * Azure OpenAI Service (GPT-4o)
* **주요 라이브러리**:
    * `websockets`: FastAPI와 Azure 간의 비동기 WebSocket 통신
    * `python-dotenv`: 환경 변수 관리

---

## 설치 및 실행 방법 (Setup and Run)

### 1. 사전 준비 (Prerequisites)

* Python 3.9 이상, Node.js 18 이상
* Azure 구독 및 **Voice Live API** 접근 권한이 활성화된 Azure AI Speech 리소스
* Azure OpenAI 리소스 및 `gpt-4o` 모델 배포

### 2. 프로젝트 클론 및 설정

프로젝트를 클론한 후, `backend`와 `frontend` 각각의 디렉터리에서 종속성을 설치해야 합니다.

```bash
# 1. 프로젝트 코드를 클론합니다.
git clone [https://github.com/your-username/Live-Voice-Agent.git](https://github.com/your-username/Live-Voice-Agent.git)
cd Live-Voice-Agent
```

#### Backend (FastAPI) 설정

```bash
# 1. backend 디렉터리로 이동
cd backend

# 2. Python 가상환경 생성 및 활성화
python3 -m venv venv
source venv/bin/activate  # macOS/Linux
# venv\Scripts\activate  # Windows

# 3. 필요한 패키지 설치
pip install -r requirements.txt

# 4. 환경 변수 설정
# .env.example 파일을 복사하여 .env 파일을 생성합니다.
cp .env.example .env
```

`.env` 파일을 열어 자신의 Azure 리소스 정보를 채워 넣습니다.

```env
# backend/.env

# Azure Voice Live API (Speech Service) 정보
AZURE_VOICE_LIVE_ENDPOINT="YOUR_SPEECH_RESOURCE_ENDPOINT"
AZURE_VOICE_LIVE_API_KEY="YOUR_SPEECH_RESOURCE_KEY"

# 사용할 AI 모델 (Azure OpenAI 배포 이름)
VOICE_LIVE_MODEL="gpt-4o"

# API 버전 (현재 프리뷰 버전)
AZURE_VOICE_LIVE_API_VERSION="2025-05-01-preview"
```

#### Frontend (React) 설정

```bash
# 1. frontend 디렉터리로 이동 (프로젝트 루트에서)
cd frontend

# 2. 필요한 패키지 설치
npm install
```

### 3. 애플리케이션 실행

두 개의 터미널을 열고 각각 백엔드 서버와 프론트엔드 개발 서버를 실행합니다.

**터미널 1: Backend 실행**

```bash
cd backend
source venv/bin/activate # 가상환경 활성화
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

**터미널 2: Frontend 실행**

```bash
cd frontend
npm run dev
```

실행 후, 터미널에 나타나는 주소(`http://localhost:5173` 등)를 웹 브라우저에서 열어 애플리케이션을 사용할 수 있습니다.

---

## 라이선스 (License)

이 프로젝트는 [MIT 라이선스](LICENSE)를 따릅니다.