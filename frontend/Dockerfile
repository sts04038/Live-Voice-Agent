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

# Builder 단계의 결과물을 Nginx 서버 폴더로 복사
COPY --from=builder /app/dist /usr/share/nginx/html

# 우리가 만든 Nginx 설정 파일을 템플릿 폴더로 복사
# default.conf 대신 default.conf.template 으로 이름을 바꿉니다.
COPY ./nginx/default.conf /etc/nginx/templates/default.conf.template

# 8080 포트를 기본으로 사용하도록 노출 (Cloud Run은 이 설정을 무시하고 $PORT를 주입합니다)
EXPOSE 8080

# 컨테이너가 시작될 때, 셸을 통해 templates 폴더의 내용을 conf.d 폴더로 복사하고 Nginx를 실행
# 이 과정을 통해 Nginx 설정 파일 안의 ${PORT} 변수가 Cloud Run이 제공하는 값(8080)으로 치환됩니다.
CMD /bin/sh -c "envsubst < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"