# Live Voice Agent: 실시간 음성 AI 상담원 (Cloud Native Web App)

[![Docker Build & Push](https://github.com/sts04038/Live-Voice-Agent/actions/workflows/build-and-push.yml/badge.svg)](https://github.com/sts04038/Live-Voice-Agent/actions/workflows/build-and-push.yml)
[![GCP Cloud Run](https://img.shields.io/badge/Google_Cloud-Run-4285F4?logo=google-cloud)](https://cloud.google.com/run)
[![React](https://img.shields.io/badge/React-18+-61DAFB.svg?logo=react)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688.svg?logo=fastapi)](https://fastapi.tiangolo.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**React, FastAPI, Azure Voice Live API를 기반으로 구축하고, Docker와 GitHub Actions를 통해 Google Cloud Run에 자동으로 배포되는 실시간 AI 음성 상담원 웹 애플리케이션입니다.**

이 프로젝트는 웹 애플리케이션 개발을 넘어, **컨테이너화(Docker)**, **CI/CD 파이프라인(GitHub Actions)**, **클라우드 배포(GCP)**를 포함하는 현대적인 DevOps 워크플로우를 적용하여 안정적이고 확장 가능한 클라우드 네이티브 서비스를 구축하는 것을 목표로 합니다.

---

## 주요 기능 (Key Features)

-   **웹 기반 실시간 통신**: 브라우저의 마이크를 통해 음성을 입력받고, 스피커로 AI의 음성을 실시간 스트리밍합니다.
-   **지능형 발화 감지 (Semantic VAD)**: Azure의 시맨틱 VAD를 활용하여 사용자의 발화 종료 시점을 정확하게 감지하고 AI가 즉각적으로 반응합니다.
-   **다국어 음성 모델**: `en-US-Ava:DragonHDLatestNeural`과 같은 다국어 음성 모델을 통해 사용자의 언어에 맞춰 자연스럽게 응답합니다.
-   **현대적인 UI/UX**: React와 Tailwind CSS를 사용하여 채팅 기록, Push-to-Talk(스페이스바) 등 직관적인 인터페이스를 제공합니다.
-   **클라우드 네이티브 아키텍처**:
    -   **컨테이너화**: 프론트엔드와 백엔드를 Docker 컨테이너로 패키징하여 어떤 환경에서든 일관된 실행을 보장합니다.
    -   **CI/CD 자동화**: GitHub Actions를 통해 코드 Push 시 자동으로 Docker 이미지를 빌드하고 Google Cloud에 배포합니다.
    -   **서버리스 배포**: Google Cloud Run을 통해 트래픽에 따라 자동으로 확장/축소되는 서버리스 환경에서 서비스를 운영합니다.

---

## 아키텍처 (Architecture)

이 시스템은 CI/CD 파이프라인을 통해 Google Cloud Run에 배포되는 3-Tier 구조를 따릅니다.

1.  **개발 및 푸시**: 개발자가 코드를 수정하고 `devops` 브랜치에 `git push` 합니다.
2.  **CI (지속적 통합)**: GitHub Actions가 코드 변경을 감지하고, 자동으로 `frontend`와 `backend`의 Docker 이미지를 빌드하여 Google Artifact Registry에 업로드합니다.
3.  **CD (지속적 배포)**: CI가 성공하면, GitHub Actions는 새로 빌드된 이미지를 사용하여 Google Cloud Run에 자동으로 서비스를 배포(업데이트)합니다.
4.  **서비스 실행**: 배포된 프론트엔드와 백엔드는 클라우드 환경에서 서로 통신하며 사용자에게 실시간 음성 AI 서비스를 제공합니다.

---

## 기술 스택 (Technology Stack)

-   **Frontend**: React 18+, Tailwind CSS
-   **Backend**: Python 3.11+, FastAPI, Uvicorn
-   **Cloud & DevOps**:
    -   **컨테이너**: Docker, Docker Compose
    -   **CI/CD**: GitHub Actions
    -   **클라우드 플랫폼**: Google Cloud Run, Google Artifact Registry, Google Secret Manager
-   **AI Service**: Azure AI Speech (Voice Live API), Azure OpenAI (GPT-4o)

---

## 로컬 개발 환경 실행 방법 (Local Development)

이 프로젝트는 Docker를 사용하여 로컬 환경에서 손쉽게 실행할 수 있습니다.

### 1. 사전 준비 (Prerequisites)

-   Docker Desktop 설치
-   프로젝트 루트에 `backend/.env` 파일 생성 (아래 내용 참조)

`backend` 폴더 안에 `.env` 파일을 만들고 자신의 Azure 리소스 정보를 채워 넣습니다.

```env
# backend/.env

AZURE_VOICE_LIVE_ENDPOINT="YOUR_SPEECH_RESOURCE_ENDPOINT"
AZURE_VOICE_LIVE_API_KEY="YOUR_SPEECH_RESOURCE_KEY"
VOICE_LIVE_MODEL="gpt-4o"
AZURE_VOICE_LIVE_API_VERSION="2025-05-01-preview"
```

### 2. 실행

프로젝트 최상위 폴더에서 아래 명령어를 실행합니다.

```bash
docker-compose up --build
```

웹 브라우저에서 `http://localhost:5173` 주소로 접속하여 애플리케이션을 테스트할 수 있습니다.

---

## 배포 (Deployment)

이 프로젝트는 **GitHub Actions**를 통해 `devops` 브랜치에 코드가 `push`될 때마다 **자동으로 Google Cloud Run에 배포**됩니다. 수동 배포 과정은 필요하지 않습니다.

배포 워크플로우는 `.github/workflows/build-and-push.yml` 파일에 정의되어 있습니다.

---

## 라이선스 (License)

이 프로젝트는 [MIT 라이선스](LICENSE)를 따릅니다.
