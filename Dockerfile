# Build stage
FROM node:22-slim AS builder

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
FROM node:22-slim AS production

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

# Download Compact Compiler (compactc-v0.26.0)
# The zip contains: compactc (wrapper script), compactc.bin, zkir, fixup-compact, format-compact
RUN curl -fsSL https://github.com/midnightntwrk/compact/releases/download/compactc-v0.26.0/compactc_v0.26.0_x86_64-unknown-linux-musl.zip \
       -o /tmp/compactc.zip \
    && unzip -q /tmp/compactc.zip -d /root/.compact/bin/ \
    && chmod +x /root/.compact/bin/compactc \
    && chmod +x /root/.compact/bin/compactc.bin \
    && chmod +x /root/.compact/bin/zkir \
    && chmod +x /root/.compact/bin/fixup-compact 2>/dev/null || true \
    && chmod +x /root/.compact/bin/format-compact 2>/dev/null || true \
    && rm -rf /tmp/compactc.zip

# Set up PATH
ENV PATH="/root/.compact/bin:$PATH"

# Verify installation
RUN echo "=== Compact Installation ===" \
    && echo "Files in .compact/bin:" && ls -la /root/.compact/bin/ \
    && echo "CLI version:" && compact --version \
    && echo "Compiler version:" && compactc --version \
    && echo "=== Installation Complete ==="

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
ENV COMPACT_PATH=compactc

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Start the server
CMD ["node", "dist/backend/src/index.js"]
