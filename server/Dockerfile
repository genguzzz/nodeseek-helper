# NodeSeek 助手 · 自建同步服务
FROM --platform=$BUILDPLATFORM golang:1.24-alpine AS build
ARG TARGETOS TARGETARCH TARGETVARIANT VERSION=dev
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN GOARM=${TARGETVARIANT#v} CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/nsh-sync-server . \
 && mkdir -p /out/data && chown 65532:65532 /out/data

FROM scratch
COPY --from=build /out/nsh-sync-server /nsh-sync-server
COPY --from=build --chown=65532:65532 /out/data /data
ENV NSH_ADDR=:8787 NSH_DATA=/data
VOLUME /data
EXPOSE 8787
USER 65532:65532
ENTRYPOINT ["/nsh-sync-server"]
