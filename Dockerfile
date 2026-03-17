FROM node:20

# 1. Instala dependências do Chromium/Puppeteer
RUN apt-get update && apt-get install -y \
    gconf-service \
    libasound2 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc1 \
    libgconf-2-4 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    ca-certificates \
    fonts-liberation \
    libnss3 \
    lsb-release \
    xdg-utils \
    wget \
    chromium \
    # Limpa o cache do apt-get para deixar a imagem Docker mais leve
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 2. Configura variáveis de ambiente para o Puppeteer
# Isso diz ao npm install para não baixar uma versão extra do Chromium e usar a do sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Configura o fuso horário (muito importante para sistemas médicos/agendamentos)
ENV TZ=America/Sao_Paulo

WORKDIR /app

# 3. Copia apenas os arquivos de dependência primeiro
COPY package*.json ./

# 4. Instala as dependências
RUN npm install

# 5. Copia o resto do código
COPY . .

EXPOSE 3002

CMD ["npm", "start"]