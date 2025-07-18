# frontend/Dockerfile (최종 완성본)

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
RUN apk add --no-cache gettext

# Nginx 컨테이너 환경에 PORT 변수를 만들고 기본값으로 8080을 설정합니다.
# 이렇게 하면 envsubst가 이 값을 사용하여 설정 파일을 올바르게 생성할 수 있습니다.
ENV PORT 8080

EXPOSE 8080

# 이제 $PORT 변수가 존재하므로 envsubst가 정상적으로 값을 치환할 수 있습니다.
CMD ["/bin/sh", "-c", "set -e; envsubst '$PORT' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf; nginx -g 'daemon off;'"]