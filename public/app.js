(() => {
  let state = { participants: [], items: [] };
  let selectedItemId = null;
  let isDrawing = false;
  let pollTimer = null;

  const el = (id) => document.getElementById(id);

  // ---------- API ----------
  async function api(path, options) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'エラーが発生しました');
    return data;
  }

  async function loadState() {
    state = await api('/api/state');
    if (selectedItemId && !state.items.find((i) => i.id === selectedItemId)) {
      selectedItemId = null;
    }
    if (!selectedItemId) {
      const firstOpen = state.items.find((i) => i.remainingSlots > 0);
      if (firstOpen) selectedItemId = firstOpen.id;
    }
    render();
  }

  function showToast(msg) {
    const t = el('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- Tabs ----------
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      el(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // ---------- Render ----------
  function render() {
    renderDrawScreen();
    renderSetupScreen();
  }

  function renderDrawScreen() {
    const remainingParticipants = state.participants.filter((p) => p.status === 'remaining');
    el('poolCount').textContent = `残り参加者: ${remainingParticipants.length}名 / 全${state.participants.length}名`;
    renderCageBalls(remainingParticipants.length);

    // item list
    const list = el('itemList');
    list.innerHTML = '';
    if (state.items.length === 0) {
      list.innerHTML = '<p class="empty-note">「準備」タブで抽選項目を追加してください</p>';
    }
    state.items.forEach((item) => {
      const row = document.createElement('li');
      row.className = 'item-row selectable';
      if (item.id === selectedItemId) row.classList.add('selected');
      if (item.remainingSlots <= 0) row.classList.add('full');

      const dots = Array.from({ length: item.quota })
        .map((_, i) => `<span class="slot-dot ${i < item.winners.length ? 'filled' : ''}"></span>`)
        .join('');

      row.innerHTML = `
        <div>
          <div class="item-name">${escapeHtml(item.name)}</div>
          <div class="item-meta">${item.winners.length} / ${item.quota} 名 決定</div>
        </div>
        <div class="slot-dots">${dots}</div>
      `;
      row.addEventListener('click', () => {
        if (isDrawing) return;
        selectedItemId = item.id;
        render();
      });
      list.appendChild(row);
    });

    // draw button state
    const selectedItem = state.items.find((i) => i.id === selectedItemId);
    const canDraw = !!selectedItem && selectedItem.remainingSlots > 0 && remainingParticipants.length > 0 && !isDrawing;
    el('drawBtn').disabled = !canDraw;
    el('drawBtn').textContent = selectedItem
      ? `「${selectedItem.name}」の抽選をまわす`
      : '抽選項目を選んでください';

    // results board
    const board = el('resultsBoard');
    board.innerHTML = '';
    if (state.items.length === 0) {
      board.innerHTML = '<p class="empty-note">まだ結果はありません</p>';
    }
    state.items.forEach((item) => {
      const group = document.createElement('div');
      group.className = 'result-group';
      const winnersHtml = item.winners.length
        ? `<ul>${item.winners.map((w) => `<li>${escapeHtml(w.name)}</li>`).join('')}</ul>`
        : '<p class="empty-note">まだ当選者なし</p>';
      group.innerHTML = `<h3>${escapeHtml(item.name)}（${item.winners.length}/${item.quota}）</h3>${winnersHtml}`;
      board.appendChild(group);
    });
  }

  function renderSetupScreen() {
    const itemChipList = el('itemChipList');
    itemChipList.innerHTML = '';
    state.items.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'item-edit-row';
      li.innerHTML = `
        <span class="item-edit-name">${escapeHtml(item.name)}</span>
        <span class="item-edit-progress">${item.winners.length}名決定</span>
        <label class="item-quota-label">定員
          <input type="number" class="item-quota-input" min="${Math.max(1, item.winners.length)}" value="${item.quota}" />
        </label>
        <button class="item-quota-save" type="button">更新</button>
        <button class="item-delete" type="button" title="削除">×</button>
      `;
      li.querySelector('.item-quota-save').addEventListener('click', async () => {
        const input = li.querySelector('.item-quota-input');
        const quota = Number(input.value);
        if (!Number.isInteger(quota) || quota <= 0) {
          showToast('定員は1以上の整数で入力してください');
          return;
        }
        try {
          state = await api(`/api/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ quota }) });
          render();
          showToast(`「${item.name}」の定員を${quota}名に更新しました`);
        } catch (e) { showToast(e.message); }
      });
      li.querySelector('.item-delete').addEventListener('click', async () => {
        if (!confirm(`「${item.name}」を削除しますか？（この項目の当選結果も取り消されます）`)) return;
        try {
          state = await api(`/api/items/${item.id}`, { method: 'DELETE' });
          render();
        } catch (e) { showToast(e.message); }
      });
      itemChipList.appendChild(li);
    });

    const participantChipList = el('participantChipList');
    participantChipList.innerHTML = '';
    state.participants.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'chip' + (p.status === 'won' ? ' won' : '');
      li.innerHTML = `<span>${escapeHtml(p.name)}</span><button title="削除">×</button>`;
      li.querySelector('button').addEventListener('click', async () => {
        try {
          state = await api(`/api/participants/${p.id}`, { method: 'DELETE' });
          render();
        } catch (e) { showToast(e.message); }
      });
      participantChipList.appendChild(li);
    });
  }

  function renderCageBalls(remainingCount) {
    if (window.Cage3D) window.Cage3D.setBallCount(remainingCount);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---------- Setup forms ----------
  el('itemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = el('itemName').value.trim();
    const quota = Number(el('itemQuota').value);
    if (!name || !quota) return;
    try {
      state = await api('/api/items', { method: 'POST', body: JSON.stringify({ name, quota }) });
      el('itemForm').reset();
      render();
    } catch (e) { showToast(e.message); }
  });

  el('participantForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = el('participantNames').value;
    const names = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) return;
    try {
      state = await api('/api/participants', { method: 'POST', body: JSON.stringify({ names }) });
      el('participantNames').value = '';
      render();
    } catch (e) { showToast(e.message); }
  });

  el('resetResultsBtn').addEventListener('click', async () => {
    if (!confirm('抽選結果をリセットします。参加者は全員「未抽選」に戻ります。よろしいですか？')) return;
    state = await api('/api/reset-results', { method: 'POST' });
    render();
    showToast('結果をリセットしました');
  });

  el('resetAllBtn').addEventListener('click', async () => {
    if (!confirm('項目・参加者・結果をすべて削除します。元に戻せません。よろしいですか？')) return;
    state = await api('/api/reset-all', { method: 'POST' });
    selectedItemId = null;
    render();
    showToast('すべてリセットしました');
  });

  // ---------- 結果のテキスト出力 ----------
  function generateResultText() {
    const lines = [];
    state.items.forEach((item) => {
      lines.push(item.name);
      if (item.winners.length === 0) {
        lines.push('　（まだ当選者なし）');
      } else {
        item.winners.forEach((w) => lines.push(`　・${w.name}`));
      }
    });
    return lines.join('\n');
  }

  el('exportTextBtn').addEventListener('click', () => {
    if (state.items.length === 0) {
      showToast('抽選項目がありません');
      return;
    }
    el('exportTextarea').value = generateResultText();
    el('exportPanel').hidden = false;
    el('exportPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  el('closeExportBtn').addEventListener('click', () => {
    el('exportPanel').hidden = true;
  });

  el('copyResultBtn').addEventListener('click', async () => {
    const text = el('exportTextarea').value;
    try {
      await navigator.clipboard.writeText(text);
      showToast('コピーしました');
    } catch (e) {
      // クリップボードAPIが使えない環境向けのフォールバック
      el('exportTextarea').select();
      document.execCommand('copy');
      showToast('コピーしました');
    }
  });

  el('downloadResultBtn').addEventListener('click', () => {
    const text = el('exportTextarea').value;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '抽選結果.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  // ---------- Sound effects (generated with Web Audio API, no files needed) ----------
  let audioCtx = null;
  let noiseBuffer = null;

  function getAudioCtx() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    return audioCtx;
  }

  function createNoiseBuffer(ctx, seconds) {
    const bufferSize = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // "ガラガラ" という抽選機の回転音（ノイズ + うなるようなフィルター変調）
  function startSpinSound() {
    try {
      const ctx = getAudioCtx();
      if (!ctx) return null;
      if (ctx.state === 'suspended') ctx.resume();
      if (!noiseBuffer) noiseBuffer = createNoiseBuffer(ctx, 2);

      const source = ctx.createBufferSource();
      source.buffer = noiseBuffer;
      source.loop = true;

      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.value = 650;
      bandpass.Q.value = 0.7;

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 7;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 280;
      lfo.connect(lfoGain);
      lfoGain.connect(bandpass.frequency);

      const gain = ctx.createGain();
      gain.gain.value = 0;

      source.connect(bandpass);
      bandpass.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      gain.gain.linearRampToValueAtTime(0.16, now + 0.2);

      source.start();
      lfo.start();

      return { source, gain, lfo, ctx };
    } catch (e) {
      return null;
    }
  }

  function stopSpinSound(handle) {
    if (!handle) return;
    try {
      const { source, gain, lfo, ctx } = handle;
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.2);
      setTimeout(() => {
        try { source.stop(); } catch (e) {}
        try { lfo.stop(); } catch (e) {}
      }, 250);
    } catch (e) {}
  }

  // 当選時の短いチャイム音
  function playRevealChime() {
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      [880, 1318.5].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const g = ctx.createGain();
        osc.connect(g);
        g.connect(ctx.destination);
        const start = now + i * 0.12;
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(0.22, start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
        osc.start(start);
        osc.stop(start + 0.55);
      });
    } catch (e) {}
  }

  // ---------- Draw animation ----------
  const SPIN_DURATION_MS = 3400;

  el('drawBtn').addEventListener('click', async () => {
    const item = state.items.find((i) => i.id === selectedItemId);
    const remainingParticipants = state.participants.filter((p) => p.status === 'remaining');
    if (!item || remainingParticipants.length === 0 || isDrawing) return;

    isDrawing = true;
    el('drawBtn').disabled = true;
    el('winnerStage').innerHTML = '';

    const cyclingBall = el('cyclingBall');
    const cyclingName = el('cyclingName');
    cyclingBall.classList.remove('revealed');
    if (window.Cage3D) window.Cage3D.startSpin();

    const soundHandle = startSpinSound();

    // start the API call in parallel with the spinning animation
    const drawPromise = api(`/api/draw/${item.id}`, { method: 'POST' }).catch((err) => ({ error: err.message }));

    await cycleNames(remainingParticipants, cyclingName, SPIN_DURATION_MS);

    const result = await drawPromise;
    if (window.Cage3D) window.Cage3D.stopSpin();
    stopSpinSound(soundHandle);

    if (result.error) {
      cyclingName.textContent = '?';
      showToast(result.error);
      isDrawing = false;
      await loadState();
      return;
    }

    cyclingName.textContent = result.winner.name;
    cyclingBall.classList.add('revealed');
    showWinnerCard(result.winner.name, item.name);
    launchConfetti();
    playRevealChime();

    state = result.state;
    isDrawing = false;
    render();
  });

  function cycleNames(pool, targetEl, totalMs) {
    return new Promise((resolve) => {
      const start = performance.now();
      let lastTick = 0;

      function frame(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / totalMs, 1);
        // ease out: interval grows from ~55ms to ~260ms as progress -> 1
        const interval = 55 + Math.pow(progress, 2) * 260;

        if (now - lastTick >= interval) {
          const random = pool[Math.floor(Math.random() * pool.length)];
          targetEl.textContent = random ? random.name : '?';
          lastTick = now;
        }

        if (elapsed < totalMs) {
          requestAnimationFrame(frame);
        } else {
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  function showWinnerCard(name, itemName) {
    const stage = el('winnerStage');
    stage.innerHTML = `
      <div class="winner-card">
        🎉 ${escapeHtml(itemName)} 🎉
        <span class="winner-item-label">${escapeHtml(name)} さんが決定！</span>
      </div>
    `;
  }

  function launchConfetti() {
    const colors = ['#F2B705', '#E1483C', '#F6F1E4', '#5B6BE0'];
    for (let i = 0; i < 40; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDuration = 1.6 + Math.random() * 1.2 + 's';
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), 3200);
    }
  }

  // ---------- Polling (for viewers on other PCs to stay in sync) ----------
  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (!isDrawing) loadState().catch(() => {});
    }, 3000);
  }

  if (window.Cage3D) window.Cage3D.init(el('cageCanvas'));

  loadState().then(startPolling);
})();
