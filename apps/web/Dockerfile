ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/config/package.json ./packages/config/

RUN pnpm install --frozen-lockfile

COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN pnpm --filter @tripbng/shared build
RUN pnpm --filter @tripbng/web build

FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /repo/apps/web/.next ./.next
COPY --from=builder /repo/apps/web/public ./public
COPY --from=builder /repo/apps/web/package.json ./package.json
COPY --from=builder /repo/apps/web/next.config.mjs ./next.config.mjs
COPY --from=builder /repo/node_modules ./node_modules
EXPOSE 3000
USER node
CMD ["./node_modules/.bin/next", "start", "-p", "3000"]
