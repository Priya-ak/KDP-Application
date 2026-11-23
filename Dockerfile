# ---- build stage: compile the React UI and bundle the server ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage: production dependencies + built output only ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000 \
    DATA_DIR=/app/.data \
    TRUST_PROXY=true \
    SECURE_COOKIES=true
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 8000
# Free instance has 512 MB RAM: cap the V8 heap so Node doesn't get OOM-killed.
CMD ["node", "--max-old-space-size=384", "dist/server/main.js"]
