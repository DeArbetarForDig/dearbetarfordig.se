FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# Install deps (need devDeps for tsx at build time)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared packages/shared
COPY packages/api packages/api
COPY data data

# WORKDIR must be packages/api, not /app: pnpm gives each workspace package
# its own node_modules (no hoisting to root), so `tsx` — a devDependency of
# @daf/api only — resolves solely from here. Running from /app crash-loops
# with ERR_MODULE_NOT_FOUND on 'tsx' (caught by an actual container smoke
# test, not just a syntax read — see docs/HOSTING.md deploy checklist).
WORKDIR /app/packages/api
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/index.ts"]
