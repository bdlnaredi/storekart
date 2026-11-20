FROM node:22-alpine
WORKDIR /app
COPY server.js package.json ./
COPY public ./public
ENV PORT=3080 DATA_DIR=/data NODE_ENV=production
VOLUME /data
EXPOSE 3080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3080/api/health || exit 1
CMD ["node", "server.js"]
