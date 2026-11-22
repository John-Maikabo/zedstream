# ZedStream / WebRTC server
# Node + Express + ws. No native build steps required.

FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first so the layer is cached between deploys
COPY package.json package-lock.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Application code (public/, lib/, server.js)
COPY . .

# Render provides PORT at runtime; 3000 is the local default
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
