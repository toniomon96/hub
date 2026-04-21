FROM node:22-slim

WORKDIR /app

RUN corepack enable

# Copy manifests first so dependency install is cached
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/cli/package.json ./apps/cli/
COPY apps/mcp/package.json ./apps/mcp/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY packages/agent-runtime/package.json ./packages/agent-runtime/
COPY packages/capture/package.json ./packages/capture/
COPY packages/db/package.json ./packages/db/
COPY packages/models/package.json ./packages/models/
COPY packages/prompts/package.json ./packages/prompts/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile

COPY . .

# Build server and all its dependencies (skips apps/web — built by Vercel)
RUN pnpm --filter @hub/server... build

EXPOSE 4567

CMD ["node", "--no-warnings=ExperimentalWarning", "apps/server/dist/main.js"]
