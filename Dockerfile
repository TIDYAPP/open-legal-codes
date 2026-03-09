FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
# Install without workspace resolution (web/ is not in Docker context)
RUN npm install --ignore-scripts --workspaces=false
COPY src/ src/
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts --workspaces=false
COPY --from=builder /app/dist ./dist
EXPOSE 3100
CMD ["node", "dist/server.js"]
