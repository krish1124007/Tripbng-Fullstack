# TripBng — B2B Travel Platform

Enterprise B2B flight distribution platform for the Indian travel trade.

> Full product spec lives in [CLAUDE.md](./CLAUDE.md).

## Stack
- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui
- **Backend**: Express.js + TypeScript + Mongoose + Redis + BullMQ
- **Monorepo**: pnpm workspaces + Turborepo

## Prerequisites
- Node.js >= 22 (`nvm use`)
- pnpm >= 10 (`npm i -g pnpm`)
- Docker (for local Mongo + Redis)

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm docker:up        # starts Mongo + Redis
pnpm seed             # seeds demo data
pnpm dev              # starts api (4000) + web (3000)
```

## Workspace layout

```
apps/
  api/        # Express API
  web/        # Next.js admin/distributor/agency panel
packages/
  config/     # Shared eslint/ts/tailwind base configs
  shared/     # Zod schemas, enums, permissions, error codes (FE+BE)
  ui/         # Shared component library (planned, Phase 1)
infra/
  docker/     # docker-compose for local services
  seed/       # Seed scripts
  github/     # CI workflows
```

## Common tasks

| Command | Effect |
|---|---|
| `pnpm dev` | Run all apps in watch mode |
| `pnpm build` | Build everything |
| `pnpm lint` | Lint all packages |
| `pnpm typecheck` | TS typecheck all packages |
| `pnpm test` | Run all tests |
| `pnpm format` | Prettier write all files |
| `pnpm seed` | Seed dev DB with demo users |

## Default seeded credentials

After running `pnpm seed`:

| Role | Email | Password |
|---|---|---|
| Super Admin | `admin@tripbng.dev` | `Tripbng@123` |
| Distributor | `dist1@tripbng.dev` | `Tripbng@123` |
| Agency owner | `agency1@tripbng.dev` | `Tripbng@123` |

## Phase status
Currently building **Phase 0 — Foundations**. See [CLAUDE.md §17](./CLAUDE.md) for the phased roadmap.
