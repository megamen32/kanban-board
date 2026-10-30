FROM node:22-slim AS deps
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
# Node 22 (OpenSSL 3.5) sends a post-quantum key share; the uplink DPI drops that
# ClientHello to registry.npmjs.org. Classic groups only, for this one install.
RUN printf "nodejs_conf = a\n[a]\nssl_conf = b\n[b]\nsystem_default = c\n[c]\nGroups = X25519:P-256:P-384\n" > /tmp/no-pq.cnf \
    && OPENSSL_CONF=/tmp/no-pq.cnf npm install -g bun@1.3.14 && rm /tmp/no-pq.cnf
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
# Node 22 (OpenSSL 3.5) sends a post-quantum key share; the uplink DPI drops that
# ClientHello to registry.npmjs.org. Classic groups only, for this one install.
RUN printf "nodejs_conf = a\n[a]\nssl_conf = b\n[b]\nsystem_default = c\n[c]\nGroups = X25519:P-256:P-384\n" > /tmp/no-pq.cnf \
    && OPENSSL_CONF=/tmp/no-pq.cnf npm install -g bun@1.3.14 && rm /tmp/no-pq.cnf
WORKDIR /ws
COPY mini-services/kanban-ws/package.json mini-services/kanban-ws/bun.lock ./
RUN bun install --frozen-lockfile
COPY mini-services/kanban-ws/ ./

FROM node:22-slim AS runner
# Node 22 (OpenSSL 3.5) sends a post-quantum key share; the uplink DPI drops that
# ClientHello to registry.npmjs.org. Classic groups only, for this one install.
RUN printf "nodejs_conf = a\n[a]\nssl_conf = b\n[b]\nsystem_default = c\n[c]\nGroups = X25519:P-256:P-384\n" > /tmp/no-pq.cnf \
    && OPENSSL_CONF=/tmp/no-pq.cnf npm install -g bun@1.3.14 && rm /tmp/no-pq.cnf
WORKDIR /app

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static/
COPY --from=builder /app/public ./public
COPY --from=ws /ws/node_modules ./ws/node_modules/
COPY --from=ws /ws/index.ts ./ws/
COPY --from=ws /ws/board-watcher.ts ./ws/
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
