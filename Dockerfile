FROM node:22-slim AS deps
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install -g bun
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS builder
WORKDIR /app
COPY src/ ./src/
COPY public/ ./public/
COPY next.config.ts .
COPY tsconfig.json .
COPY postcss.config.mjs .
RUN bun run build

FROM node:22-slim AS ws
RUN npm install -g bun
WORKDIR /ws
COPY mini-services/kanban-ws/package.json mini-services/kanban-ws/bun.lock ./
RUN bun install --frozen-lockfile
COPY mini-services/kanban-ws/ ./

FROM node:22-slim AS runner
RUN npm install -g bun
WORKDIR /app

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static/
COPY --from=builder /app/public ./public
COPY --from=ws /ws/node_modules ./ws/node_modules/
COPY --from=ws /ws/index.ts ./ws/
COPY --from=ws /ws/package.json ./ws/
COPY gateway.js ./gateway.js

RUN mkdir -p /app/data/tasks
VOLUME /app/data/tasks

ENV TASKS_DIR=/app/data/tasks
ENV NODE_ENV=production
ENV PORT=3000
ENV APP_PORT=3001
ENV WS_PORT=3003
EXPOSE 3000

COPY docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]
