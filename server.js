const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ==================== 数据库配置 ====================
const DB_CONFIG = {
  host: 'localhost',
  user: 'sql_tchat_uuli_top',
  password: '59530f6024c1a',
  database: 'sql_tchat_uuli_top',
  waitForConnections: true,
  connectionLimit: 10,
};
const pool = mysql.createPool(DB_CONFIG);

const rooms = new Map();
const onlineUsers = new Map();
let adminToken = null;

function generateRoomId() { return crypto.randomBytes(8).toString('hex'); }
function generateKey() { return crypto.randomBytes(32).toString('hex'); }
function getClientIp(socket) { return socket.handshake.address || socket.request.connection.remoteAddress; }
function getRandomName() {
  const names = ['星月','云歌','雨桐','风吟','雪舞','花信','竹韵','墨染','青衫','画眉','琴心','剑魄','诗酒','茶香','书韵','棋语','逸尘','流萤','晚晴','初阳','听雨','观云','踏雪','寻梅'];
  return names[Math.floor(Math.random() * names.length)] + Math.floor(Math.random() * 100);
}

(async () => {
  try {
    const [adminTable] = await pool.query("SHOW TABLES LIKE 'admins'");
    if (adminTable.length === 0) {
      await pool.query(`
        CREATE TABLE admins (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(50) NOT NULL UNIQUE,
          password_hash VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
      const defaultHash = bcrypt.hashSync('123456', 10);
      await pool.query("INSERT INTO admins (username, password_hash) VALUES ('admin', ?)", [defaultHash]);
      console.log('✅ 已创建默认管理员 admin / 123456');
    }
    const [settingsTable] = await pool.query("SHOW TABLES LIKE 'settings'");
    if (settingsTable.length === 0) {
      await pool.query(`
        CREATE TABLE settings (
          \`key\` VARCHAR(50) PRIMARY KEY,
          \`value\` VARCHAR(255) NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
      const randomSuffix = crypto.randomBytes(6).toString('hex');
      await pool.query("INSERT INTO settings (`key`, `value`) VALUES ('admin_path', ?)", ['/admin-' + randomSuffix]);
      console.log('✅ 已创建 settings 表，后台路径已随机生成');
    }
  } catch (err) {
    console.error('数据库初始化失败:', err);
  }
})();

async function getAdminPath() {
  try {
    const [rows] = await pool.query("SELECT `value` FROM settings WHERE `key` = 'admin_path'");
    return rows.length ? rows[0].value : '/admin';
  } catch { return '/admin'; }
}

app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: '登录失败' });
  try {
    const [rows] = await pool.query('SELECT password_hash FROM admins WHERE username = ?', [username]);
    if (rows.length === 0) return res.status(401).json({ success: false, message: '登录失败' });
    const match = bcrypt.compareSync(password, rows[0].password_hash);
    if (!match) return res.status(401).json({ success: false, message: '登录失败' });
    const token = crypto.randomBytes(32).toString('hex');
    adminToken = token;
    setTimeout(() => { adminToken = null; }, 60 * 60 * 1000);
    res.json({ success: true, token });
  } catch (err) {
    console.error('登录错误:', err);
    res.status(500).json({ success: false, message: '登录失败' });
  }
});

function checkAdminToken(req, res, next) {
  const token = req.headers['authorization'];
  if (!token || token !== `Bearer ${adminToken}`) {
    return res.status(401).json({ success: false, message: '未授权' });
  }
  next();
}

app.get('/api/admin/stats', checkAdminToken, (req, res) => {
  const roomList = [];
  for (const [roomId, room] of rooms) {
    const users = Array.from(room.users.keys());
    roomList.push({
      roomId,
      creator: room.creator || '未知',
      userCount: users.length,
      users: users,
      messageCount: room.messages.length,
    });
  }
  res.json({ success: true, onlineCount: onlineUsers.size, rooms: roomList });
});

app.get('/api/admin/room/:roomId/messages', checkAdminToken, (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ success: false, message: '房间不存在' });
  const messages = room.messages.map(msg => ({
    sender: msg.sender,
    type: msg.type,
    timestamp: msg.timestamp,
  }));
  res.json({ success: true, messages });
});

app.post('/api/admin/change-password', checkAdminToken, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ success: false, message: '密码至少6位' });
  try {
    const [rows] = await pool.query("SELECT username FROM admins LIMIT 1");
    if (rows.length === 0) return res.status(500).json({ success: false, message: '未找到管理员' });
    const username = rows[0].username;
    const hash = bcrypt.hashSync(newPassword, 10);
    const [result] = await pool.query("UPDATE admins SET password_hash = ? WHERE username = ?", [hash, username]);
    if (result.affectedRows === 0) return res.status(500).json({ success: false, message: '更新失败' });
    res.json({ success: true, message: '密码已更新，请重新登录' });
  } catch (err) {
    console.error('修改密码错误:', err);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

app.post('/api/admin/change-username', checkAdminToken, async (req, res) => {
  const { newUsername } = req.body;
  if (!newUsername || newUsername.length < 3) return res.status(400).json({ success: false, message: '用户名至少3位' });
  try {
    const [rows] = await pool.query("SELECT username FROM admins LIMIT 1");
    if (rows.length === 0) return res.status(500).json({ success: false, message: '未找到管理员' });
    const oldUsername = rows[0].username;
    const [result] = await pool.query("UPDATE admins SET username = ? WHERE username = ?", [newUsername, oldUsername]);
    if (result.affectedRows === 0) return res.status(500).json({ success: false, message: '更新失败' });
    res.json({ success: true, message: '用户名已更新，请重新登录' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

app.post('/api/admin/change-path', checkAdminToken, async (req, res) => {
  const { newPath } = req.body;
  if (!newPath || !newPath.startsWith('/') || newPath.length < 2) {
    return res.status(400).json({ success: false, message: '路径必须以 / 开头且至少2个字符' });
  }
  try {
    await pool.query("UPDATE settings SET `value` = ? WHERE `key` = 'admin_path'", [newPath]);
    res.json({ success: true, message: '后台路径已更新' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

app.get('/api/admin/current-path', async (req, res) => {
  const path = await getAdminPath();
  res.json({ success: true, path });
});

app.get('/{*splat}', async (req, res, next) => {
  const adminPath = await getAdminPath();
  if (req.path === adminPath) {
    return res.sendFile(path.join(__dirname, 'admin.html'));
  }
  if (!req.path.includes('.')) {
    return res.sendFile(path.join(__dirname, 'index.html'));
  }
  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://tchat.uuli.top',
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  console.log('🔌 新连接:', socket.id);
  const ip = getClientIp(socket);
  onlineUsers.set(socket.id, { ip, country: '未知', roomId: null, nickname: null });

  socket.on('create_room', ({ nickname }) => {
    const roomId = generateRoomId();
    const key = generateKey();
    const finalNick = (nickname && nickname.trim()) || getRandomName();
    const ownerToken = crypto.randomBytes(16).toString('hex');
    rooms.set(roomId, {
      users: new Map(),
      messages: [],
      retain: false,
      creator: finalNick,
      key: key,
      ownerSocketId: socket.id,
      ownerToken: ownerToken,
      destroyTimer: null,
      reconnectTimer: null,
    });
    socket.join(roomId);
    const room = rooms.get(roomId);
    room.users.set(finalNick, socket.id);
    onlineUsers.set(socket.id, { ...onlineUsers.get(socket.id), roomId, nickname: finalNick });
    socket.emit('room_created', { roomId, key, nickname: finalNick, ownerToken });
    console.log(`🆕 用户 ${finalNick} 创建房间 ${roomId}`);
  });

  // ========== 修改 join_room：支持无密钥加入（自动补全） ==========
  socket.on('join_room', ({ roomId, nickname, key, ownerToken }) => {
    let room = rooms.get(roomId);
    let matchedRoomId = roomId;
    if (!room) {
      for (const [k, v] of rooms) {
        if (k.startsWith(roomId)) {
          room = v;
          matchedRoomId = k;
          break;
        }
      }
    }
    if (!room) {
      socket.emit('error_msg', '房间不存在，请检查ID是否正确');
      return;
    }

    // 如果客户端未提供密钥，自动从房间获取
    if (!key) {
      key = room.key;
      console.log(`🔑 自动提供密钥给客户端加入房间 ${matchedRoomId}`);
    } else if (key !== room.key) {
      socket.emit('error_msg', '密钥错误，无法加入房间');
      return;
    }

    // 房主重连逻辑（基于令牌）
    let isOwnerReconnect = false;
    if (ownerToken && room.ownerToken === ownerToken) {
      isOwnerReconnect = true;
      if (room.reconnectTimer) {
        clearTimeout(room.reconnectTimer);
        room.reconnectTimer = null;
      }
      if (room.destroyTimer) {
        clearTimeout(room.destroyTimer);
        room.destroyTimer = null;
      }
      room.ownerSocketId = socket.id;
      socket.to(matchedRoomId).emit('owner_joined', '房主已重新加入');
      console.log(`🔄 房主重连，取消房间 ${matchedRoomId} 的销毁`);
    }

    let finalNick;
    if (isOwnerReconnect) {
      finalNick = room.creator;
      if (room.users.has(finalNick)) {
        room.users.delete(finalNick);
      }
    } else {
      finalNick = (nickname && nickname.trim()) || getRandomName();
      let uniqueNick = finalNick;
      let suffix = 1;
      while (room.users.has(uniqueNick)) {
        uniqueNick = finalNick + suffix++;
      }
      finalNick = uniqueNick;
    }

    socket.join(matchedRoomId);
    room.users.set(finalNick, socket.id);
    onlineUsers.set(socket.id, { ...onlineUsers.get(socket.id), roomId: matchedRoomId, nickname: finalNick });
    socket.emit('joined', { roomId: matchedRoomId, nickname: finalNick, key: room.key || '' });
    socket.to(matchedRoomId).emit('user_joined', finalNick);
    socket.emit('history', room.messages);
  });

  socket.on('send_msg', (data) => {
    const { roomId, cipher, sender, type } = data;
    const room = rooms.get(roomId);
    if (!room) return;
    room.messages.push({
      cipher,
      sender,
      type: type || 'text',
      timestamp: Date.now()
    });
    if (room.messages.length > 500) room.messages.shift();
    io.to(roomId).emit('msg', { cipher, sender, type: type || 'text' });
  });

  socket.on('set_retain', ({ roomId, enabled }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.retain = enabled;
    io.to(roomId).emit('retain_setting', enabled);
  });

  socket.on('disconnect', () => {
    const info = onlineUsers.get(socket.id);
    if (info) {
      const { roomId, nickname } = info;
      if (roomId) {
        const room = rooms.get(roomId);
        if (room) {
          if (room.ownerSocketId === socket.id) {
            console.log(`⏳ 房主 ${nickname} 断开，等待5秒重连...`);
            if (room.reconnectTimer) clearTimeout(room.reconnectTimer);
            room.reconnectTimer = setTimeout(() => {
              const currentRoom = rooms.get(roomId);
              if (currentRoom && currentRoom.ownerSocketId === socket.id) {
                socket.to(roomId).emit('owner_left', '房主已离开，若10秒内未重连，房间将关闭');
                console.log(`⏳ 房主未重连，10秒后销毁房间 ${roomId}`);
                room.destroyTimer = setTimeout(() => {
                  io.to(roomId).emit('room_closed', '房主已退出，房间已关闭');
                  const sockets = io.sockets.adapter.rooms.get(roomId);
                  if (sockets) {
                    for (const sid of sockets) {
                      const s = io.sockets.sockets.get(sid);
                      if (s) s.disconnect(true);
                    }
                  }
                  rooms.delete(roomId);
                  console.log(`🧹 房间 ${roomId} 已销毁（房主退出）`);
                }, 10000);
              }
            }, 5000);
          } else {
            room.users.delete(nickname);
            socket.to(roomId).emit('user_left', nickname);
            if (room.users.size === 0) {
              setTimeout(() => {
                if (room.users.size === 0) {
                  rooms.delete(roomId);
                  console.log(`🧹 房间 ${roomId} 已清理（无人）`);
                }
              }, 5 * 60 * 1000);
            }
          }
        }
        onlineUsers.delete(socket.id);
      }
      console.log('❌ 断开:', socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 服务器运行在端口 ${PORT}`);
});
