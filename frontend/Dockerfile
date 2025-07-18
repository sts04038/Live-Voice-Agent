# frontend/Dockerfile
# --- 1단계: React 앱을 '조립'하는 작업장 (Builder) ---
# Node.js 18 버전 환경에서 시작합니다. 'as builder'는 이 단계에 별명을 붙여주는 것입니다.
FROM node:18-alpine as builder

# 작업장 안의 '/app' 폴더로 이동합니다.
WORKDIR /app

# package.json 파일들을 먼저 복사합니다.
COPY package*.json ./

# 필요한 모든 라이브러리(부품)를 설치합니다.
RUN npm install

# 나머지 모든 소스 코드를 복사합니다.
COPY . .

# React 앱을 순수 웹사이트 파일(HTML, CSS, JS)로 '조립(빌드)'합니다.
RUN npm run build

# --- 2단계: 조립된 웹사이트를 '전시'하는 서버 (Server) ---
# '조립'이 끝났으니, 무거운 도구(Node.js)는 버리고 가벼운 웹서버(Nginx)만 사용합니다.
FROM nginx:stable-alpine

# '조립' 단계(builder)의 결과물(/app/dist 폴더)을 웹서버의 전시 공간(/usr/share/nginx/html)으로 가져옵니다.
COPY --from=builder /app/dist /usr/share/nginx/html

# 80번 포트를 외부와 연결할 수 있도록 개방합니다.
EXPOSE 80

# Nginx 웹서버를 실행시킵니다.
CMD ["nginx", "-g", "daemon off;"]