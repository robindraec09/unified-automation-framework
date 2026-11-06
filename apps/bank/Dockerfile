# Harbourline Bank app image. Build context is the repo root:
#   docker build -f apps/bank/Dockerfile -t harbourline-bank .
# Installs only the bank app's dependencies from the workspace lockfile.

FROM node:22-slim AS deps
WORKDIR /repo
RUN corepack enable
# Workspace manifests + lockfile, so the install is reproducible (--frozen-lockfile)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ packages/
COPY apps/bank/package.json apps/bank/
RUN pnpm install --frozen-lockfile --prod --filter @qa/bank-app

FROM node:22-slim
WORKDIR /repo
ENV NODE_ENV=production \
    QA_ROOT=/repo \
    BANK_PORT=4000
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/bank/node_modules ./apps/bank/node_modules
COPY apps/bank/package.json apps/bank/
COPY apps/bank/src apps/bank/src
COPY apps/bank/scripts apps/bank/scripts
COPY apps/bank/db apps/bank/db
COPY apps/bank/public apps/bank/public
USER node
EXPOSE 4000
HEALTHCHECK --interval=5s --timeout=3s --retries=12 \
  CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["apps/bank/node_modules/.bin/tsx", "apps/bank/src/server.ts"]
