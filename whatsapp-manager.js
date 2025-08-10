// whatsapp-manager.js

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const sessions = {};

const ensureUserDirectories = (userId) => {
    const userDir = path.join(__dirname, 'data', `user-${userId}`);
    const sessionDir = path.join(userDir, 'session');
    const contactsDir = path.join(userDir, 'contacts');
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir);
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir);
    if (!fs.existsSync(contactsDir)) fs.mkdirSync(contactsDir);
    return { sessionDir, contactsDir };
};

const createSession = (userId, username, socket) => {
    if (sessions[userId]) {
        socket.emit('log', '❗️ Сессия уже запущена.');
        return false;
    }
    console.log(`[WhatsApp Manager] Создание сессии для пользователя ${username}...`);
    const { sessionDir } = ensureUserDirectories(userId);
    const client = new Client({
        authStrategy: new LocalAuth({ dataPath: sessionDir }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        }
    });

    sessions[userId] = { client, socket };

    client.on('qr', async (qr) => {
        console.log(`[User: ${username}] QR-код получен.`);
        try {
            const qrImageUrl = await qrcode.toDataURL(qr);
            socket.emit('qr', qrImageUrl);
            socket.emit('log', '📲 Отсканируйте QR-код для входа.');
        } catch (err) {
            console.error(`[User: ${username}] Ошибка генерации QR:`, err);
        }
    });

    client.on('ready', () => {
        console.log(`[User: ${username}] Клиент готов!`);
        socket.emit('log', '✅ Клиент готов! Нажмите кнопку для экспорта.');
        socket.emit('ready');
    });

    client.on('auth_failure', (msg) => {
        socket.emit('log', `❌ Ошибка аутентификации: ${msg}`);
        destroySession(userId);
    });

    client.on('disconnected', (reason) => {
        socket.emit('log', `Сессия была отключена: ${reason}`);
    });

    client.initialize().catch(err => {
        console.error(`[User: ${username}] Критическая ошибка инициализации:`, err);
        socket.emit('log', `❌ Критическая ошибка при запуске. Попробуйте еще раз.`);
        destroySession(userId);
    });
    return true;
};

const exportContacts = async (userId, username, socket) => {
    const session = sessions[userId];
    if (!session || !session.client) {
        socket.emit('log', '❌ Ошибка: сессия не найдена для экспорта.');
        return;
    }
    try {
        const { contactsDir } = ensureUserDirectories(userId);
        const formattedDateTime = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `contacts_user-${userId}_${formattedDateTime}.txt`;
        const filePath = path.join(contactsDir, fileName);
        fs.writeFileSync(filePath, '', 'utf8');
        const chats = await session.client.getChats();
        let counter = 0;
        for (const chat of chats) {
            if (!chat.isGroup) {
                const contact = await chat.getContact();
                const name = contact.pushname || contact.name || 'Без имени';
                const number = contact.number;
                counter++;
                socket.emit('log', `[${counter}] Найден контакт: ${name}`);
                const line = `${counter}, ${number}, ${name}\n`;
                fs.appendFileSync(filePath, line, 'utf8');
            }
        }
        socket.emit('log', `\n✅ Готово! Найдено ${counter} контактов.`);
        socket.emit('done', { count: counter, fileName: fileName });
    } catch (err) {
        console.error(`[User: ${username}] Ошибка при экспорте контактов:`, err);
        socket.emit('log', `❌ Произошла ошибка во время экспорта контактов.`);
    }
};

const destroySession = (userId) => {
    const sessionData = sessions[userId];
    if (sessionData) {
        const username = sessionData.socket?.request?.session?.user?.username || `User ID ${userId}`;
        console.log(`[WhatsApp Manager] Уничтожение сессии для пользователя ${username}.`);
        delete sessions[userId];
        console.log(`[WhatsApp Manager] Запись о сессии для ${username} удалена.`);
        if (sessionData.client) {
            sessionData.client.destroy().catch(err => {
                console.warn(`[User: ${username}] Предупреждение при уничтожении клиента (destroy): ${err.message}.`);
            });
        }
    }
};

const disconnectSession = (userId) => {
    const sessionData = sessions[userId];
    if (sessionData) {
        const username = sessionData.socket.request.session.user.username;
        console.log(`[WhatsApp Manager] Мягкое отключение для пользователя ${username} (ID: ${userId}).`);
        destroySession(userId);
        console.log(`[WhatsApp Manager] Сессия пользователя ${username} отключена (авторизация сохранена).`);
    }
};

const logoutSession = (userId) => {
    const sessionData = sessions[userId];
    if (sessionData) {
        const username = sessionData.socket.request.session.user.username;
        console.log(`[WhatsApp Manager] Полный выход для пользователя ${username} (ID: ${userId}).`);
        if (sessionData.client) {
            sessionData.client.logout()
                .then(() => { console.log(`[User: ${username}] Успешный logout.`); destroySession(userId); })
                .catch(err => { console.warn(`[User: ${username}] Ошибка при logout: ${err.message}. Все равно уничтожаем.`); destroySession(userId); });
        } else { delete sessions[userId]; }
        console.log(`[WhatsApp Manager] Сессия пользователя ${username} полностью удалена.`);
    }
};

const reconnectSession = (userId, newSocket) => {
    if (sessions[userId]) {
        sessions[userId].socket = newSocket;
        return true;
    }
    return false;
};

const isSessionActive = (userId) => {
    return !!sessions[userId];
};

const getClient = (userId) => {
    return sessions[userId]?.client;
};

module.exports = {
    createSession,
    disconnectSession,
    logoutSession,
    reconnectSession,
    isSessionActive,
    exportContacts,
    getClient
};