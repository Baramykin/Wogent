// logger.js

const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, 'data', 'logs');

/**
 * Записывает действие пользователя в файл лога.
 * @param {object} logData - Данные для лога.
 */
function logAction(logData) {
    // Отладочное сообщение, чтобы видеть, что функция вызывается
    console.log(`[Logger] Writing action: ${logData.action} for user: ${logData.username}`);

    const logEntry = {
        timestamp: new Date().toISOString(),
        ...logData,
    };

    const logLine = JSON.stringify(logEntry) + '\n';

    const date = new Date();
    const fileName = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.log`;
    const filePath = path.join(logsDir, fileName);

    fs.appendFile(filePath, logLine, (err) => {
        if (err) {
            console.error('CRITICAL: Failed to write to log file:', err);
        }
    });
}

module.exports = { logAction };