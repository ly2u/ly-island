FROM node:24-alpine AS build
WORKDIR /apps/ly-island-preview
COPY apps/ly-island-preview/package*.json ./
RUN npm ci --no-audit --no-fund
COPY apps/ly-island-preview/ ./
# The frontend imports the shared, dependency-free search/organization helpers.
COPY apps/rqly-sites/public/rqly/search-core.mjs apps/rqly-sites/public/rqly/organization-core.mjs /apps/rqly-sites/public/rqly/
RUN npm run build
FROM caddy:2-alpine
COPY --from=build /apps/ly-island-preview/dist /srv/island
COPY deploy/Caddyfile.review /etc/caddy/Caddyfile
