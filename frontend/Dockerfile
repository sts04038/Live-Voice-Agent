# frontend/Dockerfile

# --- 1단계: React 앱을 '조립'하는 작업장 (Builder) ---
FROM node:18-alpine as builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# --- 2단계: 조립된 웹사이트를 '전시'하는 서버 (Server) ---
FROM nginx:stable-alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY ./nginx/default.conf /etc/nginx/templates/default.conf.template

# --- 이 부분이 추가되었습니다 ---
# Nginx 컨테이너(Alpine Linux)에 envsubst 도구가 포함된 gettext 패키지를 설치합니다.
RUN apk add --no-cache gettext

EXPOSE 8080

# 이제 envsubst 명령어가 존재하므로, 이 명령어가 정상적으로 실행됩니다.
CMD /bin/sh -c "envsubst < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"