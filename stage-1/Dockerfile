FROM node:24-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src

ENV PORT=8080
ENV TABLEKEEPER_DB=/data/tablekeeper.db
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 8080
CMD ["npm", "start"]
