// database.js
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Создаем директорию для данных, если ее нет
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

const DBSOURCE = path.join(dataDir, "db.sqlite");

const db = new sqlite3.Database(DBSOURCE, (err) => {
    if (err) {
      console.error(err.message);
      throw err;
    } else {
        console.log('Подключено к базе данных SQLite.');
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
        )`, (err) => {
            if (err) {
                // Таблица уже создана
            } else {
                console.log('Таблица пользователей успешно создана.');
            }
        });
    }
});

module.exports = db;