ARG NODE_VERSION=22

# ---- builder ----
FROM node:${NODE_VERSION}-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

# Copy minimal manifests for caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/config/package.json ./packages/config/

RUN pnpm install --frozen-lockfile

# Copy sources & build
COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm --filter @tripbng/shared build
RUN pnpm --filter @tripbng/api build

# Strip dev deps
RUN pnpm --filter @tripbng/api deploy --prod /out

# ---- runtime ----
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache wget tini
COPY --from=builder /out /app
EXPOSE 4000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:4000/readyz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
