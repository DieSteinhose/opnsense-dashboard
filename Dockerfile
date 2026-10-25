# Plain Alpine with the distro Node.js (22.x, includes node:sqlite). No npm dependencies needed.
FROM alpine:3.22

RUN apk add --no-cache nodejs tzdata \
 && addgroup -S -g 1000 app \
 && adduser -S -D -H -u 1000 -G app app \
 && mkdir -p /data \
 && chown app:app /data

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080 \
    LANGUAGE=de \
    TZ=Europe/Berlin

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY config ./config
COPY scripts ./scripts

VOLUME /data
EXPOSE 8080
USER app
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8080/api/meta >/dev/null || exit 1
CMD ["node", "--no-warnings=ExperimentalWarning", "server/index.js"]
