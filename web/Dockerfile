# Build context: repo root (see docker-compose.yml), so the fixture snapshot is available.
FROM node:20-alpine AS build
WORKDIR /repo/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
COPY data/snapshots /repo/data/snapshots
ARG NEXT_PUBLIC_DATA_SOURCE=fixtures
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_DATA_SOURCE=$NEXT_PUBLIC_DATA_SOURCE NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NODE_ENV=production
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0
COPY --from=build /repo/web/.next/standalone ./
COPY --from=build /repo/web/.next/static ./.next/static
EXPOSE 3001
CMD ["node", "server.js"]
