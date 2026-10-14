FROM node:24-bookworm-slim

ARG BASE_REVISION=99ca88641a0db6b38432016dc896d70e24ea9c3a
ADD https://github.com/123114-robot/stay-dark-factory-submission/archive/${BASE_REVISION}.tar.gz /tmp/source.tar.gz
RUN mkdir -p /workspace && tar -xzf /tmp/source.tar.gz -C /workspace --strip-components=1 \
    && rm /tmp/source.tar.gz
WORKDIR /workspace/stage-3
COPY . .

ENV PORT=8080
ENV TABLEKEEPER_DB=/data/tablekeeper.db
RUN mkdir -p /data && chown -R node:node /workspace /data
USER node
EXPOSE 8080
CMD ["node", "src/server.ts"]
