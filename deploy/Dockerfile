# Optional local review appliance; image build is not needed by Foundry or Node tests.
FROM node:24.21.0-bookworm-slim
WORKDIR /app
COPY server ./server
COPY dist ./dist
COPY scripts/recover.mjs ./scripts/recover.mjs
RUN mkdir /data && chown node:node /data
USER node
ENV DCP_DEMO=1 DCP_ROLE=all DCP_DB=/data/demo.sqlite DCP_BACKUP_DIR=/data/backups DCP_WEB_ROOT=/app/dist HOST=0.0.0.0 PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/api/config').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/src/main.js"]
