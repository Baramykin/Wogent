# Используем официальный образ Node.js 18. bullseye - это стабильный релиз Debian.
# Slim-версия меньше по размеру, но может не содержать некоторых утилит.
FROM node:18-bullseye-slim

# Устанавливаем системные зависимости, необходимые для Puppeteer.
# ДОБАВЛЕНЫ: libgbm-dev, libdrm2
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc1 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
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
    lsb-release \
    wget \
    xdg-utils \
    # --- НОВЫЕ БИБЛИОТЕКИ ---
    libgbm-dev \
    libdrm2 \
    sqlite3 \
    # -----------------------
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Устанавливаем рабочую директорию внутри контейнера
WORKDIR /app

# Копируем package.json и package-lock.json для кэширования зависимостей
COPY package*.json ./

# Устанавливаем зависимости.
# Puppeteer сам скачает нужную версию Chromium во время этого шага.
RUN npm install

# Копируем остальные файлы приложения
COPY . .

# Определяем тома для хранения данных сессий
VOLUME /app/data
VOLUME /app/.wwebjs_auth

# Открываем порт, на котором работает приложение
EXPOSE 3000

# Команда для запуска приложения.
CMD [ "node", "server.js" ]