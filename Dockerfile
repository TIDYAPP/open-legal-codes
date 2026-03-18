FROM node:22-alpine AS builder
WORKDIR /app
# Build tools needed for better-sqlite3 native addon
RUN apk add --no-cache python3 make g++
COPY package*.json tsconfig.json ./
# Install without workspace resolution (web/ is not in Docker context)
RUN npm install --workspaces=false
COPY src/ src/
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache ca-certificates python3 make g++
COPY package*.json ./
RUN npm install --omit=dev --workspaces=false
COPY --from=builder /app/dist ./dist
# Registry data (jurisdiction catalog for auto-crawl discovery)
COPY data/ data/
EXPOSE 3100
CMD ["node", "--max-old-space-size=1536", "dist/server.js"]
