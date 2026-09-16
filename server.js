const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- helpers ----
function getState() {
  const participants = db.prepare('SELECT * FROM participants ORDER BY id').all();
  const items = db.prepare('SELECT * FROM items ORDER BY id').all();
  const results = db.prepare('SELECT * FROM results ORDER BY id').all();

  const itemsWithWinners = items.map((item) => {
    const winners = results
      .filter((r) => r.item_id === item.id)
      .map((r) => {
        const p = participants.find((pp) => pp.id === r.participant_id);
        return { id: r.participant_id, name: p ? p.name : '(削除済み)', drawn_at: r.drawn_at };
      });
    return { ...item, winners, remainingSlots: item.quota - winners.length };
  });

  return { participants, items: itemsWithWinners };
}

// ---- API ----

// 全体の状態を取得
app.get('/api/state', (req, res) => {
  res.json(getState());
});

// 参加者を追加（複数行まとめて追加可）
app.post('/api/participants', (req, res) => {
  const { names } = req.body;
  if (!Array.isArray(names) || names.length === 0) {
    return res.status(400).json({ error: 'names must be a non-empty array' });
  }
  const insert = db.prepare('INSERT INTO participants (name) VALUES (?)');
  const insertMany = db.transaction((list) => {
    for (const n of list) {
      const trimmed = String(n).trim();
      if (trimmed) insert.run(trimmed);
    }
  });
  insertMany(names);
  res.json(getState());
});

// 参加者を削除（当選済みでない場合のみ）
app.delete('/api/participants/:id', (req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare('SELECT * FROM participants WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ error: 'not found' });
  if (p.status === 'won') {
    return res.status(400).json({ error: '当選済みの参加者は削除できません（結果をリセットしてください）' });
  }
  db.prepare('DELETE FROM participants WHERE id = ?').run(id);
  res.json(getState());
});

// 抽選項目（グループ）を追加
app.post('/api/items', (req, res) => {
  const { name, quota } = req.body;
  if (!name || !Number.isInteger(quota) || quota <= 0) {
    return res.status(400).json({ error: 'name and positive integer quota are required' });
  }
  db.prepare('INSERT INTO items (name, quota) VALUES (?, ?)').run(String(name).trim(), quota);
  res.json(getState());
});

// 抽選項目の定員を更新
app.patch('/api/items/:id', (req, res) => {
  const id = Number(req.params.id);
  const { quota } = req.body;
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!item) return res.status(404).json({ error: 'not found' });
  if (!Number.isInteger(quota) || quota <= 0) {
    return res.status(400).json({ error: '定員は1以上の整数で指定してください' });
  }
  const wonCount = db.prepare('SELECT COUNT(*) c FROM results WHERE item_id = ?').get(id).c;
  if (quota < wonCount) {
    return res.status(400).json({ error: `すでに${wonCount}名が当選しているため、定員は${wonCount}以上にしてください` });
  }
  db.prepare('UPDATE items SET quota = ? WHERE id = ?').run(quota, id);
  res.json(getState());
});

// 抽選項目を削除（結果も一緒に削除し、参加者はプールに戻す）
app.delete('/api/items/:id', (req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!item) return res.status(404).json({ error: 'not found' });

  const tx = db.transaction(() => {
    const results = db.prepare('SELECT * FROM results WHERE item_id = ?').all(id);
    const revert = db.prepare("UPDATE participants SET status = 'remaining' WHERE id = ?");
    for (const r of results) revert.run(r.participant_id);
    db.prepare('DELETE FROM results WHERE item_id = ?').run(id);
    db.prepare('DELETE FROM items WHERE id = ?').run(id);
  });
  tx();
  res.json(getState());
});

// 抽選を1回実行
// 山下と諏訪は必ず同じ抽選項目になる
app.post('/api/draw/:itemId', (req, res) => {
  const itemId = Number(req.params.itemId);
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);

  if (!item) {
    return res.status(404).json({ error: 'item not found' });
  }

  const wonCount = db
    .prepare('SELECT COUNT(*) c FROM results WHERE item_id = ?')
    .get(itemId).c;

  if (wonCount >= item.quota) {
    return res.status(400).json({
      error: 'この項目はすでに定員に達しています'
    });
  }

  // 未抽選の参加者
  let remaining = db
    .prepare("SELECT * FROM participants WHERE status = 'remaining'")
    .all();

  if (remaining.length === 0) {
    return res.status(400).json({
      error: '抽選できる参加者が残っていません'
    });
  }

  // 山下・諏訪の情報
  const yamashita = db
    .prepare("SELECT * FROM participants WHERE name = '山下'")
    .get();

  const suwa = db
    .prepare("SELECT * FROM participants WHERE name = '諏訪'")
    .get();

  // 山下がすでに当選している項目
  const yamashitaResult = yamashita
    ? db.prepare(
        'SELECT * FROM results WHERE participant_id = ?'
      ).get(yamashita.id)
    : null;

  // 諏訪がすでに当選している項目
  const suwaResult = suwa
    ? db.prepare(
        'SELECT * FROM results WHERE participant_id = ?'
      ).get(suwa.id)
    : null;

  // ------------------------------------------------
  // 山下が先に当選済みの場合
  // 諏訪は山下と同じ項目でしか抽選されない
  // ------------------------------------------------
  if (
    yamashitaResult &&
    suwa &&
    suwa.status === 'remaining' &&
    yamashitaResult.item_id !== itemId
  ) {
    remaining = remaining.filter((p) => p.name !== '諏訪');
  }

  // ------------------------------------------------
  // 諏訪が先に当選済みの場合
  // 山下は諏訪と同じ項目でしか抽選されない
  // ------------------------------------------------
  if (
    suwaResult &&
    yamashita &&
    yamashita.status === 'remaining' &&
    suwaResult.item_id !== itemId
  ) {
    remaining = remaining.filter((p) => p.name !== '山下');
  }

  // ------------------------------------------------
  // 2人とも未抽選の場合
  // 残り1枠の項目には山下・諏訪を入れない
  // ------------------------------------------------
  const remainingSlots = item.quota - wonCount;

  if (
    !yamashitaResult &&
    !suwaResult &&
    yamashita &&
    suwa &&
    yamashita.status === 'remaining' &&
    suwa.status === 'remaining' &&
    remainingSlots < 2
  ) {
    remaining = remaining.filter(
      (p) => p.name !== '山下' && p.name !== '諏訪'
    );
  }

  if (remaining.length === 0) {
    return res.status(400).json({
      error: 'この項目で抽選できる参加者がいません'
    });
  }

  // ------------------------------------------------
  // 同じ項目に片方が当選済みで、
  // この項目が残り1枠なら相方を確定
  // ------------------------------------------------

  let winner;

  if (
    yamashitaResult &&
    yamashitaResult.item_id === itemId &&
    suwa &&
    suwa.status === 'remaining' &&
    remainingSlots === 1
  ) {
    winner = suwa;

  } else if (
    suwaResult &&
    suwaResult.item_id === itemId &&
    yamashita &&
    yamashita.status === 'remaining' &&
    remainingSlots === 1
  ) {
    winner = yamashita;

  } else {
    // 通常のランダム抽選
    winner =
      remaining[Math.floor(Math.random() * remaining.length)];
  }

  // 当選者は1人だけ登録
  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO results (item_id, participant_id) VALUES (?, ?)'
    ).run(itemId, winner.id);

    db.prepare(
      "UPDATE participants SET status = 'won' WHERE id = ?"
    ).run(winner.id);
  });

  tx();

  res.json({
    winner: {
      id: winner.id,
      name: winner.name
    },
    state: getState()
  });
});

// 抽選結果だけリセット（参加者・項目はそのまま、全員プールに戻す）
app.post('/api/reset-results', (req, res) => {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM results').run();
    db.prepare("UPDATE participants SET status = 'remaining'").run();
  });
  tx();
  res.json(getState());
});

// 全データを完全リセット
app.post('/api/reset-all', (req, res) => {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM results').run();
    db.prepare('DELETE FROM participants').run();
    db.prepare('DELETE FROM items').run();
  });
  tx();
  res.json(getState());
});

const PORT = process.env.PORT || 3000;
// 0.0.0.0 で待ち受けることで、同じネットワーク内の他のPC/スマホからも
// http://<このPCのIPアドレス>:3000 でアクセスできる
app.listen(PORT, '0.0.0.0', () => {
  console.log(`抽選アプリ起動: http://localhost:${PORT}`);
});
