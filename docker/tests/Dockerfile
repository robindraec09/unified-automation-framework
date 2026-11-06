# Test runner image: the whole framework + Playwright browsers. Build context is the repo root.
# The base tag must match @playwright/test in pnpm-lock.yaml exactly, or the browsers will not match.
FROM mcr.microsoft.com/playwright:v1.65.0-noble

WORKDIR /repo
ENV QA_ROOT=/repo

# Manifests first so the dependency layer is cached until a package.json or the lockfile changes
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# This image's Node has no Corepack: install the exact pnpm pinned in package.json "packageManager"
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"
COPY packages/api/package.json packages/api/
COPY packages/core/package.json packages/core/
COPY packages/data/package.json packages/data/
COPY packages/etl/package.json packages/etl/
COPY packages/flows/package.json packages/flows/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/mobile/package.json packages/mobile/
COPY packages/test/package.json packages/test/
COPY packages/web/package.json packages/web/
COPY apps/bank/package.json apps/bank/
RUN pnpm install --frozen-lockfile

# Source (.dockerignore keeps .env, node_modules and reports out)
COPY . .

ENTRYPOINT ["pnpm", "exec", "playwright", "test"]
