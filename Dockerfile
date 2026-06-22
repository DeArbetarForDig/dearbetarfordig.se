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

EXPOSE 3000
CMD ["node", "--import", "tsx", "packages/api/src/index.ts"]
