FROM node:24-bookworm-slim
WORKDIR /opt/duji
COPY *.mjs *.cjs ./
COPY web ./web
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production
CMD ["node", "server.mjs"]
