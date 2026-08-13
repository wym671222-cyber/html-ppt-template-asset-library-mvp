FROM node:22-bookworm

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @slide-maker/api build \
  && pnpm --filter @slide-maker/web build

ENV NODE_ENV=production
ENV POCKETBAY_RUNTIME=true
ENV POCKETBAY_DATA_DIR=/data
ENV ASSET_LIBRARY_DATA_ROOT=/data

EXPOSE 3000

CMD ["node", "ops/pocketbay/start.mjs"]
