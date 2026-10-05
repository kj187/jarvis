# Stage 1: Frontend Build (native platform — JS output is arch-independent)
FROM --platform=$BUILDPLATFORM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS frontend
WORKDIR /app
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN npm install -g pnpm@11.9.0 && pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

# Stage 2: Backend Build (cross-compile Go for target platform without QEMU)
FROM --platform=$BUILDPLATFORM golang:1.26-alpine@sha256:8ac98ca534ac3f51e1f420a1dd2c15e74c75cfa0f23f3ad27eb5d7236c349a0c AS backend
ARG VERSION=dev
ARG TARGETOS
ARG TARGETARCH
WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=frontend /app/dist ./internal/static/dist
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -tags prod \
    -ldflags "-X github.com/kj187/jarvis/backend/internal/version.Version=${VERSION}" \
    -o /jarvis ./cmd/jarvis

# Stage 3: Final (minimal, non-root)
FROM gcr.io/distroless/static-debian12@sha256:d75cdd72874d4790092fcb1b058493ecf6bb5bf2b2b897045b00ff01d91843f2
USER nonroot:nonroot
COPY --from=backend /jarvis /jarvis
ENTRYPOINT ["/jarvis"]
