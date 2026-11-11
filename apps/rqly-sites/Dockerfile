FROM docker.io/library/node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node server.mjs site-status.mjs content-portability.mjs export-content.mjs markdown-renderer.mjs organization-store.mjs content-history.mjs personal-ai.mjs ai-site-tools.mjs mailbox-store.mjs island-store.mjs admin-auth.mjs admin-mfa.mjs admin-account.mjs editor-drafts.mjs media-store.mjs withdrawn-images.mjs ./
COPY --chown=node:node public ./public
COPY --chown=node:node content ./content
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV NODE_ENV=production PORT=8080 DATA_DIR=/app/data
EXPOSE 8080
CMD ["node","server.mjs"]
