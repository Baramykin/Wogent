// server.js

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./database.js');
const bcrypt = require('bcrypt');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const Docker = require('dockerode');
const whatsappManager = require('./whatsapp-manager.js');
const { logAction } = require('./logger.js');
const readChatsManager = require('./read-chats.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const logsDir = path.join(__dirname, 'data', 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    console.log('Log directory created at:', logsDir);
}
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST, port: parseInt(process.env.EMAIL_PORT, 10), secure: process.env.EMAIL_SECURE === 'true',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(helmet({ contentSecurityPolicy: false, crossOriginOpenerPolicy: false, originAgentCluster: false }));
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false, message: 'Слишком много запросов.' });
app.use(limiter);
if (!process.env.SESSION_SECRET) { console.error('SESSION_SECRET не задан!'); process.exit(1); }
const sessionMiddleware = session({
    store: new SQLiteStore({ db: 'sessions.db', dir: './data' }),
    secret: process.env.SESSION_SECRET,
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, secure: true, sameSite: 'lax' }
});
app.use(sessionMiddleware);

function renderPage(req, res, pageName) {
    fs.readFile(path.join(__dirname, pageName), 'utf8', (err, html) => {
        if (err) { console.error(`Ошибка чтения файла ${pageName}:`, err); return res.status(500).send("Ошибка сервера."); }
        const nonce = crypto.randomBytes(16).toString('base64');
        helmet.contentSecurityPolicy({ useDefaults: true, directives: { "script-src": ["'self'", `'nonce-${nonce}'`] }})(req, res, () => {
            let finalHtml = html.replace(/<script/g, `<script nonce="${nonce}"`);
            if (pageName === 'index.html' && req.session.user) {
                const userInfoScript = `<script nonce="${nonce}">window.currentUser = ${JSON.stringify(req.session.user)};</script>`;
                finalHtml = finalHtml.replace('<!-- USER_INFO_SCRIPT_PLACEHOLDER -->', userInfoScript);
            }
            res.send(finalHtml);
        });
    });
}
const isAuthenticated = (req, res, next) => { if (req.session.user) { next(); } else { res.redirect('/login'); }};

app.get('/', isAuthenticated, (req, res) => renderPage(req, res, 'index.html'));
app.get('/login', (req, res) => renderPage(req, res, 'login.html'));
app.get('/register', (req, res) => renderPage(req, res, 'register.html'));
app.get('/forgot-password', (req, res) => renderPage(req, res, 'forgot-password.html'));
app.get('/reset-password/:token', (req, res) => {
    db.get(`SELECT * FROM password_resets WHERE token = ? AND expiresAt > DATETIME('now')`, [req.params.token], (err, row) => {
        if (err || !row) { return res.redirect('/login?error=invalid_token'); }
        renderPage(req, res, 'reset-password.html');
    });
});
app.get('/admin', isAuthenticated, (req, res) => {
    if (req.session.user.id !== 1) { return res.status(403).send('<h1>Доступ запрещен</h1>'); }
    Promise.all([
        new Promise((resolve, reject) => db.get("SELECT COUNT(*) AS totalUsers FROM users", (err, result) => err ? reject(err) : resolve(result))),
        new Promise((resolve, reject) => db.all("SELECT id, username, email FROM users ORDER BY id", (err, result) => err ? reject(err) : resolve(result))),
    ]).then(([total, users]) => {
        const logsDir = path.join(__dirname, 'data', 'logs');
        let logs = [];
        try {
            const files = fs.readdirSync(logsDir).sort().reverse();
            if (files.length > 0) {
                const latestLogFile = path.join(logsDir, files[0]);
                const logContent = fs.readFileSync(latestLogFile, 'utf8');
                logs = logContent.trim().split('\n').slice(-50).reverse().map(line => { try { return JSON.parse(line); } catch { return null; }}).filter(Boolean);
            }
        } catch (err) { console.error("Не удалось прочитать логи:", err); }
        fs.readFile(path.join(__dirname, 'admin.html'), 'utf8', (err, htmlTemplate) => {
            if (err) { return res.status(500).send('Ошибка чтения шаблона.'); }
            const totalUsers = total.totalUsers;
            const userListHtml = users.map(u => `<li>ID: ${u.id} | Имя: ${u.username} | Email: ${u.email || 'Не указан'}</li>`).join('');
            const logsTableHtml = logs.map(l => {
                const timestamp = new Date(l.timestamp).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
                return `<tr><td>${timestamp}</td><td>${l.username || 'N/A'} (${l.userId || 'N/A'})</td><td>${l.action}</td><td>${l.details || ''}</td><td>${l.ip || ''}</td></tr>`
            }).join('');
            let finalHtml = htmlTemplate.replace('{{totalUsers}}', totalUsers).replace('{{userListHtml}}', userListHtml).replace('{{logsTableHtml}}', logsTableHtml);
            res.send(finalHtml);
        });
    }).catch(dbErr => { console.error("Ошибка админ-панели (БД):", dbErr); res.status(500).send('Ошибка базы данных.'); });
});
app.get('/email-changed', (req, res) => res.sendFile(path.join(__dirname, 'email-changed.html')));
app.get('/favicon.ico', (req, res) => res.status(204).send());
app.post('/register', async (req, res) => {
    const { username, password, email, password_confirm } = req.body;
    if (!username || !password || !email || !password_confirm) { return res.redirect('/register?error=missing_fields'); }
    if (password !== password_confirm) { return res.redirect('/register?error=password_mismatch'); }
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run('INSERT INTO users (username, password, email) VALUES (?,?,?)', [username, hashedPassword, email], function(err) {
        if (err) { return res.redirect('/register?error=user_exists'); }
        logAction({ userId: this.lastID, username, action: 'REGISTER', ip: req.ip });
        res.redirect('/login?success=registration_complete');
    });
});
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err || !user || !(await bcrypt.compare(password, user.password))) {
            logAction({ userId: null, username, action: 'LOGIN_FAIL', ip: req.ip });
            return res.redirect('/login?error=invalid_credentials');
        }
        req.session.user = { id: user.id, username: user.username };
        logAction({ userId: user.id, username: user.username, action: 'LOGIN', ip: req.ip });
        res.redirect('/');
    });
});
app.post('/forgot-password', (req, res) => {
    const { email } = req.body;
    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
        if (err || !user) { return res.redirect('/forgot-password?success=link_sent'); }
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 3600000);
        db.run(`INSERT INTO password_resets (userId, token, expiresAt) VALUES (?, ?, ?)`, [user.id, token, expiresAt.toISOString()], async (err) => {
            if (err) { console.error("Ошибка сохранения токена:", err); return res.redirect('/forgot-password?success=link_sent'); }
            const resetLink = `${req.protocol}://${req.get('host')}/reset-password/${token}`;
            const mailOptions = { from: process.env.EMAIL_USER, to: user.email, subject: 'Сброс пароля', html: `<p>Для сброса пароля, пожалуйста, перейдите по <a href="${resetLink}">ссылке</a>. Она действительна 1 час.</p>` };
            try { await transporter.sendMail(mailOptions); } catch (mailError) { console.error("Ошибка отправки письма:", mailError); }
            res.redirect('/forgot-password?success=link_sent');
        });
    });
});
app.post('/reset-password/:token', (req, res) => {
    const { token } = req.params;
    const { password, password_confirm } = req.body;
    if (password !== password_confirm) { return res.redirect(`/reset-password/${token}?error=password_mismatch`); }
    db.get(`SELECT * FROM password_resets WHERE token = ? AND expiresAt > DATETIME('now')`, [token], async (err, row) => {
        if (err || !row) { return res.redirect('/login?error=invalid_token'); }
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, row.userId], (updateErr) => {
            if (updateErr) { return res.redirect(`/reset-password/${token}?error=server_error`); }
            db.run('DELETE FROM password_resets WHERE token = ?', [token]);
            res.redirect('/login?success=password_reset');
        });
    });
});
app.post('/change-password', isAuthenticated, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const userId = req.session.user.id;
    if (!oldPassword || !newPassword) { return res.status(400).json({ success: false, message: 'Все поля должны быть заполнены.' }); }
    db.get('SELECT password FROM users WHERE id = ?', [userId], async (err, user) => {
        if (err || !user) { return res.status(500).json({ success: false, message: 'Ошибка сервера.' }); }
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) { return res.status(401).json({ success: false, message: 'Старый пароль неверен.' }); }
        const newHashedPassword = await bcrypt.hash(newPassword, 10);
        db.run('UPDATE users SET password = ? WHERE id = ?', [newHashedPassword, userId], (updateErr) => {
            if (updateErr) { return res.status(500).json({ success: false, message: 'Не удалось обновить пароль.' }); }
            logAction({ userId, username: req.session.user.username, action: 'PASSWORD_CHANGE', ip: req.ip });
            res.json({ success: true, message: 'Пароль успешно изменен!' });
        });
    });
});
app.post('/change-email', isAuthenticated, async (req, res) => {
    const { newEmail, password } = req.body;
    const userId = req.session.user.id;
    if (!newEmail || !password) { return res.status(400).json({ success: false, message: 'Все поля обязательны.' }); }
    db.get('SELECT * FROM users WHERE id = ?', [userId], async (err, user) => {
        if (err || !user) { return res.status(500).json({ success: false, message: 'Ошибка сервера.' }); }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) { return res.status(401).json({ success: false, message: 'Неверный пароль.' }); }
        db.get('SELECT id FROM users WHERE email = ?', [newEmail], (err, existingUser) => {
            if (existingUser) { return res.status(409).json({ success: false, message: 'Этот email уже используется.' }); }
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 3600000);
            const sql = 'INSERT INTO email_changes (userId, newEmail, token, expiresAt) VALUES (?, ?, ?, ?)';
            db.run(sql, [userId, newEmail, token, expiresAt.toISOString()], async (err) => {
                if (err) { return res.status(500).json({ success: false, message: 'Не удалось создать запрос.' }); }
                const verifyLink = `${req.protocol}://${req.get('host')}/verify-email-change/${token}`;
                logAction({ userId, username: req.session.user.username, action: 'EMAIL_CHANGE_REQUEST', ip: req.ip, details: `New email: ${newEmail}` });
                const mailOptions = { from: process.env.EMAIL_USER, to: newEmail, subject: 'Подтверждение смены Email', html: `<p>Для подтверждения смены email, перейдите по <a href="${verifyLink}">этой ссылке</a>.</p>`};
                try { await transporter.sendMail(mailOptions); res.json({ success: true, message: 'Ссылка для подтверждения отправлена.' }); } catch (mailError) { res.status(500).json({ success: false, message: 'Не удалось отправить письмо.' }); }
            });
        });
    });
});
app.get('/verify-email-change/:token', (req, res) => {
    const { token } = req.params;
    db.get(`SELECT * FROM email_changes WHERE token = ? AND expiresAt > DATETIME('now')`, [token], (err, row) => {
        if (err || !row) { return res.redirect('/login?error=invalid_token'); }
        db.run('UPDATE users SET email = ? WHERE id = ?', [row.newEmail, row.userId], (updateErr) => {
            if (updateErr) { return res.status(500).send('Не удалось обновить email.'); }
            logAction({ userId: row.userId, username: null, action: 'EMAIL_CHANGE_CONFIRM', ip: req.ip, details: `New email: ${row.newEmail}` });
            db.run('DELETE FROM email_changes WHERE userId = ?', [row.userId]);
            res.redirect('/email-changed');
        });
    });
});
app.post('/delete-account', isAuthenticated, async (req, res) => {
    const { password } = req.body;
    const userId = req.session.user.id;
    if (!password) { return res.status(400).json({ success: false, message: 'Пароль обязателен.' }); }
    db.get('SELECT password FROM users WHERE id = ?', [userId], async (err, user) => {
        if (err || !user) { return res.status(500).json({ success: false, message: 'Ошибка сервера.' }); }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) { return res.status(401).json({ success: false, message: 'Неверный пароль.' }); }
        db.run('DELETE FROM users WHERE id = ?', [userId], (deleteErr) => {
            if (deleteErr) { return res.status(500).json({ success: false, message: 'Не удалось удалить пользователя.' }); }
            const userDir = path.join(__dirname, 'data', `user-${userId}`);
            fs.rm(userDir, { recursive: true, force: true }, (fsErr) => {
                if (fsErr) { console.error(`Не удалось удалить папку ${userId}:`, fsErr); }
                logAction({ userId, username: req.session.user.username, action: 'ACCOUNT_DELETE', ip: req.ip });
                req.session.destroy(sessionErr => {
                    if (sessionErr) { return res.status(500).json({ success: false, message: 'Не удалось завершить сессию.' }); }
                    res.json({ success: true, message: 'Аккаунт успешно удален.' });
                });
            });
        });
    });
});
app.post('/logout', (req, res) => {
    if (req.session.user) {
        logAction({ userId: req.session.user.id, username: req.session.user.username, action: 'LOGOUT', ip: req.ip });
        whatsappManager.disconnectSession(req.session.user.id);
    }
    req.session.destroy(() => { res.redirect('/login'); });
});
app.get('/download', isAuthenticated, (req, res) => {
    const requestedFile = path.basename(req.query.file);
    const userId = req.session.user.id;
    if (!requestedFile.includes(`user-${userId}`)) { return res.status(403).send('Доступ запрещен.'); }
    const file = path.join(__dirname, 'data', `user-${userId}`, 'contacts', requestedFile);
    fs.access(file, fs.constants.F_OK, (err) => {
        if (err) { return res.status(404).send('Файл не найден.'); }
        res.download(file);
    });
});
app.get('/download-zip', isAuthenticated, (req, res) => {
    const requestedFile = path.basename(req.query.file);
    const userId = req.session.user.id;
    if (!requestedFile.startsWith('chats_')) { return res.status(403).send('Доступ запрещен.'); }
    const file = path.join(__dirname, 'data', `user-${userId}`, 'chats', requestedFile);
    fs.access(file, fs.constants.F_OK, (err) => {
        if (err) { return res.status(404).send('Файл не найден.'); }
        res.download(file);
    });
});
app.get('/download-analysis-zip', isAuthenticated, (req, res) => {
    const requestedFile = path.basename(req.query.file);
    const userId = req.session.user.id;
    if (!requestedFile.startsWith('analysis_results_')) { return res.status(403).send('Доступ запрещен.'); }
    const chatsDir = path.join(__dirname, 'data', `user-${userId}`, 'chats');
    try {
        const all_subdirs = fs.readdirSync(chatsDir).map(name => path.join(chatsDir, name)).filter(source => fs.lstatSync(source).isDirectory());
        for (const dir of all_subdirs) {
            const file = path.join(dir, requestedFile);
            if (fs.existsSync(file)) {
                return res.download(file);
            }
        }
        return res.status(404).send('Файл не найден.');
    } catch (e) {
        console.error("Ошибка при поиске файла анализа:", e);
        return res.status(500).send('Ошибка при поиске файла.');
    }
});
app.use(express.static(path.join(__dirname)));

io.use((socket, next) => { sessionMiddleware(socket.request, {}, next); });
io.on('connection', (socket) => {
    const session = socket.request.session;
    if (!session || !session.user) { return; }
    const { id: userId, username } = session.user;
    const ip = socket.handshake.headers['x-forwarded-for'] || socket.request.connection.remoteAddress;
    console.log(`[Server] Пользователь ${username} (ID: ${userId}) подключился.`);
    socket.emit('log', `Добро пожаловать, ${username}!`);
    if (whatsappManager.reconnectSession(userId, socket)) { console.log(`[Server] Обнаружена сессия для ${username}. Переподключение.`); socket.emit('log', 'Восстановлена активная сессия.'); socket.emit('ready'); }
    socket.on('start', () => { if (whatsappManager.isSessionActive(userId)) { socket.emit('log', '❗️ Ваша сессия уже запущена.'); return; } whatsappManager.createSession(userId, username, socket); });
    socket.on('export_contacts', () => {
        console.log(`[Server] Запрос на экспорт контактов от ${username}.`);
        logAction({ userId, username, action: 'CONTACTS_EXPORT_START', ip });
        whatsappManager.exportContacts(userId, username, socket);
    });
    socket.on('read_chats', (data) => {
        console.log(`[Server] Запрос на чтение чатов от ${username}. Файл: ${data.fileName}`);
        logAction({ userId, username, action: 'CHATS_READ_START', ip, details: `File: ${data.fileName}` });
        readChatsManager.processChatReading(userId, username, data.fileName, socket);
    });
    socket.on('analyze_contacts', () => {
        logAction({ userId, username, action: 'ANALYSIS_START', ip });
        const analyzerContainerName = 'whatsapp-app-analyzer';
        const command = ['python', 'analyze_contacts.py', String(userId)];
        socket.emit('log', '--- ЗАПУСК АНАЛИЗА ---');
        docker.getContainer(analyzerContainerName).exec({
            Cmd: command, AttachStdout: true, AttachStderr: true
        }, (err, exec) => {
            if (err) { socket.emit('log', '❌ Не удалось запустить контейнер анализатора.'); return console.error(err); }
            exec.start((err, stream) => {
                if (err) { socket.emit('log', '❌ Ошибка при старте процесса анализа.'); return console.error(err); }
                
                let finalZipFileName = '';

                stream.on('data', (chunk) => {
                    const output = chunk.toString('utf8');
                    const lines = output.split('\n').filter(Boolean); // Разделяем на строки, если их несколько
                    for (const line of lines) {
                        if (line.startsWith('ANALYSIS_COMPLETE_JSON:')) {
                            try {
                                const jsonPart = line.replace('ANALYSIS_COMPLETE_JSON:', '');
                                const data = JSON.parse(jsonPart);
                                finalZipFileName = data.zipFileName;
                            } catch (e) {
                                console.error("Ошибка парсинга JSON от анализатора:", e);
                            }
                        } else {
                            socket.emit('log', line);
                        }
                    }
                });

                stream.on('end', () => {
                    socket.emit('log', '--- АНАЛИЗ ЗАВЕРШЕН ---');
                    if (finalZipFileName) {
                        socket.emit('analysis_done', { zipFileName: finalZipFileName });
                    } else {
                        socket.emit('log', '❌ Не удалось получить имя файла с результатами анализа.');
                        socket.emit('analysis_done', { zipFileName: null });
                    }
                });
            });
        });
    });
    socket.on('disconnect_session', () => { logAction({ userId, username, action: 'WHATSAPP_DISCONNECT', ip, details: 'User-initiated soft disconnect' }); console.log(`[Server] Запрос на мягкое отключение от ${username}.`); socket.emit('log', 'Отключаем сессию...'); whatsappManager.disconnectSession(userId); socket.emit('log', 'Сессия отключена.'); });
    socket.on('logout_session', () => { logAction({ userId, username, action: 'WHATSAPP_LOGOUT', ip, details: 'User-initiated full logout' }); console.log(`[Server] Запрос на полный выход от ${username}.`); socket.emit('log', 'Выполняем полный выход...'); whatsappManager.logoutSession(userId); socket.emit('log', 'Сессия полностью завершена.'); });
    socket.on('disconnect', () => { console.log(`[Server] Пользователь ${username} отключился от сокета.`); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Сервер запущен на http://localhost:${PORT}`); });