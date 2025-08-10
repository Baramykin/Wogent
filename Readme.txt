Перезапуск:
docker-compose down && docker-compose build && docker-compose up -d

docker-compose down
docker-compose build --no-cache
docker-compose up -d

==================  ОТЧИСТКА V20 ======================



docker-compose down
docker system prune --volumes --all
docker system prune -a


==================  СБОРКА и ЗАПУСК V20 ===============
docker-compose build --no-cache  == без кеша

docker-compose up --build -d
docker-compose ps

            Убедитесь, что образ создался:
docker-compose ps

docker images
  
            Посмотрите логи:
docker compose logs -f


==================  АРХИВ / ВОССТАНОВЛЕНИЕ ======================
./backup.sh 

./restore.sh

      Удаление:
sudo rm ~/whatsapp-project/backups/*.tar.gz


===================  nginx восстановление после переустаноски VPS

sudo apt-get install snapd
sudo snap install core; sudo snap refresh core
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot

sudo certbot --nginx

sudo nano /etc/nginx/sites-available/wogent.com
# ===================================================================
#  Конфигурационный файл Nginx для wogent.com
# ===================================================================

# Серверный блок для порта 80 (HTTP)
# Его единственная задача - перенаправлять весь трафик на HTTPS.
server {
    listen 80;
    listen [::]:80; # Для поддержки IPv6

    # Указываем домены, на которые будет отвечать этот блок.
    # Рекомендуется указывать и с www, и без.
    server_name wogent.com www.wogent.com;

    # Перенаправляем весь HTTP трафик на HTTPS с кодом 301 (постоянный редирект)
    return 301 https://$host$request_uri;
}

# Основной серверный блок для порта 443 (HTTPS)
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2; # Для поддержки IPv6 и HTTP/2

    server_name wogent.com www.wogent.com;

    # --- ПУТИ К ВАШИМ SSL СЕРТИФИКАТАМ ---
    # Это стандартные пути, которые использует Certbot.
    # Если вы получали сертификат другим способом, укажите правильные пути.
    ssl_certificate /etc/letsencrypt/live/wogent.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/wogent.com/privkey.pem;

    # --- НАСТРОЙКИ SSL ДЛЯ ПОВЫШЕНИЯ БЕЗОПАСНОСТИ ---
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers 'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256';
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # Директива `location` для всех запросов к вашему домену
    location / {
        # --- НАСТРОЙКИ ОБРАТНОГО ПРОКСИ ---
        
        # Перенаправляем запрос на наше Node.js приложение, работающее на порту 3000
        # Важно, что мы используем 127.0.0.1 (localhost)
        proxy_pass http://127.0.0.1:3000;

        # Важные заголовки, чтобы наше приложение знало об оригинальном запросе
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # --- НАСТРОЙКИ ДЛЯ ПОДДЕРЖКИ WEBSOCKET (необходимо для Socket.IO) ---
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400; # Увеличиваем таймаут для долгих соединений
    }
}

sudo rm /etc/nginx/sites-enabled/default
sudo ln -s /etc/nginx/sites-available/wogent.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
https://wogent.com

=======================================
+++
from g4f.client import Client
import g4f
import os, datetime
import time

promt = "Пожалуйста посмотри эту переписку и сделай короткий вывод что в итоге. Если человек интересуется обучением, то напиши новое сообщение для него чтоб возобновить беседу. Пишина русском языке. Пиши Здравствуйте, не пиши имя и не используй имя в переписке. Не делай оценочные суждения. Пред новым сообщением сделай строку с символами +++, так я буду знать где новое сообщение."

client = Client()

response = client.chat.completions.create(
    provider=g4f.Provider.Blackbox,
    model="gpt-4",
    messages=[
        {"role": "user", "content": promt}
    ],
    web_search=False
)

result = response.choices[0].message.content

print(result)
print("THE END")



