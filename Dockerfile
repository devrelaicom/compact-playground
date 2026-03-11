# Build stage
FROM node:25-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including dev for building)
RUN npm ci

# Copy source code
COPY backend/ ./backend/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:25-slim AS production

# Install required packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    xz-utils \
    unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Set up directories
ENV HOME="/root"
RUN mkdir -p /root/.compact/bin

# Download Compact CLI tool (compact-v0.4.0)
RUN curl -fsSL https://github.com/midnightntwrk/compact/releases/download/compact-v0.4.0/compact-x86_64-unknown-linux-musl.tar.xz \
       -o /tmp/compact.tar.xz \
    && mkdir -p /tmp/compact-extract \
    && tar -xJf /tmp/compact.tar.xz -C /tmp/compact-extract \
    && find /tmp/compact-extract -name "compact" -type f -exec cp {} /root/.compact/bin/compact \; \
    && chmod +x /root/.compact/bin/compact \
    && rm -rf /tmp/compact.tar.xz /tmp/compact-extract

# Set up PATH
ENV PATH="/root/.compact/bin:$PATH"

# Build arg for admin to set default compiler version
ARG DEFAULT_COMPILER=latest

# Pre-install all available compiler versions
RUN compact update 0.29.0 \
    && compact update 0.28.0 \
    && compact update 0.26.0 \
    && compact update 0.25.0 \
    && compact update 0.24.0 \
    && compact update 0.23.0 \
    && compact update 0.22.0

# Set the CLI default — explicit version or latest (0.29.0)
RUN if [ "$DEFAULT_COMPILER" != "latest" ]; then \
      compact update "$DEFAULT_COMPILER"; \
    else \
      compact update 0.29.0; \
    fi

# Verify installation
RUN compact --version && compact list --installed

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

# Create temp directory for compilation
RUN mkdir -p /tmp/compact-playground

# Environment variables
ENV NODE_ENV=production
ENV PORT=8080
ENV TEMP_DIR=/tmp/compact-playground
ENV COMPACT_CLI_PATH=compact
ENV DEFAULT_COMPILER_VERSION=$DEFAULT_COMPILER
ENV CACHE_ENABLED=true
ENV CACHE_MAX_SIZE=1000
ENV CACHE_TTL=3600000

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Start the server
CMD ["node", "dist/backend/src/index.js"]
