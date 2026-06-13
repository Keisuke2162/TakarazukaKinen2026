import { useRef, useEffect, useCallback, useState } from 'react';
import { getWakuStyle, gaussianRandom } from '../utils/horseUtils';

const W = 780, H = 420;

// 阪神競馬場の形状（不等辺の楕円・右回り）
// 西側（左）は尖り、東側（右）は丸く広い卵型
const TR = {
  xL: 120,     // 左ストレート x
  xR: 580,     // 右ストレート x
  yT: 95,      // 上ストレート y
  yB: 295,     // 下ストレート y
  rWx: 80,     // 西側カーブ x半径（小さく尖り気味）
  rEx: 165,    // 東側カーブ x半径（広く丸い）
};
const TR_yMid = (TR.yB + TR.yT) / 2;
const TR_rY = (TR.yB - TR.yT) / 2; // カーブの縦半径
const TR_HALF_W = 28;              // コース半幅(px)
const GOAL_X = TR.xL + (TR.xR - TR.xL) * 0.30; // ゴール線位置（下ストレートのやや左寄り）
const LANE_PX = 4;                  // 馬番ごとの内外オフセット倍率

// セグメント長（px、進捗距離の比例計算用）
const L1 = GOAL_X - TR.xL;                          // 下ストレート: GOAL → 西カーブ入口（左へ）
const L2 = Math.PI * (TR.rWx + TR_rY) / 2;          // 西半周（楕円弧近似）
const L3 = TR.xR - TR.xL;                           // 上ストレート（右へ）
const L4 = Math.PI * (TR.rEx + TR_rY) / 2;          // 東半周
const L5 = TR.xR - GOAL_X;                          // 下ストレート: 東カーブ出口 → GOAL（左へ）
const L_TOTAL = L1 + L2 + L3 + L4 + L5;

// 右回り（時計回り）の単一周回コース上の位置を返す
function trackPt(prog, lane = 0) {
  let s = ((prog % 1) + 1) % 1 * L_TOTAL; // [0, L_TOTAL)
  const off = lane * LANE_PX;

  // 1) 下ストレート（GOAL → 西カーブ入口、左方向）
  if (s < L1) {
    const x = GOAL_X - s; // 左へ進む
    // 法線方向（外側＝下方向）。内側のlaneは負＝yB上、外側は正＝yB下
    return { x, y: TR.yB + off };
  }
  s -= L1;

  // 2) 西半周（左へ膨らむ。下→左→上）
  if (s < L2) {
    const t = s / L2;
    const ang = Math.PI / 2 + t * Math.PI; // 90°→270°（経由：180°＝最左）
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);
    const x = TR.xL + (TR.rWx + off) * cosA;
    const y = TR_yMid + (TR_rY + off) * sinA;
    return { x, y };
  }
  s -= L2;

  // 3) 上ストレート（左 → 右、つまりバックストレッチ）
  if (s < L3) {
    const x = TR.xL + s;
    // 法線（外側＝上方向、負側）
    return { x, y: TR.yT - off };
  }
  s -= L3;

  // 4) 東半周（右へ膨らむ。上→右→下）
  if (s < L4) {
    const t = s / L4;
    const ang = -Math.PI / 2 + t * Math.PI; // -90°→90°（経由：0°＝最右）
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);
    const x = TR.xR + (TR.rEx + off) * cosA;
    const y = TR_yMid + (TR_rY + off) * sinA;
    return { x, y };
  }
  s -= L4;

  // 5) 下ストレート（東カーブ出口 → GOAL、左方向）
  const x = TR.xR - s;
  return { x, y: TR.yB + off };
}

// コース外形をパスとして描画する（offsetはセンターラインからの外向き距離）
function tracePath(ctx, offset) {
  ctx.beginPath();
  // 下ストレート（GOALの東側から右端へ）
  ctx.moveTo(GOAL_X, TR.yB + offset);
  ctx.lineTo(TR.xR, TR.yB + offset);
  // 東カーブ（下→右→上、右に膨らむ）
  ctx.ellipse(TR.xR, TR_yMid, TR.rEx + offset, TR_rY + offset, 0, Math.PI / 2, -Math.PI / 2, true);
  // 上ストレート（右端から左端へ）
  ctx.lineTo(TR.xL, TR.yT - offset);
  // 西カーブ（上→左→下、左に膨らむ）
  ctx.ellipse(TR.xL, TR_yMid, TR.rWx + offset, TR_rY + offset, 0, -Math.PI / 2, Math.PI / 2, true);
  // 下ストレート左半分（GOALに戻る）
  ctx.lineTo(GOAL_X, TR.yB + offset);
  ctx.closePath();
}

// 脚質×フェーズ×ペースの3軸でスピード補正
const STYLE_INIT = { front: 0.012, stalker: 0.005, mid: 0, closer: -0.005 };

function styleMult(style, leaderProg, pace = 'mid') {
  const early = leaderProg < 0.20;
  const final = leaderProg > 0.72;

  if (style === 'front') {
    if (early) return 1.10;
    if (final) return pace === 'high' ? 0.86 : pace === 'slow' ? 0.99 : 0.93;
    return 0.99;
  }
  if (style === 'stalker') {
    if (early) return 1.05;
    if (final) return pace === 'high' ? 0.94 : pace === 'slow' ? 1.02 : 0.97;
    return 1.00;
  }
  if (style === 'mid') {
    if (early) return 0.96;
    if (final) return pace === 'high' ? 1.07 : pace === 'slow' ? 1.02 : 1.05;
    return 1.00;
  }
  if (style === 'closer') {
    if (early) return 0.91;
    if (final) return pace === 'high' ? 1.14 : pace === 'slow' ? 1.02 : 1.09;
    return 0.97;
  }
  return 1;
}

function makeSimHorses(horses, forcedWinner, maxStr, minStr, aiAnalysis) {
  const range = maxStr - minStr || 1;
  const adjustMap = {};
  (aiAnalysis?.key_horses || []).forEach((k) => {
    adjustMap[String(k.umaban)] = k.adjustment;
  });

  return horses.map((h) => {
    const norm = (h.strength - minStr) / range;
    const lane = (parseInt(h.umaban) - 9.5) / 9.5 * 2.2;
    const aiAdjust = adjustMap[String(h.umaban)] ?? 0;
    const bSpeed = (0.148 + norm * 0.052) * (1 + aiAdjust);
    const isForcedWinner = String(forcedWinner) && String(forcedWinner) === String(h.umaban);
    const initProg = STYLE_INIT[h.style] ?? 0;
    return {
      ...h,
      lane,
      baseSpeed: isForcedWinner ? 0.215 : bSpeed,
      speed: 0,
      progress: initProg,
      finished: false,
      finishRank: null,
      trail: [],
    };
  });
}

const PACE_LABEL = { high: 'ハイペース', mid: 'ミドルペース', slow: 'スローペース' };
const PACE_COLOR = { high: '#F87171', mid: '#FBBF24', slow: '#86EFAC' };

export default function Simulator({ horses, maxStr, minStr }) {
  const cvRef = useRef(null);
  const stateRef = useRef({ running: false, horses: [], finishCount: 0, lastTs: null, afId: null });
  const [forcedWinner, setForcedWinner] = useState('');
  const [status, setStatus] = useState('');
  const [results, setResults] = useState([]);
  const [started, setStarted] = useState(false);

  // AI Analysis state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  // 直近のレースで AI モードを使ったか（結果表示の出し分けに使う）
  const [lastModeAi, setLastModeAi] = useState(false);
  // レース完了済みフラグ（結果セクション表示用）
  const [raceCompleted, setRaceCompleted] = useState(false);

  const drawTrack = useCallback((ctx) => {
    ctx.clearRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#080e1a');
    grad.addColorStop(1, '#0d1117');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 外側ダート
    tracePath(ctx, TR_HALF_W + 5);
    ctx.fillStyle = '#5a3a15';
    ctx.fill();

    // 芝コース
    tracePath(ctx, TR_HALF_W);
    ctx.fillStyle = '#2a6430';
    ctx.fill();

    // 内側フィールド（埋芝）— 外側の塗りを上書きで「コース幅」を作る
    tracePath(ctx, -TR_HALF_W);
    ctx.fillStyle = '#1e5a28';
    ctx.fill();

    // 外ラチ
    tracePath(ctx, TR_HALF_W + 1);
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 内ラチ
    tracePath(ctx, -TR_HALF_W);
    ctx.strokeStyle = 'rgba(255,255,255,.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // GOAL ライン
    ctx.beginPath();
    ctx.moveTo(GOAL_X, TR.yB - TR_HALF_W);
    ctx.lineTo(GOAL_X, TR.yB + TR_HALF_W);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();

    // GOAL ラベル
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GOAL', GOAL_X, TR.yB + TR_HALF_W + 14);

    // 中央のレース名
    ctx.fillStyle = 'rgba(255,215,0,.78)';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('宝塚記念 2026 GI', (TR.xL + TR.xR) / 2, TR_yMid - 4);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.font = '11px sans-serif';
    ctx.fillText('阪神競馬場 芝2200m 右回り', (TR.xL + TR.xR) / 2, TR_yMid + 14);

    // 右回り表示（上ストレッチに矢印）
    ctx.fillStyle = 'rgba(255,215,0,.85)';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('→ 右回り', TR.xR - 130, TR.yT - 8);

    // スタンド
    ctx.fillStyle = '#131325';
    ctx.fillRect(GOAL_X - 70, H - 22, 140, 22);
    ctx.fillStyle = '#1a1a40';
    for (let i = 0; i < 6; i++) ctx.fillRect(GOAL_X - 64 + i * 22, H - 34, 16, 14);
  }, []);

  const drawHorses = useCallback((ctx, simHorses, inGate = false) => {
    const sorted = [...simHorses].sort((a, b) => a.progress - b.progress);
    sorted.forEach((h) => {
      const prog = inGate ? 0 : Math.min(h.progress, 1.0);
      const pt = trackPt(prog, h.lane);
      const ws = getWakuStyle(h.waku);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 13, 0, Math.PI * 2);
      ctx.fillStyle = ws.bg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = ws.fg;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(h.umaban, pt.x, pt.y);
    });
    ctx.textBaseline = 'alphabetic';
  }, []);

  const drawRanking = useCallback((ctx, simHorses) => {
    const sorted = [...simHorses].sort((a, b) => b.progress - a.progress);
    // 右下（東カーブ外の空きスペース）に表示
    const PX = W - 158;
    const PY = H - 132;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.72)';
    ctx.fillRect(PX, PY, 150, 118);
    ctx.font = 'bold 10px sans-serif';
    ctx.fillStyle = 'rgba(255,215,0,.85)';
    ctx.textAlign = 'left';
    ctx.fillText('LIVE RANKING', PX + 8, PY + 17);
    const rankC = ['#FFD700', '#C0C0C0', '#CD853F', '#ccc', '#aaa', '#888'];
    sorted.slice(0, 6).forEach((h, i) => {
      const y = PY + 33 + i * 13;
      const ws = getWakuStyle(h.waku);
      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = rankC[i] || '#888';
      ctx.textAlign = 'left';
      ctx.fillText(`${i + 1}位`, PX + 8, y);
      ctx.fillStyle = ws.bg;
      ctx.fillRect(PX + 33, y - 10, 15, 12);
      ctx.fillStyle = ws.fg;
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(h.umaban, PX + 40, y);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ddd';
      ctx.font = '10px sans-serif';
      const name = h.horse_name.length > 6 ? h.horse_name.slice(0, 6) + '…' : h.horse_name;
      ctx.fillText(name, PX + 51, y);
    });
    ctx.restore();
  }, []);

  const initCanvas = useCallback(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const st = stateRef.current;
    st.horses = makeSimHorses(horses, forcedWinner, maxStr, minStr, aiAnalysis);
    drawTrack(ctx);
    drawHorses(ctx, st.horses, true);
  }, [horses, forcedWinner, maxStr, minStr, aiAnalysis, drawTrack, drawHorses]);

  useEffect(() => { initCanvas(); }, [initCanvas]);

  const reset = useCallback(() => {
    const st = stateRef.current;
    if (st.afId) { cancelAnimationFrame(st.afId); st.afId = null; }
    st.running = false;
    st.lastTs = null;
    st.finishCount = 0;
    setStatus('');
    setResults([]);
    setStarted(false);
    setRaceCompleted(false);
    initCanvas();
  }, [initCanvas]);

  // analysisOverride を渡すとそれを使う、null ならロジックのみ
  const start = useCallback((analysisOverride = null) => {
    const st = stateRef.current;
    if (st.running) return;

    const analysisForSim = analysisOverride;
    st.running = true;
    st.finishCount = 0;
    st.lastTs = null;
    setStarted(true);
    setStatus(analysisForSim ? '🤖 AI予想でレース中...' : '🎲 ロジックでレース中...');
    setResults([]);
    setLastModeAi(!!analysisForSim);
    setRaceCompleted(false);

    const pace = analysisForSim?.pace ?? 'mid';
    st.horses = makeSimHorses(horses, forcedWinner, maxStr, minStr, analysisForSim);
    st.horses.forEach((h) => {
      h.speed = h.baseSpeed + gaussianRandom() * 0.013;
      if (String(forcedWinner) && String(forcedWinner) === String(h.umaban))
        h.speed = 0.21 + Math.abs(gaussianRandom() * 0.007);
      h.progress = STYLE_INIT[h.style] ?? 0;
      h.finished = false;
      h.trail = [];
    });

    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');

    function frame(ts) {
      if (!st.running) return;
      if (!st.lastTs) st.lastTs = ts;
      const dt = Math.min((ts - st.lastTs) / 1000, 0.05);
      st.lastTs = ts;

      const leaderProg = Math.max(...st.horses.map((h) => h.progress));

      st.horses.forEach((h) => {
        if (h.finished) return;
        h.progress += h.speed * styleMult(h.style, leaderProg, pace) * (1 + gaussianRandom() * 0.008) * dt;
        const pt = trackPt(Math.min(h.progress, 1), h.lane);
        h.trail.push({ x: pt.x, y: pt.y });
        if (h.trail.length > 9) h.trail.shift();
        if (h.progress >= 1 && !h.finished) {
          h.finished = true;
          h.finishRank = ++st.finishCount;
        }
      });

      drawTrack(ctx);
      st.horses.forEach((h) => {
        if (h.trail.length < 2) return;
        const ws = getWakuStyle(h.waku);
        ctx.beginPath();
        ctx.moveTo(h.trail[0].x, h.trail[0].y);
        h.trail.forEach((p, i) => { if (i) ctx.lineTo(p.x, p.y); });
        ctx.strokeStyle = ws.bg + '50';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
      });
      drawHorses(ctx, st.horses, false);
      drawRanking(ctx, st.horses);

      if (st.finishCount >= st.horses.length) {
        st.running = false;
        const sorted = [...st.horses].sort((a, b) => (a.finishRank || 99) - (b.finishRank || 99));
        setResults(sorted);
        setStatus('🏁 レース終了');
        setStarted(false);
        setRaceCompleted(true);
        return;
      }
      st.afId = requestAnimationFrame(frame);
    }
    st.afId = requestAnimationFrame(frame);
  }, [horses, forcedWinner, maxStr, minStr, drawTrack, drawHorses, drawRanking]);

  // AI予想を取得（既に取得済みならスキップ）
  const fetchAiIfNeeded = useCallback(async () => {
    if (aiAnalysis) return aiAnalysis;
    setAiLoading(true);
    setAiError(null);
    try {
      const resp = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          horses: horses.map((h) => ({
            umaban: h.umaban,
            horse_name: h.horse_name,
            barei: h.barei,
            kinryo: h.kinryo,
            jockey_name: h.jockey_name,
            trainer_name: h.trainer_name,
            style: h.style,
            results: h.results,
          })),
          raceInfo: {
            name: '宝塚記念',
            venue: '阪神競馬場',
            surface: '芝',
            distance: 2200,
            date: '2026年6月28日',
          },
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      setAiAnalysis(data.analysis);
      return data.analysis;
    } catch (e) {
      setAiError(e.message);
      return null;
    } finally {
      setAiLoading(false);
    }
  }, [aiAnalysis, horses]);

  const startWithAi = useCallback(async () => {
    const analysis = await fetchAiIfNeeded();
    if (analysis) start(analysis);
  }, [fetchAiIfNeeded, start]);

  const RANK_ICONS = ['🥇', '🥈', '🥉'];

  return (
    <div className="sim-layout">
      {/* 左：コース図 + 操作 */}
      <div className="sim-left">
        <div className="panel-head">
          <h2 className="section-title">🏇 コース図</h2>
          {status && <span className="status-txt">{status}</span>}
          {aiError && <span style={{ color: '#F87171', fontSize: 13 }}>エラー: {aiError}</span>}
        </div>
        <div className="canvas-wrap">
          <canvas ref={cvRef} width={W} height={H} />
        </div>
        <div className="ctrl-bar" style={{ marginTop: 12, marginBottom: 0 }}>
          <label>
            勝ち馬指定：
            <select value={forcedWinner} onChange={(e) => setForcedWinner(e.target.value)} disabled={started}>
              <option value="">指定なし</option>
              {horses.map((h) => (
                <option key={h.umaban} value={h.umaban}>
                  {h.umaban}番 {h.horse_name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn-secondary"
            onClick={() => start(null)}
            disabled={started || aiLoading}
            style={{ borderColor: '#8b949e' }}
          >
            🎲 ロジックでシミュレート
          </button>
          <button
            className="btn-primary"
            onClick={startWithAi}
            disabled={started || aiLoading}
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
          >
            {aiLoading ? '🤖 AI分析中...' : '🤖 AI予想でシミュレート'}
          </button>
          <button className="btn-secondary" onClick={reset} disabled={started}>リセット</button>
        </div>
      </div>

      {/* 右：シミュレーション結果 */}
      <div className="sim-right">
        <div className="panel-head">
          <h2 className="section-title">🏁 シミュレーション結果</h2>
          {raceCompleted && (
            <span
              style={{
                fontSize: 11,
                padding: '3px 10px',
                borderRadius: 999,
                background: lastModeAi ? 'rgba(139,92,246,.2)' : 'rgba(139,148,158,.2)',
                color: lastModeAi ? '#a78bfa' : '#8b949e',
                fontWeight: 600,
              }}
            >
              {lastModeAi ? '🤖 AI予想' : '🎲 ロジック'}
            </span>
          )}
        </div>

        {!raceCompleted && (
          <div className="results-placeholder">
            {aiLoading
              ? '🤖 Claude にレース展開を分析させています...'
              : started
              ? 'レースをシミュレーション中です...'
              : '左の「ロジック」または「AI予想」ボタンを押すとシミュレーションが始まります'}
          </div>
        )}

        {raceCompleted && results.length > 0 && (
          <div className="ranking-list">
            {results.map((h, i) => {
              const ws = getWakuStyle(h.waku);
              const isPodium = i < 3;
              return (
                <div key={h.umaban} className={'ranking-row' + (isPodium ? ' podium' : '')}>
                  <span className={`rank-num ${isPodium ? `rk${i + 1}` : ''}`}>
                    {isPodium ? RANK_ICONS[i] : `${i + 1}位`}
                  </span>
                  <span className="chip" style={{ background: ws.bg, color: ws.fg }}>{h.umaban}</span>
                  <span className="ranking-name">{h.horse_name}</span>
                  <span className="ranking-jockey">{h.jockey_name}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* AI分析パネル（AIモード時のみ） */}
        {raceCompleted && lastModeAi && aiAnalysis && (
          <details className="ai-details" open>
            <summary>
              🤖 Claude の展開分析
              <span
                style={{
                  marginLeft: 8,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: PACE_COLOR[aiAnalysis.pace] + '33',
                  color: PACE_COLOR[aiAnalysis.pace],
                  fontWeight: 700,
                  fontSize: 11,
                }}
              >
                {PACE_LABEL[aiAnalysis.pace]}
              </span>
            </summary>
            <div className="ai-details-body">
              <div>
                <div className="section-label">ペース予想の根拠</div>
                <div style={{ fontSize: 12, lineHeight: 1.6 }}>{aiAnalysis.pace_reason}</div>
              </div>
              <div>
                <div className="section-label">予想展開</div>
                <div style={{ fontSize: 12, lineHeight: 1.6 }}>{aiAnalysis.development}</div>
              </div>
              <div>
                <div className="section-label">本命候補</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {aiAnalysis.favorites.map((u, i) => {
                    const h = horses.find((x) => Number(x.umaban) === Number(u));
                    if (!h) return null;
                    const ws = getWakuStyle(h.waku);
                    return (
                      <span key={u} className="rcard" style={{ padding: '3px 8px', fontSize: 12 }}>
                        <span style={{ color: '#FFD700', fontWeight: 700 }}>{i + 1}.</span>
                        <span
                          className="chip"
                          style={{ background: ws.bg, color: ws.fg, width: 20, height: 20, fontSize: 10 }}
                        >
                          {h.umaban}
                        </span>
                        <span style={{ fontSize: 11 }}>{h.horse_name}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="section-label">注目馬の補正</div>
                <div style={{ display: 'grid', gap: 4 }}>
                  {aiAnalysis.key_horses.map((k) => {
                    const h = horses.find((x) => Number(x.umaban) === Number(k.umaban));
                    if (!h) return null;
                    const ws = getWakuStyle(h.waku);
                    const positive = k.adjustment >= 0;
                    return (
                      <div
                        key={k.umaban}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 6,
                          fontSize: 11,
                          padding: '4px 0',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <span
                          className="chip"
                          style={{ background: ws.bg, color: ws.fg, width: 22, height: 22, fontSize: 10, flexShrink: 0 }}
                        >
                          {k.umaban}
                        </span>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                            <span style={{ fontWeight: 600 }}>{h.horse_name}</span>
                            <span
                              style={{
                                color: positive ? '#86EFAC' : '#F87171',
                                fontWeight: 700,
                                fontFamily: 'monospace',
                              }}
                            >
                              {positive ? '+' : ''}{(k.adjustment * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div style={{ color: 'var(--muted)' }}>{k.reason}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
