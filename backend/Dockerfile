# backend/Dockerfile

# 1. 베이스 이미지 선택: Python 3.9 버전이 설치된 가벼운 리눅스에서 시작합니다.
FROM python:3.11-slim

# 2. 작업 디렉터리 설정: 컨테이너 안의 '/app'이라는 폴더에서 모든 작업을 수행합니다.
WORKDIR /app

# 3. 의존성 파일 복사: 먼저 라이브러리 목록 파일만 복사합니다.
# (나중에 코드만 수정했을 때, 라이브러리를 다시 설치하는 비효율을 막기 위함입니다.)
COPY ./requirements.txt .

# 4. 의존성 설치: requirements.txt에 적힌 모든 라이브러리를 설치합니다.
# pynput 설치에 필요한 부품들을 설치합니다.
RUN apt-get update && apt-get install -y build-essential libevdev-dev
RUN pip install --no-cache-dir -r requirements.txt

# 5. 소스 코드 복사: 현재 폴더(backend)의 모든 파일을 컨테이너의 /app 폴더로 복사합니다.
COPY . .

# 6. 컨테이너 실행 명령어: 이 컨테이너가 시작될 때, uvicorn 서버를 실행하라는 명령어입니다.
# '--host 0.0.0.0'는 컨테이너 외부에서 접속을 허용하겠다는 의미입니다.
# Cloud Run이 PORT 환경 변수로 지정해주는 포트를 사용하도록 변경합니다.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "$PORT"]