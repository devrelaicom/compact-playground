# Build stage
FROM node:24-slim AS builder

WORKDIR /app

# Copy package files and build configs
COPY package*.json ./
COPY tsconfig.json tsconfig.build.json ./

# Install all dependencies (including dev for building)
RUN npm ci

# Copy source code
COPY backend/ ./backend/

# Build TypeScript for production (no source maps, no declarations, no tests)
RUN npx tsc -p tsconfig.build.json

# OZ Compact dependencies stage — clone in a lightweight image, keep git out of production
FROM alpine/git AS oz-clone
ARG OZ_COMPACT_COMMIT=86e8e87b06b81dae26c52457939e7e97c2f09651
RUN git init /opt/oz-compact \
    && cd /opt/oz-compact \
    && git remote add origin https://github.com/OpenZeppelin/compact-contracts.git \
    && git fetch --depth 1 origin $OZ_COMPACT_COMMIT \
    && git checkout FETCH_HEAD \
    && rm -rf .git .github

# OZ Simulator build stage — install deps and compile TypeScript
# The OZ repo uses Yarn 4 workspaces (not npm), so we enable corepack.
FROM node:24-slim AS oz-builder
COPY --from=oz-clone /opt/oz-compact /opt/oz-compact
WORKDIR /opt/oz-compact
# Enable corepack so the repo's packageManager field activates Yarn 4
RUN corepack enable && corepack prepare
# Install all workspace dependencies (including devDeps needed for build)
RUN yarn install
# Upgrade compact-runtime to match what the latest compiler (0.30.0) emits.
# The OZ repo pins 0.14.0 but compiler 0.30.0 generates bindings expecting 0.15.0.
RUN yarn up @midnight-ntwrk/compact-runtime@0.15.0
# Build the simulator package (tsc -p .)
WORKDIR /opt/oz-compact/packages/simulator
RUN yarn build
# Remove build tooling and test files to keep the production image lean.
# We keep node_modules (has compact-runtime) and dist/ (built simulator).
WORKDIR /opt/oz-compact
RUN rm -rf .yarn/cache packages/simulator/src packages/simulator/test \
    && find . -name "*.tsbuildinfo" -delete

# Production stage
FROM node:24-slim AS production

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

# Download Compact CLI tool (compact-v0.5.0)
RUN curl -fsSL https://github.com/midnightntwrk/compact/releases/download/compact-v0.5.0/compact-x86_64-unknown-linux-musl.tar.xz \
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
RUN compact update 0.30.0 \
    && compact update 0.29.0 \
    && compact update 0.28.0 \
    && compact update 0.26.0 \
    && compact update 0.25.0 \
    && compact update 0.24.0 \
    && compact update 0.23.0 \
    && compact update 0.22.0

# Set the CLI default — explicit version or latest (0.30.0)
RUN if [ "$DEFAULT_COMPILER" != "latest" ]; then \
      compact update "$DEFAULT_COMPILER"; \
    else \
      compact update 0.30.0; \
    fi

# Verify installation
RUN compact --version && compact list --installed

# ── OpenZeppelin Compact Dependencies ──────────────────────────────────
# Copied from oz-builder stage (built simulator + pruned deps)
COPY --from=oz-builder /opt/oz-compact /opt/oz-compact

# Set up OZ environment variables
ENV OZ_CONTRACTS_PATH=/opt/oz-compact/contracts/src
ENV OZ_SIMULATOR_PATH=/opt/oz-compact/packages/simulator

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

# Create non-root user and writable directories
RUN groupadd --system appgroup \
    && useradd --system --no-log-init --gid appgroup --home-dir /home/appuser --create-home appuser \
    && mkdir -p /tmp/compact-playground /data/cache \
    && mv /root/.compact /home/appuser/.compact \
    && chown -R appuser:appgroup /home/appuser/.compact /tmp/compact-playground /data/cache /app

# Environment variables
ENV NODE_ENV=production
ENV PORT=8080
ENV HOME=/home/appuser
ENV PATH="/home/appuser/.compact/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ENV COMPACT_DIRECTORY=/home/appuser/.compact
ENV TEMP_DIR=/tmp/compact-playground
ENV COMPACT_CLI_PATH=compact
ENV DEFAULT_COMPILER_VERSION=$DEFAULT_COMPILER
ENV CACHE_ENABLED=true
ENV CACHE_DIR=/data/cache
ENV CACHE_MAX_DISK_MB=800
ENV CACHE_MAX_ENTRIES=50000
ENV CACHE_TTL=2592000000

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Switch to non-root user
USER appuser

# Start the server
CMD ["node", "dist/backend/src/index.js"]
