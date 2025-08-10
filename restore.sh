#!/bin/bash

# --- НАСТРОЙКИ ---
# Имя тома Docker, куда будут восстановлены данные
DOCKER_VOLUME_NAME="whatsapp-project_whatsapp_data"

# Путь к директории с бэкапами
BACKUP_DIR="/root/whatsapp-project/backups"
# --- КОНЕЦ НАСТРОЙКИ ---

# Прерывать выполнение при любой ошибке
set -e 

echo "============================================="
echo "Запуск скрипта восстановления ДАННЫХ ПОЛЬЗОВАТЕЛЕЙ..."
echo "============================================="

# --- ЭТАП 1: Поиск самого свежего файла бэкапа данных ---
echo "Шаг 1: Поиск последнего файла бэкапа данных в '$BACKUP_DIR'..."

LATEST_BACKUP_FILE=$(ls -1t ${BACKUP_DIR}/data_backup_*.tar.gz 2>/dev/null | head -n 1)

if [ -z "$LATEST_BACKUP_FILE" ]; then
    echo "Ошибка: Не найдено файлов бэкапа данных (data_backup_*.tar.gz) в директории ${BACKUP_DIR}"
    exit 1
fi

echo "Найден самый свежий бэкап: $(basename $LATEST_BACKUP_FILE)"

# --- ПОДТВЕРЖДЕНИЕ ---
echo ""
echo "ВНИМАНИЕ! Содержимое Docker-тома '$DOCKER_VOLUME_NAME' будет ПОЛНОСТЬЮ ПЕРЕЗАПИСАНО данными из этого архива."
echo ""
read -p "Вы уверены, что хотите продолжить? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Восстановление отменено."
    exit 0
fi
echo "============================================="

# --- ЭТАП 2: Восстановление данных в Docker-том ---
echo "Шаг 2: Восстановление данных в Docker-том '$DOCKER_VOLUME_NAME'..."

echo "   -> Остановка сервисов..."
# Выполняем docker-compose из директории, где лежит скрипт
(cd "$(dirname "$0")" && docker-compose stop)

echo "   -> Проверка и создание тома, если он не существует..."
docker volume inspect $DOCKER_VOLUME_NAME > /dev/null 2>&1 || docker volume create $DOCKER_VOLUME_NAME

echo "   -> Очистка тома от старых данных..."
docker run --rm -v $DOCKER_VOLUME_NAME:/data_volume alpine sh -c "rm -rf /data_volume/*"

echo "   -> Распаковка архива данных в том..."
docker run --rm \
  -v $DOCKER_VOLUME_NAME:/data_volume \
  -v "$(dirname "$LATEST_BACKUP_FILE")":/backup_source \
  alpine sh -c "tar -xzvf /backup_source/$(basename "$LATEST_BACKUP_FILE") -C /data_volume"
  
echo "✅ Данные тома успешно восстановлены."

echo "   -> Запуск сервисов..."
(cd "$(dirname "$0")" && docker-compose start)
echo "✅ Сервисы запущены."

echo "============================================="
echo "ВОССТАНОВЛЕНИЕ ДАННЫХ УСПЕШНО ЗАВЕРШЕНО!"
echo "============================================="
echo -e "\nНажмите Enter для выхода..."
read