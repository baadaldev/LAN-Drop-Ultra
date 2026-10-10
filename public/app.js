// LAN-Drop Ultra Frontend Client Engine
(() => {
  // Application State
  const state = {
    myId: null,
    myName: localStorage.getItem('landrop_device_name') || '',
    peers: [],
    selectedTarget: 'all',
    activeTab: 'files',
    soundEnabled: localStorage.getItem('landrop_sound') !== 'false',
    peerConnections: new Map(), // peerId -> RTCPeerConnection
    dataChannels: new Map(),    // peerId -> RTCDataChannel
    pendingIncomingTransfer: null,
    inbox: JSON.parse(localStorage.getItem('landrop_inbox') || '[]'),
    activeTransfer: null
  };

  // DOM Elements
  const selfNameEl = document.getElementById('selfName');
  const selfBadgeEl = document.getElementById('selfBadge');
  const editNameBtn = document.getElementById('editNameBtn');
  const qrBtn = document.getElementById('qrBtn');
  const soundToggleBtn = document.getElementById('soundToggleBtn');
  const soundOnIcon = document.getElementById('soundOnIcon');
  const soundOffIcon = document.getElementById('soundOffIcon');
  const peerCountEl = document.getElementById('peerCount');
  const peersGridEl = document.getElementById('peersGrid');
  const emptyPeersStateEl = document.getElementById('emptyPeersState');
  const targetPeerSelect = document.getElementById('targetPeerSelect');
  const quickShareUrlEl = document.getElementById('quickShareUrl');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const emptyQrBtn = document.getElementById('emptyQrBtn');

  // Tabs & Dropzone
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContentFiles = document.getElementById('tabContentFiles');
  const tabContentText = document.getElementById('tabContentText');
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');

  // Text Sharer
  const textShareInput = document.getElementById('textShareInput');
  const charCountEl = document.getElementById('charCount');
  const sendTextBtn = document.getElementById('sendTextBtn');
  const pasteClipboardBtn = document.getElementById('pasteClipboardBtn');

  // Transfer Card
  const activeTransferCard = document.getElementById('activeTransferCard');
  const transferDirectionBadge = document.getElementById('transferDirectionBadge');
  const transferFilename = document.getElementById('transferFilename');
  const transferPercentage = document.getElementById('transferPercentage');
  const transferProgressBar = document.getElementById('transferProgressBar');
  const transferTransferred = document.getElementById('transferTransferred');
  const transferSpeed = document.getElementById('transferSpeed');
  const transferEta = document.getElementById('transferEta');

  // Inbox
  const inboxListEl = document.getElementById('inboxList');
  const clearInboxBtn = document.getElementById('clearInboxBtn');

  // Modals
  const qrModal = document.getElementById('qrModal');
  const closeQrModal = document.getElementById('closeQrModal');
  const qrContainer = document.getElementById('qrContainer');
  const qrDirectLink = document.getElementById('qrDirectLink');
  const copyDirectLinkBtn = document.getElementById('copyDirectLinkBtn');

  const renameModal = document.getElementById('renameModal');
  const closeRenameModal = document.getElementById('closeRenameModal');
  const newDeviceNameInput = document.getElementById('newDeviceNameInput');
  const cancelRenameBtn = document.getElementById('cancelRenameBtn');
  const saveRenameBtn = document.getElementById('saveRenameBtn');

  const incomingModal = document.getElementById('incomingModal');
  const incomingSender = document.getElementById('incomingSender');
  const incomingFileName = document.getElementById('incomingFileName');
  const incomingFileSize = document.getElementById('incomingFileSize');
  const incomingFileIcon = document.getElementById('incomingFileIcon');
  const acceptTransferBtn = document.getElementById('acceptTransferBtn');
  const declineTransferBtn = document.getElementById('declineTransferBtn');

  const toastContainer = document.getElementById('toastContainer');

  // Init Sound setting
  updateSoundUI();

  // Establish WebSocket Connection
  let ws = null;
  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
      showToast('Connected to LAN network', 'success');
      if (state.myName) {
        ws.send(JSON.stringify({ type: 'update-name', name: state.myName }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleWsMessage(msg);
      } catch (e) {
        console.error('WS Error parsing:', e);
      }
    };

    ws.onclose = () => {
      setTimeout(connectWebSocket, 2000);
    };
  }

  connectWebSocket();

  // Setup URLs
  const currentNetworkUrl = `${location.protocol}//${location.host}`;
  quickShareUrlEl.textContent = currentNetworkUrl;
  qrDirectLink.value = currentNetworkUrl;

  // Handle incoming WS messages
  function handleWsMessage(msg) {
    switch (msg.type) {
      case 'init':
        state.myId = msg.peer.id;
        if (!state.myName) {
          state.myName = msg.peer.name;
        }
        selfNameEl.textContent = state.myName;
        break;

      case 'peer-list':
        state.peers = msg.peers.filter(p => p.id !== state.myId);
        updatePeersUI();
        break;

      case 'signal':
        handleWebRTCSignal(msg.sender, msg.signal);
        break;

      case 'transfer-offer':
        handleIncomingTransferOffer(msg);
        break;

      case 'transfer-answer':
        handleTransferAnswer(msg);
        break;

      case 'text-message':
        handleIncomingText(msg);
        break;

      default:
        break;
    }
  }

  // Detect Device info from User-Agent
  function parseDeviceInfo(ua) {
    let icon = '💻';
    let deviceName = 'PC / Laptop';

    if (/iphone/i.test(ua)) {
      icon = '📱';
      deviceName = 'iPhone';
    } else if (/ipad/i.test(ua)) {
      icon = '📟';
      deviceName = 'iPad';
    } else if (/android/i.test(ua)) {
      icon = '📱';
      deviceName = 'Android Device';
    } else if (/macintosh|mac os x/i.test(ua)) {
      icon = '🍎';
      deviceName = 'MacBook / Mac';
    } else if (/windows/i.test(ua)) {
      icon = '🪟';
      deviceName = 'Windows PC';
    } else if (/linux/i.test(ua)) {
      icon = '🐧';
      deviceName = 'Linux System';
    }

    return { icon, deviceName };
  }

  // Update Peers UI
  function updatePeersUI() {
    peerCountEl.textContent = state.peers.length;

    // Update target select options
    const prevSelected = targetPeerSelect.value;
    targetPeerSelect.innerHTML = '<option value="all">📢 Broadcast to Everyone</option>';

    if (state.peers.length === 0) {
      emptyPeersStateEl.classList.remove('hidden');
      peersGridEl.innerHTML = '';
      return;
    }

    emptyPeersStateEl.classList.add('hidden');
    peersGridEl.innerHTML = '';

    state.peers.forEach(peer => {
      const { icon, deviceName } = parseDeviceInfo(peer.device?.ua || '');

      // Add to select dropdown
      const opt = document.createElement('option');
      opt.value = peer.id;
      opt.textContent = `${peer.name} (${deviceName})`;
      targetPeerSelect.appendChild(opt);

      // Create Peer Card
      const card = document.createElement('div');
      card.className = `peer-card ${state.selectedTarget === peer.id ? 'active-target' : ''}`;
      card.innerHTML = `
        <div class="peer-card-top">
          <div class="peer-avatar">${icon}</div>
          <div class="peer-info">
            <span class="peer-name" title="${peer.name}">${peer.name}</span>
            <span class="peer-meta">${deviceName}</span>
          </div>
        </div>
        <div class="peer-actions">
          <button class="peer-action-btn select-peer-btn" data-peer-id="${peer.id}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Send File
          </button>
        </div>
      `;

      card.querySelector('.select-peer-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        selectTargetPeer(peer.id);
        fileInput.click();
      });

      card.addEventListener('click', () => {
        selectTargetPeer(peer.id);
      });

      peersGridEl.appendChild(card);
    });

    if (prevSelected && Array.from(targetPeerSelect.options).some(o => o.value === prevSelected)) {
      targetPeerSelect.value = prevSelected;
    }
  }

  function selectTargetPeer(peerId) {
    state.selectedTarget = peerId;
    targetPeerSelect.value = peerId;
    document.querySelectorAll('.peer-card').forEach(c => c.classList.remove('active-target'));
    const matchingCard = document.querySelector(`.select-peer-btn[data-peer-id="${peerId}"]`)?.closest('.peer-card');
    if (matchingCard) matchingCard.classList.add('active-target');
  }

  targetPeerSelect.addEventListener('change', (e) => {
    state.selectedTarget = e.target.value;
    selectTargetPeer(e.target.value);
  });

  // Tab Switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-tab');
      state.activeTab = tab;

      if (tab === 'files') {
        tabContentFiles.classList.remove('hidden');
        tabContentText.classList.add('hidden');
      } else {
        tabContentFiles.classList.add('hidden');
        tabContentText.classList.remove('hidden');
      }
    });
  });

  // Drag and Drop Zone
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelected(Array.from(e.dataTransfer.files));
    }
  });

  browseBtn.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('click', (e) => {
    if (e.target !== browseBtn) fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesSelected(Array.from(e.target.files));
      fileInput.value = '';
    }
  });

  // Handle Selected Files for Sending
  async function handleFilesSelected(files) {
    if (files.length === 0) return;

    if (state.peers.length === 0) {
      showToast('No devices online on this Wi-Fi network yet!', 'error');
      openQrModal();
      return;
    }

    for (const file of files) {
      await sendFile(file, state.selectedTarget);
    }
  }

  // Send File: WebRTC or HTTP Relay Fallback
  async function sendFile(file, targetId) {
    // If target is "all" or specific peer
    if (targetId === 'all') {
      showToast(`Broadcasting "${file.name}" to everyone...`);
      return sendFileViaRelay(file, 'all');
    }

    // Try WebRTC DataChannel first
    try {
      const channel = await getOrCreateDataChannel(targetId);
      if (channel && channel.readyState === 'open') {
        await transferFileOverDataChannel(file, channel, targetId);
      } else {
        // Fallback to LAN HTTP Relay
        await sendFileViaRelay(file, targetId);
      }
    } catch (err) {
      console.warn('WebRTC transfer fallback to HTTP relay:', err);
      await sendFileViaRelay(file, targetId);
    }
  }

  // Send file via Server Relay HTTP (Super reliable fallback)
  async function sendFileViaRelay(file, targetId) {
    updateTransferProgress({
      direction: 'Uploading',
      fileName: file.name,
      percent: 0,
      transferred: 0,
      total: file.size,
      speed: 0
    });

    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    let startTime = Date.now();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        const elapsedSec = (Date.now() - startTime) / 1000;
        const speedMBps = elapsedSec > 0 ? ((e.loaded / (1024 * 1024)) / elapsedSec).toFixed(1) : 0;
        
        updateTransferProgress({
          direction: 'Uploading',
          fileName: file.name,
          percent,
          transferred: e.loaded,
          total: e.total,
          speed: speedMBps
        });
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        const res = JSON.parse(xhr.responseText);
        hideTransferProgress();
        soundFX.playSend();
        showToast(`Sent "${file.name}" successfully!`, 'success');

        // Notify target(s) via WS
        ws.send(JSON.stringify({
          type: 'text-message',
          target: targetId,
          text: `FILE_RELAY:${JSON.stringify({
            name: file.name,
            size: file.size,
            url: res.downloadUrl,
            mime: file.type
          })}`
        }));
      } else {
        hideTransferProgress();
        showToast('Upload failed', 'error');
      }
    };

    xhr.onerror = () => {
      hideTransferProgress();
      showToast('Transfer network error', 'error');
    };

    xhr.open('POST', '/api/upload');
    xhr.send(formData);
  }

  // WebRTC Chunk Transfer with backpressure
  async function transferFileOverDataChannel(file, channel, targetId) {
    const CHUNK_SIZE = 64 * 1024; // 64KB
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let chunkIndex = 0;
    let offset = 0;
    const startTime = Date.now();

    // Send Header
    channel.send(JSON.stringify({
      type: 'file-meta',
      name: file.name,
      size: file.size,
      mime: file.type,
      totalChunks
    }));

    updateTransferProgress({
      direction: 'P2P Sending',
      fileName: file.name,
      percent: 0,
      transferred: 0,
      total: file.size,
      speed: 0
    });

    return new Promise((resolve, reject) => {
      const sendNextChunk = () => {
        while (offset < file.size) {
          // Check channel buffer to avoid memory exhaustion
          if (channel.bufferedAmount > 8 * 1024 * 1024) {
            channel.onbufferedamountlow = () => {
              channel.onbufferedamountlow = null;
              sendNextChunk();
            };
            return;
          }

          const slice = file.slice(offset, offset + CHUNK_SIZE);
          const reader = new FileReader();

          reader.onload = (e) => {
            channel.send(e.target.result);
            offset += slice.size;
            chunkIndex++;

            const percent = Math.round((offset / file.size) * 100);
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = elapsed > 0 ? ((offset / (1024 * 1024)) / elapsed).toFixed(1) : 0;

            updateTransferProgress({
              direction: 'P2P Sending',
              fileName: file.name,
              percent,
              transferred: offset,
              total: file.size,
              speed
            });

            if (offset >= file.size) {
              hideTransferProgress();
              soundFX.playSend();
              showToast(`"${file.name}" sent via P2P!`, 'success');
              resolve();
            } else {
              sendNextChunk();
            }
          };

          reader.readAsArrayBuffer(slice);
          return;
        }
      };

      sendNextChunk();
    });
  }

  // WebRTC Setup
  const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  async function getOrCreateDataChannel(peerId) {
    if (state.dataChannels.has(peerId)) {
      const ch = state.dataChannels.get(peerId);
      if (ch.readyState === 'open') return ch;
    }

    const pc = new RTCPeerConnection(rtcConfig);
    state.peerConnections.set(peerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        ws.send(JSON.stringify({
          type: 'signal',
          target: peerId,
          signal: { candidate: event.candidate }
        }));
      }
    };

    const channel = pc.createDataChannel('fileTransfer', { ordered: true });
    setupDataChannelEvents(channel, peerId);
    state.dataChannels.set(peerId, channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    ws.send(JSON.stringify({
      type: 'signal',
      target: peerId,
      signal: { sdp: pc.localDescription }
    }));

    return new Promise((resolve) => {
      channel.onopen = () => resolve(channel);
      setTimeout(() => resolve(null), 4000); // 4s timeout fallback
    });
  }

  async function handleWebRTCSignal(senderId, signal) {
    let pc = state.peerConnections.get(senderId);

    if (!pc) {
      pc = new RTCPeerConnection(rtcConfig);
      state.peerConnections.set(senderId, pc);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          ws.send(JSON.stringify({
            type: 'signal',
            target: senderId,
            signal: { candidate: event.candidate }
          }));
        }
      };

      pc.ondatachannel = (event) => {
        setupDataChannelEvents(event.channel, senderId);
        state.dataChannels.set(senderId, event.channel);
      };
    }

    if (signal.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      if (signal.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({
          type: 'signal',
          target: senderId,
          signal: { sdp: pc.localDescription }
        }));
      }
    } else if (signal.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    }
  }

  // Setup receiver data channel
  function setupDataChannelEvents(channel, peerId) {
    let incomingMeta = null;
    let receivedBytes = 0;
    let receivedChunks = [];
    let startTime = 0;

    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'file-meta') {
            incomingMeta = msg;
            receivedBytes = 0;
            receivedChunks = [];
            startTime = Date.now();

            updateTransferProgress({
              direction: 'Receiving P2P',
              fileName: msg.name,
              percent: 0,
              transferred: 0,
              total: msg.size,
              speed: 0
            });
          }
        } catch (e) {}
      } else {
        // Binary ArrayBuffer chunk
        receivedChunks.push(event.data);
        receivedBytes += event.data.byteLength;

        if (incomingMeta) {
          const percent = Math.round((receivedBytes / incomingMeta.size) * 100);
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = elapsed > 0 ? ((receivedBytes / (1024 * 1024)) / elapsed).toFixed(1) : 0;

          updateTransferProgress({
            direction: 'Receiving P2P',
            fileName: incomingMeta.name,
            percent,
            transferred: receivedBytes,
            total: incomingMeta.size,
            speed
          });

          if (receivedBytes >= incomingMeta.size) {
            hideTransferProgress();
            const blob = new Blob(receivedChunks, { type: incomingMeta.mime || 'application/octet-stream' });
            const downloadUrl = URL.createObjectURL(blob);

            // Auto-trigger download
            triggerDownload(downloadUrl, incomingMeta.name);
            soundFX.playReceive();

            // Add to inbox
            addToInbox({
              type: 'file',
              name: incomingMeta.name,
              size: incomingMeta.size,
              url: downloadUrl,
              sender: getPeerName(peerId),
              timestamp: Date.now()
            });

            showToast(`Received "${incomingMeta.name}"!`, 'success');
            incomingMeta = null;
            receivedChunks = [];
          }
        }
      }
    };
  }

  // Handle Incoming Text or Relay File Messages
  function handleIncomingText(msg) {
    // Check if it's a file relay notification
    if (msg.text && msg.text.startsWith('FILE_RELAY:')) {
      try {
        const fileData = JSON.parse(msg.text.replace('FILE_RELAY:', ''));
        soundFX.playReceive();

        addToInbox({
          type: 'file',
          name: fileData.name,
          size: fileData.size,
          url: fileData.url,
          sender: msg.senderName,
          timestamp: Date.now()
        });

        showToast(`Received "${fileData.name}" from ${msg.senderName}!`, 'success');
        return;
      } catch (e) {}
    }

    // Regular text / link message
    soundFX.playReceive();
    addToInbox({
      type: 'text',
      text: msg.text,
      sender: msg.senderName,
      timestamp: msg.timestamp || Date.now()
    });

    showToast(`New text from ${msg.senderName}!`);
  }

  // Send Text Logic
  sendTextBtn.addEventListener('click', () => {
    const text = textShareInput.value.trim();
    if (!text) return;

    if (state.peers.length === 0) {
      showToast('No other devices connected on Wi-Fi yet!', 'error');
      openQrModal();
      return;
    }

    ws.send(JSON.stringify({
      type: 'text-message',
      target: state.selectedTarget,
      text
    }));

    soundFX.playSend();
    showToast('Text sent successfully!', 'success');
    textShareInput.value = '';
    charCountEl.textContent = '0';
  });

  textShareInput.addEventListener('input', () => {
    charCountEl.textContent = textShareInput.value.length;
  });

  pasteClipboardBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      textShareInput.value = text;
      charCountEl.textContent = text.length;
      showToast('Pasted from clipboard!');
    } catch (e) {
      showToast('Clipboard access denied or unavailable', 'error');
    }
  });

  // Transfer Progress UI
  function updateTransferProgress({ direction, fileName, percent, transferred, total, speed }) {
    activeTransferCard.classList.remove('hidden');
    transferDirectionBadge.textContent = direction;
    transferFilename.textContent = fileName;
    transferPercentage.textContent = `${percent}%`;
    transferProgressBar.style.width = `${percent}%`;
    transferTransferred.textContent = `${formatBytes(transferred)} / ${formatBytes(total)}`;
    transferSpeed.textContent = `${speed} MB/s`;

    if (speed > 0 && total > transferred) {
      const remainingBytes = total - transferred;
      const etaSeconds = Math.ceil(remainingBytes / (speed * 1024 * 1024));
      transferEta.textContent = `ETA: ${etaSeconds}s`;
    } else {
      transferEta.textContent = `ETA: --`;
    }
  }

  function hideTransferProgress() {
    setTimeout(() => {
      activeTransferCard.classList.add('hidden');
      transferProgressBar.style.width = '0%';
    }, 1200);
  }

  // Inbox & History Management
  function addToInbox(item) {
    state.inbox.unshift(item);
    if (state.inbox.length > 50) state.inbox.pop();
    localStorage.setItem('landrop_inbox', JSON.stringify(state.inbox));
    renderInbox();
  }

  function renderInbox() {
    if (state.inbox.length === 0) {
      inboxListEl.innerHTML = '<div class="empty-inbox">No files or texts received in this session yet.</div>';
      return;
    }

    inboxListEl.innerHTML = '';
    state.inbox.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'inbox-item';

      if (item.type === 'file') {
        card.innerHTML = `
          <div class="inbox-item-left">
            <div class="inbox-item-icon">📁</div>
            <div class="inbox-item-info">
              <span class="inbox-item-title" title="${item.name}">${item.name}</span>
              <span class="inbox-item-meta">${formatBytes(item.size)} • from ${item.sender || 'Peer'}</span>
            </div>
          </div>
          <a href="${item.url}" download="${item.name}" class="copy-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Save
          </a>
        `;
      } else {
        const isUrl = /^https?:\/\//i.test(item.text);
        card.innerHTML = `
          <div class="inbox-item-left">
            <div class="inbox-item-icon">💬</div>
            <div class="inbox-item-info">
              <span class="inbox-item-title" title="${item.text}">${item.text}</span>
              <span class="inbox-item-meta">Text • from ${item.sender || 'Peer'}</span>
            </div>
          </div>
          <div style="display: flex; gap: 6px;">
            ${isUrl ? `<a href="${item.text}" target="_blank" class="copy-btn">Open</a>` : ''}
            <button class="copy-btn copy-text-btn" data-text="${encodeURIComponent(item.text)}">Copy</button>
          </div>
        `;

        card.querySelector('.copy-text-btn').addEventListener('click', (e) => {
          const text = decodeURIComponent(e.target.getAttribute('data-text'));
          navigator.clipboard.writeText(text);
          showToast('Copied to clipboard!', 'success');
        });
      }

      inboxListEl.appendChild(card);
    });
  }

  clearInboxBtn.addEventListener('click', () => {
    state.inbox = [];
    localStorage.removeItem('landrop_inbox');
    renderInbox();
    showToast('Inbox cleared');
  });

  renderInbox();

  // QR Code Modal
  async function openQrModal() {
    qrModal.classList.remove('hidden');
    qrContainer.innerHTML = '<div class="qr-loading">Generating QR Code...</div>';

    try {
      const res = await fetch(`/api/qr?url=${encodeURIComponent(currentNetworkUrl)}`);
      const data = await res.json();
      qrContainer.innerHTML = `<img src="${data.qr}" alt="Network QR Code">`;
    } catch (e) {
      qrContainer.innerHTML = '<p style="color:var(--danger)">Failed to load QR code</p>';
    }
  }

  qrBtn.addEventListener('click', openQrModal);
  emptyQrBtn.addEventListener('click', openQrModal);
  closeQrModal.addEventListener('click', () => qrModal.classList.add('hidden'));
  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) qrModal.classList.add('hidden');
  });

  // Copy buttons
  copyUrlBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(currentNetworkUrl);
    showToast('Network URL copied to clipboard!', 'success');
  });

  copyDirectLinkBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(currentNetworkUrl);
    showToast('Link copied to clipboard!', 'success');
  });

  // Rename Device Modal
  function openRenameModal() {
    newDeviceNameInput.value = state.myName;
    renameModal.classList.remove('hidden');
    newDeviceNameInput.focus();
  }

  editNameBtn.addEventListener('click', openRenameModal);
  selfBadgeEl.addEventListener('click', openRenameModal);
  closeRenameModal.addEventListener('click', () => renameModal.classList.add('hidden'));
  cancelRenameBtn.addEventListener('click', () => renameModal.classList.add('hidden'));
  renameModal.addEventListener('click', (e) => {
    if (e.target === renameModal) renameModal.classList.add('hidden');
  });

  saveRenameBtn.addEventListener('click', () => {
    const newName = newDeviceNameInput.value.trim();
    if (newName) {
      state.myName = newName;
      localStorage.setItem('landrop_device_name', newName);
      selfNameEl.textContent = newName;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'update-name', name: newName }));
      }
      showToast('Device name updated!', 'success');
      renameModal.classList.add('hidden');
    }
  });

  // Sound Toggle
  soundToggleBtn.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    localStorage.setItem('landrop_sound', state.soundEnabled);
    soundFX.enabled = state.soundEnabled;
    updateSoundUI();
    showToast(state.soundEnabled ? 'Sound FX enabled' : 'Sound FX muted');
  });

  function updateSoundUI() {
    soundFX.enabled = state.soundEnabled;
    if (state.soundEnabled) {
      soundOnIcon.classList.remove('hidden');
      soundOffIcon.classList.add('hidden');
    } else {
      soundOnIcon.classList.add('hidden');
      soundOffIcon.classList.remove('hidden');
    }
  }

  // Toast Notification System
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span>${type === 'success' ? '✓' : type === 'error' ? '⚠️' : 'ℹ️'}</span>
      <span>${message}</span>
    `;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  // Helpers
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function getPeerName(peerId) {
    const peer = state.peers.find(p => p.id === peerId);
    return peer ? peer.name : 'Peer';
  }

  function triggerDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
})();
