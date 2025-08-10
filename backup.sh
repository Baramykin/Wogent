#!/bin/bash

# --- НАСТРОЙКИ ---
DOCKER_VOLUME_NAME="whatsapp-project-data"
BACKUP_DIR_NAME="backups"
# --- КОНЕЦ НАСТРОЙКИ ---

set -e 
PROJECT_DIR=$(dirname "$(realpath "$0")")
BACKUP_DIR="${PROJECT_DIR}/${BACKUP_DIR_NAME}"

echo "============================================="
echo "Запуск раздельного резервного копирования..."
echo "============================================="
mkdir -p $BACKUP_DIR
echo "Бэкапы будут сохранены в: $BACKUP_DIR"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")

# --- ЭТАП 1: Архивирование кода проекта ---
PROJECT_BACKUP_FILE_PATH="${BACKUP_DIR}/project_backup_${TIMESTAMP}.tar.gz"
echo -e "\nШаг 1: Создание архива кода проекта..."
tar -czf "$PROJECT_BACKUP_FILE_PATH" -C "$PROJECT_DIR" \
    --exclude=".git" \
    --exclude="$BACKUP_DIR_NAME" \
    --exclude="__pycache__" \
    --exclude="*.pyc" \
    .
echo "✅ Архив кода создан: $PROJECT_BACKUP_FILE_PATH"

# --- ЭТАП 2: Архивирование данных пользователей ---
DATA_BACKUP_FILE_PATH="${BACKUP_DIR}/data_backup_${TIMESTAMP}.tar.gz"
echo -e "\nШаг 2: Создание архива данных из тома '$DOCKER_VOLUME_NAME'..."
echo "   -> Остановка сервисов для обеспечения целостности данных..."
(cd "$PROJECT_DIR" && docker-compose stop)

echo "   -> Архивирование данных..."
docker run --rm \
  -v "$DOCKER_VOLUME_NAME":/data_volume \
  -v "$BACKUP_DIR":/backup_target \
  alpine tar -czf "/backup_target/data_backup_${TIMESTAMP}.tar.gz" -C /data_volume .

echo "   -> Запуск сервисов..."
(cd "$PROJECT_DIR" && docker-compose start)
echo "✅ Архив данных создан: $DATA_BACKUP_FILE_PATH"
echo "✅ Сервисы запущены."

echo "============================================="
echo "РЕЗЕРВНОЕ КОПИРОВАНИЕ УСПЕШНО ЗАВЕРШЕНО!"
echo "============================================="