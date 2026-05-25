FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:4000/health || exit 1

CMD ["node", "src/server.js"]
