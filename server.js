#!/usr/bin/env node
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const TEMP_DIR = path.join(__dirname, 'temp_uploads');

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Multer storage for server relay fallback
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_DIR),
  filename: (req, file, cb) => {
    const uniqueId = crypto.randomBytes(8).toString('hex');
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${uniqueId}-${safeName}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } }); // 2GB limit

// Store metadata for relay files with auto-cleanup
const relayFiles = new Map();

function cleanupOldFiles() {
  const now = Date.now();
  for (const [id, meta] of relayFiles.entries()) {
    if (now - meta.createdAt > 15 * 60 * 1000) { // 15 mins
      try {
        if (fs.existsSync(meta.filePath)) fs.unlinkSync(meta.filePath);
      } catch (e) {}
      relayFiles.delete(id);
    }
  }
}
setInterval(cleanupOldFiles, 60 * 1000);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Network interfaces finder
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, address: iface.address });
      }
    }
  }
  return ips;
}

// API to get host info
app.get('/api/info', (req, res) => {
  res.json({
    hostname: os.hostname(),
    platform: os.platform(),
    ips: getLocalIPs(),
    port: PORT
  });
});

// API to get QR Code DataURL
app.get('/api/qr', async (req, res) => {
  try {
    const localIps = getLocalIPs();
    const primaryIp = localIps.length > 0 ? localIps[0].address : '127.0.0.1';
    const targetUrl = req.query.url || `http://${primaryIp}:${PORT}`;
    const qrDataUrl = await QRCode.toDataURL(targetUrl, {
      margin: 1,
      width: 320,
      color: {
        dark: '#0f172a',
        light: '#f8fafc'
      }
    });
    res.json({ qr: qrDataUrl, url: targetUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Relay File Upload
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const fileId = crypto.randomBytes(12).toString('hex');
  relayFiles.set(fileId, {
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    filePath: req.file.path,
    createdAt: Date.now()
  });

  res.json({
    fileId,
    name: req.file.originalname,
    size: req.file.size,
    mimeType: req.file.mimetype,
    downloadUrl: `/api/download/${fileId}`
  });
});

// Relay File Download
app.get('/api/download/:fileId', (req, res) => {
  const fileMeta = relayFiles.get(req.params.fileId);
  if (!fileMeta || !fs.existsSync(fileMeta.filePath)) {
    return res.status(404).send('File not found or expired.');
  }

  res.download(fileMeta.filePath, fileMeta.originalName);
});

// Random Animal & Color codenames for devices
const ADJECTIVES = ['Neon', 'Cyber', 'Cosmic', 'Solar', 'Hyper', 'Swift', 'Quantum', 'Shadow', 'Turbo', 'Frost'];
const ANIMALS = ['Falcon', 'Panther', 'Fox', 'Wolf', 'Hawk', 'Tiger', 'Eagle', 'Otter', 'Lynx', 'Viper'];

function generateCodename() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const num = Math.floor(10 + Math.random() * 90);
  return `${adj} ${animal} ${num}`;
}

// Connected peers registry
const peers = new Map(); // ws -> { id, name, device, joinedAt }

function broadcastPeerList() {
  const peerList = Array.from(peers.values()).map(p => ({
    id: p.id,
    name: p.name,
    device: p.device,
    joinedAt: p.joinedAt
  }));

  const msg = JSON.stringify({ type: 'peer-list', peers: peerList });
  for (const [clientWs] of peers.entries()) {
    if (clientWs.readyState === clientWs.OPEN) {
      clientWs.send(msg);
    }
  }
}

function sendToPeer(targetId, message) {
  for (const [clientWs, peer] of peers.entries()) {
    if (peer.id === targetId && clientWs.readyState === clientWs.OPEN) {
      clientWs.send(JSON.stringify(message));
      return true;
    }
  }
  return false;
}

wss.on('connection', (ws, req) => {
  const id = crypto.randomUUID();
  const defaultName = generateCodename();

  const peerData = {
    id,
    name: defaultName,
    device: {
      ua: req.headers['user-agent'] || '',
      ip: req.socket.remoteAddress || ''
    },
    joinedAt: Date.now()
  };

  peers.set(ws, peerData);

  // Send initialization info to the new peer
  ws.send(JSON.stringify({
    type: 'init',
    peer: {
      id: peerData.id,
      name: peerData.name
    }
  }));

  // Broadcast updated peer list to everyone
  broadcastPeerList();

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);

      switch (data.type) {
        case 'update-name':
          if (data.name && typeof data.name === 'string') {
            peerData.name = data.name.trim().slice(0, 32) || peerData.name;
            broadcastPeerList();
          }
          break;

        case 'signal':
          // WebRTC signaling: offer, answer, ice-candidate
          if (data.target) {
            sendToPeer(data.target, {
              type: 'signal',
              sender: peerData.id,
              senderName: peerData.name,
              signal: data.signal
            });
          }
          break;

        case 'transfer-offer':
          // Sender asking target if they accept transfer
          if (data.target) {
            sendToPeer(data.target, {
              type: 'transfer-offer',
              sender: peerData.id,
              senderName: peerData.name,
              fileInfo: data.fileInfo,
              transferId: data.transferId
            });
          }
          break;

        case 'transfer-answer':
          // Target accepting or declining
          if (data.target) {
            sendToPeer(data.target, {
              type: 'transfer-answer',
              sender: peerData.id,
              senderName: peerData.name,
              accepted: data.accepted,
              transferId: data.transferId
            });
          }
          break;

        case 'text-message':
          // Instant text / clipboard share
          if (data.target === 'all') {
            // Broadcast to everyone except sender
            const payload = JSON.stringify({
              type: 'text-message',
              sender: peerData.id,
              senderName: peerData.name,
              text: data.text,
              timestamp: Date.now()
            });
            for (const [clientWs, p] of peers.entries()) {
              if (p.id !== peerData.id && clientWs.readyState === clientWs.OPEN) {
                clientWs.send(payload);
              }
            }
          } else if (data.target) {
            sendToPeer(data.target, {
              type: 'text-message',
              sender: peerData.id,
              senderName: peerData.name,
              text: data.text,
              timestamp: Date.now()
            });
          }
          break;

        default:
          break;
      }
    } catch (err) {
      console.error('Failed to parse WS message:', err);
    }
  });

  ws.on('close', () => {
    peers.delete(ws);
    broadcastPeerList();
  });

  ws.on('error', () => {
    peers.delete(ws);
    broadcastPeerList();
  });
});

// Start Server & Show QR code
server.listen(PORT, '0.0.0.0', () => {
  const localIps = getLocalIPs();
  const primaryIp = localIps.length > 0 ? localIps[0].address : '127.0.0.1';
  const networkUrl = `http://${primaryIp}:${PORT}`;
  const localhostUrl = `http://localhost:${PORT}`;

  console.log('\n========================================================');
  console.log('   🚀 LAN-DROP ULTRA (Local P2P File & Text Sharer)     ');
  console.log('========================================================');
  console.log(`\n📡 Web App running on:`);
  console.log(`   ➜ Localhost:  ${localhostUrl}`);
  console.log(`   ➜ Network:    ${networkUrl}`);

  if (localIps.length > 1) {
    console.log('\nOther Network Interfaces:');
    localIps.slice(1).forEach(iface => {
      console.log(`   ➜ ${iface.name}: http://${iface.address}:${PORT}`);
    });
  }

  console.log('\n📲 Scan with your Phone/Tablet Camera to connect instantly:\n');
  try {
    qrcodeTerminal.generate(networkUrl, { small: true });
  } catch (e) {
    console.log('QR Code generation failed, please open the URL directly.');
  }

  console.log('\n✨ Ready for connections! Keep this terminal open.\n');
});
