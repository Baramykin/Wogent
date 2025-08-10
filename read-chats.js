// read-chats.js

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const whatsappManager = require('./whatsapp-manager.js');

function transliterate(text) {
    const rus = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя .,()';
    const eng = 'abvgdeejzijklmnoprstufhzcss_y_eua____';
    return text.toLowerCase().split('').map(char => {
        const index = rus.indexOf(char);
        return index >= 0 ? eng[index] : (char.match(/[a-z0-9]/) ? char : '_');
    }).join('');
}

async function processChatReading(userId, username, contactsFileName, socket) {
    const client = whatsappManager.getClient(userId);
    if (!client) {
        socket.emit('log', '❌ Ошибка: Активная сессия WhatsApp не найдена. Пожалуйста, переподключитесь.');
        return;
    }

    const userDir = path.join(__dirname, 'data', `user-${userId}`);
    const contactsFilePath = path.join(userDir, 'contacts', contactsFileName);
    const chatsOutputDir = path.join(userDir, 'chats');
    
    if (!fs.existsSync(chatsOutputDir)) {
        fs.mkdirSync(chatsOutputDir);
    }

    try {
        const lines = fs.readFileSync(contactsFilePath, 'utf8').split('\n').filter(Boolean);
        socket.emit('log', `Найдено ${lines.length} контактов в файле. Начинаем обработку...`);

        const now = new Date();
        const formattedDateTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
        const tempChatDirName = `chats_${formattedDateTime}`;
        const tempChatDirPath = path.join(chatsOutputDir, tempChatDirName);
        if (!fs.existsSync(tempChatDirPath)) {
            fs.mkdirSync(tempChatDirPath);
        }

        let counter = 0;
        for (const line of lines) {
            const number = line.split(',')[1]?.trim();
            if (!number) continue;

            const chatId = `${number}@c.us`;
            counter++;

            try {
                const chat = await client.getChatById(chatId);
                const messages = await chat.fetchMessages({ limit: 100 });

                const contact = await chat.getContact();
                const contactName = contact.pushname || contact.name || 'Без_имени';
                const safeFileName = `${counter}_${number}_${transliterate(contactName)}.txt`;
                const chatFileName = path.join(tempChatDirPath, safeFileName);
                
                let chatContent = `Номер: ${number}\nИмя: ${contactName}\n==================================================\n\n`;
                
                for (const msg of messages) {
                    const sender = msg.fromMe ? 'Вы' : contactName;
                    const timestamp = new Date(msg.timestamp * 1000).toLocaleString('ru-RU');
                    chatContent += `[${timestamp}] ${sender}: ${msg.body}\n`;
                }

                fs.writeFileSync(chatFileName, chatContent, 'utf8');
                socket.emit('log', `[${counter}/${lines.length}] ✅ Чат с ${contactName} (${number}) сохранен.`);

            } catch (err) {
                socket.emit('log', `[${counter}/${lines.length}] ❌ Ошибка с чатом ${number}: Не удалось получить сообщения.`);
                console.error(`Ошибка при получении чата ${number} для пользователя ${userId}:`, err.message);
            }
        }

        socket.emit('log', 'Архивируем результаты...');
        const zipFileName = `${tempChatDirName}.zip`;
        const zipFilePath = path.join(chatsOutputDir, zipFileName);
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
            socket.emit('log', `✅ Архивирование завершено! Файл готов к скачиванию.`);
            socket.emit('chats_done', { zipFileName });
            
            // --- КЛЮЧЕВОЕ ИЗМЕНЕНИЕ ---
            // Мы больше НЕ удаляем папку с текстовыми файлами.
            // fs.rm(tempChatDirPath, { recursive: true, force: true }, () => {}); // <--- СТРОКА УДАЛЕНА/ЗАКОММЕНТИРОВАНА
        });

        archive.on('error', (err) => { throw err; });
        archive.pipe(output);
        archive.directory(tempChatDirPath, false);
        archive.finalize();

    } catch (err) {
        socket.emit('log', '❌ Критическая ошибка в процессе чтения чатов.');
        console.error(`Критическая ошибка чтения чатов для пользователя ${userId}:`, err);
    }
}

module.exports = { processChatReading };