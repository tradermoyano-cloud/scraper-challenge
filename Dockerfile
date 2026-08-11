# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN mkdir -p /app/output

CMD ["npm", "run", "scrape", "--", "--site", "oefa", "--max-pages", "1", "--max-docs", "2"]
