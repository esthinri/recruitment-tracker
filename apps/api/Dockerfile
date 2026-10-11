FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --omit=dev --workspace=@recruitment-tracker/api --include-workspace-root=false

WORKDIR /app/apps/api
COPY apps/api/migrations ./migrations
COPY apps/api/scripts ./scripts
COPY apps/api/src ./src
USER node
EXPOSE 4000
CMD ["node", "src/server.mjs"]
