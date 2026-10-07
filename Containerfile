# Stage 1: Frontend Build (native platform — JS output is arch-independent)
FROM --platform=$BUILDPLATFORM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS frontend
WORKDIR /app
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN npm install -g pnpm@11.9.0 && pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

# Stage 2: Backend Build (cross-compile Go for target platform without QEMU)
FROM --platform=$BUILDPLATFORM golang:1.27-alpine@sha256:8a5910f31396cd4d89662f56c68b3ae31d374308270a1c3bd96672ee5ed43414 AS backend
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
