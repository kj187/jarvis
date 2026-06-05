# Stage 1: Frontend Build
FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

# Stage 2: Backend Build
FROM golang:1.24-alpine AS backend
WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=frontend /app/dist ./internal/static/dist
RUN CGO_ENABLED=0 go build -tags prod -o /jarvis ./cmd/jarvis

# Stage 3: Final (minimal, non-root)
FROM gcr.io/distroless/static-debian12
USER nonroot:nonroot
COPY --from=backend /jarvis /jarvis
ENTRYPOINT ["/jarvis"]
