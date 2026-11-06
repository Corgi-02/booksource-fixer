FROM node:24-alpine AS frontend
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS backend
ARG TARGETOS=linux
ARG TARGETARCH=amd64
WORKDIR /src
COPY go.mod ./
COPY server ./server
COPY --from=frontend /src/server/web ./server/web
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /booksource-fixer ./server

FROM scratch
COPY --from=backend /booksource-fixer /booksource-fixer
COPY licenses /licenses
COPY THIRD_PARTY_NOTICES.md /licenses/THIRD_PARTY_NOTICES.md
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/booksource-fixer"]
CMD ["--host","0.0.0.0","--port","8080","--no-open"]
