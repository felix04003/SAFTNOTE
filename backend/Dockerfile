FROM node:20-alpine

# Dépendances système pour Puppeteer (génération PDF)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto

# Dire à Puppeteer d'utiliser Chromium installé
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Donner la propriété du répertoire à l'utilisateur node
RUN chown -R node:node /app

# Copier les dépendances d'abord (cache Docker)
COPY --chown=node:node package*.json ./
RUN npm ci --only=production

# Copier le code source
COPY --chown=node:node src/ ./src/
# Les migrations vivent à la racine du dépôt (migrations/) et ne sont donc pas
# copiables depuis ce contexte de build (./backend). Le passage du contexte à la
# racine du dépôt + `COPY migrations ./migrations` est traité au lot F.

# Ne pas tourner en root
USER node

EXPOSE 3000

CMD ["node", "src/app.js"]
