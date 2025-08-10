# analyze_contacts.py

import os
import glob
import sys
import time
import zipfile
import shutil
from g4f.client import Client
import g4f

# --- НАСТРОЙКА ---
SHARED_DATA_PATH = '/shared_data'
# --- КОНЕЦ НАСТРОЙКИ ---

def find_latest_chats_dir(user_id):
    """Находит самую свежую папку с чатами для пользователя."""
    chats_dir = os.path.join(SHARED_DATA_PATH, f'user-{user_id}', 'chats')
    
    if not os.path.isdir(chats_dir):
        print(f"Ошибка: Директория с чатами не найдена: {chats_dir}")
        return None
        
    all_subdirs = [d for d in glob.glob(os.path.join(chats_dir, 'chats_*')) if os.path.isdir(d)]
    
    if not all_subdirs:
        print(f"Ошибка: Не найдено папок с результатами чтения чатов в {chats_dir}")
        return None
        
    latest_dir = max(all_subdirs, key=os.path.getctime)
    return latest_dir

def analyze_chats(chats_dir):
    """Основная логика анализа чатов в директории."""
    print(f"\n--- Начинаю анализ чатов из директории: {os.path.basename(chats_dir)} ---\n")
    
    chat_files = glob.glob(os.path.join(chats_dir, '*.txt'))
    if not chat_files:
        print("В директории нет файлов с чатами для анализа.")
        return

    analysis_results_dir = os.path.join(chats_dir, 'analysis_results')
    os.makedirs(analysis_results_dir, exist_ok=True)
    
    client = Client()
    total_files = len(chat_files)
    
    for i, file_path in enumerate(chat_files):
        filename = os.path.basename(file_path)
        print(f"[{i+1}/{total_files}] Анализирую файл: {filename}...")
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                chat_content = f.read()

            prompt = f"""
Пожалуйста, внимательно проанализируй следующую переписку.
Твоя задача - сделать короткий вывод (одно-два предложения) о сути разговора.
Если в переписке человек проявлял интерес к обучению или подобным услугам, но разговор не был завершен, составь короткое и вежливое сообщение, чтобы возобновить диалог.
Не используй имя собеседника, обращайся на "Вы" с большой буквы.
Перед новым сообщением для клиента поставь разделитель: +++

Вот переписка:
{chat_content}
"""
            print(f"Отправляю промт на анализ: {prompt}...")
            response = client.chat.completions.create(
                # provider=g4f.Provider.Grok, 
                model="gpt-4",
                messages=[{"role": "user", "content": prompt}],
                web_search=False
            )
            result = response.choices[0].message.content
            print(f"Ответ получен: {result}...")
            
            result_filename = os.path.join(analysis_results_dir, f"analysis_{filename}")
            with open(result_filename, 'w', encoding='utf-8') as rf:
                rf.write(result)

            print(f" -> ✅ Анализ для {filename} сохранен.")
            time.sleep(2) 

        except Exception as e:
            print(f" -> ❌ Ошибка при анализе файла {filename}: {e}")
            error_filename = os.path.join(analysis_results_dir, f"error_{filename}")
            with open(error_filename, 'w', encoding='utf-8') as ef:
                ef.write(f"Произошла ошибка при анализе файла:\n{e}")

    print(f"\n--- Анализ {total_files} чатов завершен. Упаковка результатов... ---")

    # --- НОВОЕ: Упаковка результатов в ZIP-архив ---
    zip_filename = f"analysis_results_{os.path.basename(chats_dir)}.zip"
    zip_filepath = os.path.join(chats_dir, zip_filename)
    
    with zipfile.ZipFile(zip_filepath, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, _, files in os.walk(analysis_results_dir):
            for file in files:
                # Добавляем файл в архив, сохраняя структуру папок
                zipf.write(os.path.join(root, file), 
                           os.path.relpath(os.path.join(root, file), 
                                           analysis_results_dir))
    
    print(f"Результаты упакованы в: {zip_filename}")
    
    # Выводим специальный JSON в конце, чтобы Node.js мог его перехватить
    print(f'ANALYSIS_COMPLETE_JSON:{{"zipFileName":"{zip_filename}"}}')


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Ошибка: Не указан ID пользователя.")
        sys.exit(1)
        
    USER_ID = sys.argv[1]
    print(f"Получен запрос на анализ для пользователя с ID: {USER_ID}")

    latest_chats_directory = find_latest_chats_dir(USER_ID)
    
    if latest_chats_directory:
        analyze_chats(latest_chats_directory)