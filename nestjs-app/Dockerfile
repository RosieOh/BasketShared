# syntax=docker/dockerfile:1
# =============================================================================
# Multi-stage build for the NestJS orchestrator.
#   - deps:    install ALL deps (needed to compile)
#   - build:   compile TypeScript -> dist
#   - production: slim runtime image with prod deps only + non-root user
# =============================================================================

# ---------- deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- production ----------
FROM node:20-alpine AS production
ENV NODE_ENV=production
WORKDIR /app

# Install only production dependencies.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled output + the entrypoint.
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Run as the built-in unprivileged `node` user.
USER node

EXPOSE 3000

# Entrypoint runs DB migrations, then launches the app.
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
