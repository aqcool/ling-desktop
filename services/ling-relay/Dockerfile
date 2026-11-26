FROM golang:1.23-alpine AS builder
WORKDIR /src
COPY go.mod main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ling-relay .

FROM scratch
COPY --from=builder /out/ling-relay /ling-relay
EXPOSE 8787
ENTRYPOINT ["/ling-relay"]
