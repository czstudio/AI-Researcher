# syntax=docker/dockerfile:1
FROM node:22-slim AS build
WORKDIR /src/app
COPY app/package*.json ./
RUN npm install
COPY app/ ./
RUN npm run build --if-present || npx vite build

FROM python:3.11-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    NODE_VERSION=22
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates xz-utils \
 && curl -fsSL https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-x64.tar.xz \
    | tar -xJ -C /usr/local --strip-components=1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/ ./server/
COPY contracts/ ./contracts/
COPY ops/ ./ops/
COPY research_agent/ ./research_agent/
COPY paper_agent/ ./paper_agent/
COPY --from=build /src/app/dist ./app/dist
COPY install.sh ./

ENV PORT_SITE=8081 NOVIX_DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 8081
CMD ["node", "server/serve.mjs"]
