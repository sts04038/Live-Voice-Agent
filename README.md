# Live-Voice-Agent: 실시간 음성 AI 상담원 (Real-time Voice AI Agent)

[![Python](https://img.shields.io/badge/Python-3.9+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Azure](https://img.shields.io/badge/Azure-Voice%20Live%20API-blue)](https://azure.microsoft.com/en-us/products/ai-services/voice-live-api)

**Azure Voice Live API와 GPT-4o를 기반으로 구축된 실시간 대화형 AI 음성 상담원 프로젝트입니다. 사용자의 음성을 실시간으로 스트리밍하여, 마치 사람과 대화하는 듯한 자연스럽고 지연 시간이 짧은 AI 상담 경험을 제공합니다.**

이 프로젝트는 단순한 STT-NLU-TTS의 순차적 결합을 넘어, WebSocket을 통해 양방향 오디오 스트림을 처리하여 사용자의 말에 즉각적으로 반응하고, 대화의 미묘한 뉘앙스와 타이밍을 포착하는 고수준의 상호작용을 구현하는 것을 목표로 합니다.

---

## 🚀 주요 기능 (Key Features)

* **실시간 양방향 오디오 스트리밍**: WebSocket을 사용하여 사용자의 음성을 실시간으로 서버에 전송하고, AI가 생성한 음성을 지연 없이 스트리밍하여 재생합니다.
* **지능형 발화 감지 (VAD)**: Azure의 시맨틱 VAD(Voice Activity Detection)를 활용하여 사용자의 발화가 끝나는 시점을 정확하게 감지하고, 2초간의 침묵을 대화 턴(Turn)의 종료로 판단하여 자연스러운 대화 흐름을 만듭니다.
* **고성능 AI 모델 연동**: `gpt-4o`와 같은 최신 대화형 AI 모델을 활용하여, 정해진 시나리오를 넘어 유연하고 맥락에 맞는 답변을 생성합니다.
* **고품질 음성 및 노이즈 제거**: Azure의 Standard/Neural 보이스를 사용하여 자연스러운 AI 목소리를 생성하고, 딥러닝 기반 노이즈 제거(DNS) 및 에코 캔슬링(AEC) 기능으로 명확한 음성 인식을 보장합니다.
* **비동기 처리**: Python의 `asyncio`를 기반으로 오디오 송신, 수신, 키보드 입력 등 여러 작업을 동시에 효율적으로 처리합니다.

---

## 🏗️ 아키텍처 (Architecture)

이 프로젝트는 WebSocket 기반의 실시간 통신 모델을 따릅니다.

```
[사용자 마이크]
      │
      └─> (1. 오디오 스트림 캡처) ──> [Python 클라이언트 (sounddevice)]
                                            │
      ┌─────────────────────────────────────┘
      │
(2. Base64 인코딩 및 WebSocket 전송)
      │
      ▼
[Azure Voice Live API Endpoint (wss://...)]
      │
      └─> (3. 실시간 STT, VAD, 노이즈 제거) ──> [Azure OpenAI (gpt-4o)]
                                                     │
      ┌──────────────────────────────────────────────┘
      │
(4. AI 응답 생성 및 실시간 TTS)
      │
      ▼
[Azure Voice Live API Endpoint]
      │
      └─> (5. 오디오 스트림 WebSocket 수신) ──> [Python 클라이언트]
                                                     │
           ┌─────────────────────────────────────────┘
           │
(6. Base64 디코딩 및 오디오 재생)
           │
           ▼
[사용자 스피커]
```

---

## 🛠️ 기술 스택 (Technology Stack)

* **언어**: Python 3.9+
* **핵심 Azure 서비스**:
    * Azure AI Speech - Voice Live API (Preview)
    * Azure OpenAI Service (GPT-4o)
* **주요 라이브러리**:
    * `websockets`: 실시간 양방향 통신
    * `sounddevice`: 마이크 입력 및 스피커 출력 제어
    * `numpy`: 오디오 데이터 처리
    * `asyncio`: 비동기 I/O 처리
    * `python-dotenv`: 환경 변수 관리

---

## ⚙️ 설치 및 실행 방법 (Setup and Run)

### 1. 사전 준비 (Prerequisites)

* Python 3.9 이상
* Azure 구독 및 **Voice Live API** 접근 권한이 활성화된 Azure AI Speech 리소스
* Azure OpenAI 리소스 및 `gpt-4o` 모델 배포
* (Windows/macOS) `PortAudio` 라이브러리 (sounddevice 구동에 필요)

### 2. 프로젝트 클론 및 설정

다른 패키지와의 충돌을 방지하기 위해 가상환경에서 프로젝트를 설정하는 것을 추천합니다.

#### Windows (PowerShell)

```powershell
# 1. 프로젝트 코드를 클론합니다.
git clone [https://github.com/your-username/your-repository-name.git](https://github.com/your-username/your-repository-name.git)
cd your-repository-name

# 2. Python 가상환경을 생성하고 활성화합니다.
python -m venv venv
.\venv\Scripts\Activate.ps1

# 3. pip를 최신 버전으로 업그레이드합니다.
python -m pip install --upgrade pip

# 4. requirements.txt 파일에 명시된 모든 패키지를 설치합니다.
pip install -r requirements.txt
```

#### macOS / Linux (bash)

```bash
# 1. 프로젝트 코드를 클론합니다.
git clone [https://github.com/your-username/your-repository-name.git](https://github.com/your-username/your-repository-name.git)
cd your-repository-name

# 2. Python 가상환경을 생성하고 활성화합니다.
python3 -m venv venv
source venv/bin/activate

# 3. pip를 최신 버전으로 업그레이드합니다.
pip install --upgrade pip

# 4. requirements.txt 파일에 명시된 모든 패키지를 설치합니다.
pip install -r requirements.txt
```

### 3. 환경 변수 설정

프로젝트 루트 디렉터리에 `.env` 파일을 생성하고 아래 내용을 자신의 Azure 리소스 정보로 채워 넣습니다.

```env
# Azure Voice Live API (Speech Service) 정보
AZURE_VOICE_LIVE_ENDPOINT="YOUR_SPEECH_RESOURCE_ENDPOINT" # 예: [https://koreacentral.api.cognitive.microsoft.com/](https://koreacentral.api.cognitive.microsoft.com/)
AZURE_VOICE_LIVE_API_KEY="YOUR_SPEECH_RESOURCE_KEY"

# 사용할 AI 모델
VOICE_LIVE_MODEL="YOUR_AZURE_OPENAI_DEPLOYMENT_NAME" # 예: gpt-4o

# API 버전 (현재 프리뷰 버전)
AZURE_VOICE_LIVE_API_VERSION="2025-05-01-preview"
```

### 4. 애플리케이션 실행

```bash
python main.py
```

실행 후 콘솔에 "Starting the chat ..." 메시지가 나타나면 마이크에 대고 말을 시작할 수 있습니다. 채팅을 종료하려면 콘솔에서 `q`를 누르고 Enter 키를 입력하세요.

---

## 🔧 주요 설정값 (Configuration)

`main.py` 파일의 `session_update` 딕셔너리에서 AI의 행동과 관련된 주요 파라미터를 조정할 수 있습니다.

* `instructions`: AI의 역할(페르소나)을 정의하는 시스템 프롬프트입니다.
* `silence_duration_ms`: 사용자의 말이 끝난 후, AI가 응답을 시작하기까지 기다리는 침묵 시간(밀리초)입니다. 이 프로젝트의 핵심 파라미터 중 하나입니다.
* `voice.name`: AI의 목소리를 지정합니다. [지원되는 음성 목록](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts)에서 선택할 수 있습니다.
* `voice.temperature`: AI 목소리의 운율(prosody) 변화 정도를 조절합니다. (0.0 ~ 2.0)

---

## 📄 라이선스 (License)

이 프로젝트는 [MIT 라이선스](LICENSE)를 따릅니다.
