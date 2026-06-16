# Stage 1: Frontend Build
FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

# Stage 2: Backend Build
FROM golang:1.25-alpine AS backend
ARG VERSION=dev
WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=frontend /app/dist ./internal/static/dist
RUN CGO_ENABLED=0 go build -tags prod \
    -ldflags "-X github.com/kj187/jarvis/backend/internal/version.Version=${VERSION}" \
    -o /jarvis ./cmd/jarvis

# Stage 3: Final (minimal, non-root)
FROM gcr.io/distroless/static-debian12
USER nonroot:nonroot
COPY --from=backend /jarvis /jarvis
ENTRYPOINT ["/jarvis"]
