# Plain Alpine with the distro Node.js (24.x LTS, includes node:sqlite). No npm dependencies needed.
FROM alpine:3.24

RUN apk add --no-cache nodejs tzdata su-exec \
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
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

VOLUME /data
EXPOSE 8080
# no USER here: the entrypoint fixes /data ownership as root, then drops to PUID:PGID
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8080/api/meta >/dev/null || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--no-warnings=ExperimentalWarning", "server/index.js"]
