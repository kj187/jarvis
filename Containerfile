# Stage 1: Frontend Build (native platform — JS output is arch-independent)
FROM --platform=$BUILDPLATFORM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS frontend
WORKDIR /app
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN npm install -g pnpm@11.9.0 && pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build
# License texts of the production dependencies bundled into the UI. Fails when a
# package ships no license file (scripts/third-party-licenses-npm.mjs).
COPY scripts/third-party-licenses-npm.mjs /tmp/third-party-licenses-npm.mjs
RUN pnpm licenses list --prod --json > /tmp/npm-licenses.json \
    && node /tmp/third-party-licenses-npm.mjs < /tmp/npm-licenses.json > /app/THIRD_PARTY_LICENSES.npm

# Stage 2: Backend Build (cross-compile Go for target platform without QEMU)
FROM --platform=$BUILDPLATFORM golang:1.27-alpine@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d AS backend
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
# License texts of the Go modules linked into the binary plus the npm ones from
# the frontend stage, shipped as /THIRD_PARTY_LICENSES. Fails when a module ships
# no license file (scripts/third-party-licenses-go.sh).
COPY scripts/third-party-licenses-go.sh /tmp/third-party-licenses-go.sh
COPY --from=frontend /app/THIRD_PARTY_LICENSES.npm /tmp/THIRD_PARTY_LICENSES.npm
RUN GOOS=${TARGETOS} GOARCH=${TARGETARCH} go list -deps -tags prod \
        -f '{{with .Module}}{{if not .Main}}{{.Path}} {{.Version}} {{.Dir}}{{end}}{{end}}' ./cmd/jarvis \
        | sort -u > /tmp/go-modules.txt \
    && sh /tmp/third-party-licenses-go.sh < /tmp/go-modules.txt > /tmp/THIRD_PARTY_LICENSES.go \
    && { printf 'Third-party software included in Jarvis\n\nJarvis itself is licensed under the Apache License 2.0 (see the LICENSE file of the\nproject). It includes the following third-party software, each under its own license.\n\nGo modules\n\n'; \
         cat /tmp/THIRD_PARTY_LICENSES.go; \
         printf '\nnpm packages (bundled into the web UI)\n\n'; \
         cat /tmp/THIRD_PARTY_LICENSES.npm; } > /THIRD_PARTY_LICENSES

# Stage 3: Final (minimal, non-root)
FROM gcr.io/distroless/static-debian12@sha256:d75cdd72874d4790092fcb1b058493ecf6bb5bf2b2b897045b00ff01d91843f2
USER nonroot:nonroot
COPY --from=backend /jarvis /jarvis
COPY --from=backend /THIRD_PARTY_LICENSES /THIRD_PARTY_LICENSES
ENTRYPOINT ["/jarvis"]
