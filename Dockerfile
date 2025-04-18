# Usa Node.js 16 en variante slim para reducir tamaño
FROM node:16-slim

# Instala Chromium y librerías necesarias para Puppeteer (whatsapp-web.js)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      chromium \
      libnss3 \
      libx11-xcb1 \
      libxcomposite1 \
      libxcursor1 \
      libxdamage1 \
      libxfixes3 \
      libxi6 \
      libxrandr2 \
      libxss1 \
      libxtst6 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libcups2 \
      libdrm2 \
      libgbm1 \
      libgtk-3-0 \
      libasound2 \
      ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Directorio de trabajo dentro del contenedor
WORKDIR /app

# Copia y instala solo dependencias de producción
COPY package*.json ./
RUN npm install --production

# Copia el resto del código de tu proyecto
COPY . .

# Indica a Puppeteer que use el Chromium instalado
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Monta la carpeta de sesión para LocalAuth (persistencia de QR)
VOLUME ["/app/.wwebjs_auth"]

# Comando por defecto al iniciar el contenedor
CMD ["node", "index.js"]
