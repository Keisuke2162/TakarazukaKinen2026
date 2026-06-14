import { useRef, useEffect, useCallback, useState } from 'react';
import { getWakuStyle, gaussianRandom } from '../utils/horseUtils';

const W = 780, H = 420;

// ─── 阪神競馬場のコース画像にあわせたパス定義 ───────
// 画像 (public/hanshin-course.jpeg) を背景に描画し、その上を馬が走る
// 画像内の S=スタート / G=ゴール の位置に合わせてキー点を採取
// 画像 617x341 → Canvas 780x420 (scale x ≈ 1.264, y ≈ 1.232)
// 画像内の「黄色いライン」(内回り＋外回り間に走る黄ライン) 上の座標を採取
const PT = {
  S:         { x: 700, y: 392 },  // スタート（右下青S印、image (553, 318)）
  chuteJoin: { x: 587, y: 338 },  // 黄ライン右端＝チュート合流点 image (465, 275)
  G:         { x: 209, y: 338 },  // ゴール（赤G印の真下、黄ライン上）image (165, 275)
  bottomL:   { x: 145, y: 338 },  // 下ストレート左端（黄ライン）image (115, 275)
  topL:      { x: 145, y: 105 },  // 上ストレート左端（黄ライン）image (115, 85)
  topR:      { x: 587, y: 68 },   // 上ストレート右端（黄ライン）image (465, 55)
};
// 黄ラインの西カーブ／東カーブの半楕円パラメータ
// 西カーブ: 黄ライン左端は image x≈55 (canvas≈70)
const WEST = { cx: 145, cy: 221.5, rx: 75,  ry: 116.5 };
// 東カーブ: 黄ライン右端は image x≈575 (canvas≈727)
const EAST = { cx: 587, cy: 203,   rx: 140, ry: 135 };

const LANE_PX = 3; // 馬番ごとの内外オフセット倍率（コース幅が狭いので控えめに）

// セグメント長（px、進捗距離の比例計算用）
const L_CHUTE = Math.hypot(PT.S.x - PT.chuteJoin.x, PT.S.y - PT.chuteJoin.y);
const L_B1 = PT.chuteJoin.x - PT.G.x;                          // 下ストレート: 合流点 → G（最初の通過）
const L_B2 = PT.G.x - PT.bottomL.x;                            // 下ストレート: G → 西カーブ入口
const L_W  = Math.PI * (WEST.rx + WEST.ry) / 2;                // 西半周
const L_T  = Math.hypot(PT.topR.x - PT.topL.x, PT.topR.y - PT.topL.y); // 上ストレート（やや斜め）
const L_E  = Math.PI * (EAST.rx + EAST.ry) / 2;                // 東半周
const L_B3 = PT.chuteJoin.x - PT.G.x;                          // 下ストレート: 合流点 → G（ゴール）
const L_TOTAL = L_CHUTE + L_B1 + L_B2 + L_W + L_T + L_E + L_B3;

// prog 0 = スタート(S), prog 1 = ゴール(G) で右回り1周
function trackPt(prog, lane = 0) {
  let s = Math.max(0, Math.min(1, prog)) * L_TOTAL;
  const off = lane * LANE_PX;

  // 直線セグメント: 進行方向の右側を法線とし、外側を表す
  const straightSeg = (p1, p2, t) => {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    const nx = dy / len, ny = -dx / len; // 進行方向の右側 = コース外側
    return { x: p1.x + t * dx + off * nx, y: p1.y + t * dy + off * ny };
  };

  // 1) チュート: S → 合流点（左斜め上へ）
  if (s < L_CHUTE) return straightSeg(PT.S, PT.chuteJoin, s / L_CHUTE);
  s -= L_CHUTE;

  // 2) 下ストレート: 合流点 → G（左方向、ゴールを最初に通過）
  if (s < L_B1) return straightSeg(PT.chuteJoin, PT.G, s / L_B1);
  s -= L_B1;

  // 3) 下ストレート: G → 西カーブ入口
  if (s < L_B2) return straightSeg(PT.G, PT.bottomL, s / L_B2);
  s -= L_B2;

  // 4) 西半周（左に膨らむ）: 下→左→上
  if (s < L_W) {
    const t = s / L_W;
    const ang = Math.PI / 2 + t * Math.PI;
    const c = Math.cos(ang), si = Math.sin(ang);
    return { x: WEST.cx + (WEST.rx + off) * c, y: WEST.cy + (WEST.ry + off) * si };
  }
  s -= L_W;

  // 5) 上ストレート: topL → topR（右方向、やや上向き）
  if (s < L_T) return straightSeg(PT.topL, PT.topR, s / L_T);
  s -= L_T;

  // 6) 東半周（右に大きく膨らむ）: 上→右→下
  if (s < L_E) {
    const t = s / L_E;
    const ang = -Math.PI / 2 + t * Math.PI;
    const c = Math.cos(ang), si = Math.sin(ang);
    return { x: EAST.cx + (EAST.rx + off) * c, y: EAST.cy + (EAST.ry + off) * si };
  }
  s -= L_E;

  // 7) 下ストレート: 合流点 → G（左方向、フィニッシュ）
  return straightSeg(PT.chuteJoin, PT.G, s / L_B3);
}

// ─── レース展開モデル ─────────────────────────────────
// 競馬の実際の道中:
//
// 序盤(ゲート〜400m, 先頭の0-15%): ポジション争い
//   - 逃げ馬がハナを切りに行く、追い込み馬は最後方に下げる
//   - ここで隊列が決まる
//
// 中盤(400m〜直線入口, 先頭の15-72%): 落ち着いた展開
//   - 全馬が先頭のペースで道中を流し、隊列は維持される
//   - 逃げ馬は先頭のままキープ、追い込み馬は後方のまま
//   - 個別能力の差は出ず、エネルギー温存合戦
//
// 直線(残り600m, 先頭の72%以降): 決着
//   - 各馬が末脚を使って勝負
//   - ペース次第で結果が変わる
//     - ハイペース: 前で潰れ、差し・追い込みが台頭
//     - スローペース: 逃げ残り、後方は届かない
//     - ミドル: 直線力勝負
const PHASE_POSITIONING_END = 0.15;
const PHASE_FINAL_START = 0.72;

// 序盤: 個別能力 × 脚質によるポジション取り
// 序盤の差は控えめにして、過剰なリードを防ぐ
const POSITIONING_MULT = {
  front:   1.15,  // 前へ出る
  stalker: 1.06,
  mid:     0.95,
  closer:  0.86,  // 後方へ
};

// 中盤: 全馬が先頭のペースに揃って道中を流す
// 個別能力（h.speed）ではなく共通ペースを使うことで隊列を維持する
const SETTLED_COMMON_PACE = {
  slow: 0.092,
  mid:  0.104,
  high: 0.116,
};
const SETTLED_MULT = {
  front:   1.008,  // 先頭でリード維持
  stalker: 1.002,
  mid:     0.998,
  closer:  0.992,  // 後方で末脚温存
};

// 直線: 個別能力 × 脚質 × ペース
//
// スローペース: 逃げ残りが顕著（逃げ馬が大きく加速、追い込みは届かない）
//   → 弱い逃げ馬でも強い差し馬を抑えられる
// ミドル: バランス。能力差で勝負がつく
// ハイ: 差し・追い込み有利だが、強い逃げ馬は粘る余地あり
const FINAL_MULT = {
  front:   { slow: 1.20, mid: 0.96, high: 0.80 },
  stalker: { slow: 1.10, mid: 1.00, high: 0.90 },
  mid:     { slow: 0.93, mid: 1.04, high: 1.12 },
  closer:  { slow: 0.78, mid: 1.10, high: 1.24 },
};

// 各フェーズでの有効速度を計算
function effectiveSpeed(horse, leaderProg, pace) {
  if (leaderProg < PHASE_POSITIONING_END) {
    return horse.speed * (POSITIONING_MULT[horse.style] ?? 1);
  }
  if (leaderProg > PHASE_FINAL_START) {
    return horse.speed * (FINAL_MULT[horse.style]?.[pace] ?? 1);
  }
  // 中盤は共通ペース基準（個別能力には依存しない、隊列維持）
  return (SETTLED_COMMON_PACE[pace] ?? 0.104) * (SETTLED_MULT[horse.style] ?? 1);
}

function currentPhase(leaderProg) {
  if (leaderProg < PHASE_POSITIONING_END) return { key: 'positioning', label: '序盤', desc: 'ポジション争い' };
  if (leaderProg > PHASE_FINAL_START)     return { key: 'final',       label: '直線', desc: 'ラストスパート！' };
  return { key: 'settled', label: '中盤', desc: '落ち着いた流れ' };
}

// 脚質構成から想定ペースを推定（ロジック予想用）
//  - 逃げが多いほどハイペースに振れる（主導権争い）
//  - 逃げが少なくて先行も少なければ単騎逃げ→スロー
//  - 結果に多様性を持たせるため、確率的に揺らぎを入れる
function predictPaceLogic(horseList) {
  const fronts   = horseList.filter((h) => h.style === 'front').length;
  const stalkers = horseList.filter((h) => h.style === 'stalker').length;
  // 強いハイペース判定
  if (fronts >= 3) return Math.random() < 0.85 ? 'high' : 'mid';
  // 単騎逃げまたは逃げ不在 → 基本はスロー
  if (fronts <= 1) return Math.random() < 0.70 ? 'slow' : 'mid';
  // 2頭逃げ: 先行が多いとペースが流れる
  if (fronts === 2 && stalkers >= 5) return Math.random() < 0.55 ? 'mid' : 'high';
  if (fronts === 2) return Math.random() < 0.55 ? 'mid' : 'slow';
  return 'mid';
}

// 各脚質のスタート時のポジション初期値（プログレス換算）
//  逃げはスタートから0.025先行、追い込みは-0.012で後方へ
const STYLE_INIT = { front: 0.020, stalker: 0.010, mid: 0, closer: -0.010 };

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
    // ペース挙動とフェーズが見える速度に調整（ラップ ~12秒）
    const bSpeed = (0.085 + norm * 0.038) * (1 + aiAdjust);
    const isForcedWinner = String(forcedWinner) && String(forcedWinner) === String(h.umaban);
    const initProg = STYLE_INIT[h.style] ?? 0;
    return {
      ...h,
      lane,
      baseSpeed: isForcedWinner ? 0.150 : bSpeed,
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
const PHASE_COLOR = { positioning: '#60A5FA', settled: '#FBBF24', final: '#F87171' };

export default function Simulator({ horses, maxStr, minStr }) {
  const cvRef = useRef(null);
  const stateRef = useRef({ running: false, horses: [], finishCount: 0, lastTs: null, afId: null });
  const courseImgRef = useRef(null);
  const [imgReady, setImgReady] = useState(false);
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
  // AI 予想履歴（localStorage 永続化）
  const [aiHistory, setAiHistory] = useState(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem('takarazuka-ai-history');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  // コース画像のプリロード
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      courseImgRef.current = img;
      setImgReady(true);
    };
    img.src = '/hanshin-course.jpeg';
  }, []);

  // raceState = { leaderProg, pace, isAi } を渡すとレース中の表示が出る
  const drawTrack = useCallback((ctx, raceState = null) => {
    ctx.clearRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0a1220');
    grad.addColorStop(1, '#0d1117');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // コース画像（背景）
    if (courseImgRef.current) {
      ctx.drawImage(courseImgRef.current, 0, 0, W, H);
    }

    // 左上にタイトル（半透明背景つき）
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(8, 8, 220, 44);
    ctx.fillStyle = 'rgba(255,215,0,.95)';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('宝塚記念 2026 GI', 16, 26);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = '11px sans-serif';
    ctx.fillText('阪神競馬場 芝2200m 右回り', 16, 44);

    // レース中のフェーズ・ペース表示（下中央）
    if (raceState) {
      const phase = currentPhase(raceState.leaderProg);
      // 半透明背景
      ctx.fillStyle = 'rgba(0,0,0,.65)';
      ctx.fillRect(W / 2 - 180, H - 52, 360, 44);
      ctx.font = 'bold 16px sans-serif';
      ctx.fillStyle = PHASE_COLOR[phase.key];
      ctx.textAlign = 'center';
      ctx.fillText(`▼ ${phase.label}：${phase.desc} ▼`, W / 2, H - 32);
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = PACE_COLOR[raceState.pace];
      const paceTag = raceState.isAi ? '🤖 AI想定' : '🎲 ロジック想定';
      ctx.fillText(`${paceTag}ペース: ${PACE_LABEL[raceState.pace]}`, W / 2, H - 14);
    }
  }, [imgReady]);

  const drawHorses = useCallback((ctx, simHorses, inGate = false) => {
    const sorted = [...simHorses].sort((a, b) => a.progress - b.progress);
    sorted.forEach((h) => {
      const prog = inGate ? 0 : Math.min(h.progress, 1.0);
      const pt = trackPt(prog, h.lane);
      const ws = getWakuStyle(h.waku);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 11, 0, Math.PI * 2);
      ctx.fillStyle = ws.bg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.65)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = ws.fg;
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(h.umaban, pt.x, pt.y);
    });
    ctx.textBaseline = 'alphabetic';
  }, []);

  const drawRanking = useCallback((ctx, simHorses) => {
    const sorted = [...simHorses].sort((a, b) => b.progress - a.progress);
    // 左下のスタンド外側（コースに被らない位置）
    const PX = 8;
    const PY = H - 132;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.78)';
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
    // レース実行中は st.horses を上書きしない（再生中の馬の speed=0 になるバグの修正）
    if (st.running) {
      drawTrack(ctx);
      return;
    }
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

    // ロジックモードでも脚質構成からペースを推定する
    const pace = analysisForSim?.pace ?? predictPaceLogic(horses);
    st.pace = pace;
    st.horses = makeSimHorses(horses, forcedWinner, maxStr, minStr, analysisForSim);
    st.horses.forEach((h) => {
      h.speed = h.baseSpeed + gaussianRandom() * 0.008;
      if (String(forcedWinner) && String(forcedWinner) === String(h.umaban))
        h.speed = 0.145 + Math.abs(gaussianRandom() * 0.005);
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

      // フェーズに応じて揺らぎを変える（中盤は控えめ、序盤・直線は活発）
      const isSettled = leaderProg >= PHASE_POSITIONING_END && leaderProg <= PHASE_FINAL_START;
      const noiseMag = isSettled ? 0.004 : 0.010;

      st.horses.forEach((h) => {
        if (h.finished) return;
        const v = effectiveSpeed(h, leaderProg, pace);
        h.progress += v * (1 + gaussianRandom() * noiseMag) * dt;
        const pt = trackPt(Math.min(h.progress, 1), h.lane);
        h.trail.push({ x: pt.x, y: pt.y });
        if (h.trail.length > 9) h.trail.shift();
        if (h.progress >= 1 && !h.finished) {
          h.finished = true;
          h.finishRank = ++st.finishCount;
        }
      });

      drawTrack(ctx, { leaderProg, pace, isAi: !!analysisForSim });
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

  // 履歴に保存（最新10件）
  const saveToHistory = useCallback((analysis) => {
    const entry = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      analysis,
    };
    setAiHistory((prev) => {
      const next = [entry, ...prev].slice(0, 10);
      try { window.localStorage.setItem('takarazuka-ai-history', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const deleteHistory = useCallback((id) => {
    setAiHistory((prev) => {
      const next = prev.filter((it) => it.id !== id);
      try { window.localStorage.setItem('takarazuka-ai-history', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setAiHistory([]);
    try { window.localStorage.removeItem('takarazuka-ai-history'); } catch {}
  }, []);

  // 新しい AI 予想を取得（必ず履歴に追加）
  const fetchAi = useCallback(async () => {
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
        const detail = err.debug
          ? ` (stop_reason=${err.debug.stop_reason}, blocks=${JSON.stringify(err.debug.blocks)})`
          : err.detail
          ? ` (${err.detail})`
          : '';
        throw new Error((err.error || `HTTP ${resp.status}`) + detail);
      }
      const data = await resp.json();
      setAiAnalysis(data.analysis);
      saveToHistory(data.analysis);
      return data.analysis;
    } catch (e) {
      setAiError(e.message);
      return null;
    } finally {
      setAiLoading(false);
    }
  }, [horses, saveToHistory]);

  // 履歴から再生（リソースを消費せず、その分析でアニメーションを実行）
  const playFromHistory = useCallback((item) => {
    setAiAnalysis(item.analysis);
    start(item.analysis);
  }, [start]);

  const RANK_ICONS = ['🥇', '🥈', '🥉'];

  const renderAnalysisDetails = (a) => (
    <div className="ai-details-body">
      <div>
        <div className="section-label">ペース予想の根拠</div>
        <div style={{ fontSize: 12, lineHeight: 1.6 }}>{a.pace_reason}</div>
      </div>
      <div>
        <div className="section-label">予想展開</div>
        <div style={{ fontSize: 12, lineHeight: 1.6 }}>{a.development}</div>
      </div>
      <div>
        <div className="section-label">本命候補</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {a.favorites.map((u, i) => {
            const h = horses.find((x) => Number(x.umaban) === Number(u));
            if (!h) return null;
            const ws = getWakuStyle(h.waku);
            return (
              <span key={u} className="rcard" style={{ padding: '3px 8px', fontSize: 12 }}>
                <span style={{ color: '#FFD700', fontWeight: 700 }}>{i + 1}.</span>
                <span className="chip" style={{ background: ws.bg, color: ws.fg, width: 20, height: 20, fontSize: 10 }}>{h.umaban}</span>
                <span style={{ fontSize: 11 }}>{h.horse_name}</span>
              </span>
            );
          })}
        </div>
      </div>
      <div>
        <div className="section-label">注目馬の補正</div>
        <div style={{ display: 'grid', gap: 4 }}>
          {a.key_horses.map((k) => {
            const h = horses.find((x) => Number(x.umaban) === Number(k.umaban));
            if (!h) return null;
            const ws = getWakuStyle(h.waku);
            const positive = k.adjustment >= 0;
            return (
              <div key={k.umaban} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                <span className="chip" style={{ background: ws.bg, color: ws.fg, width: 22, height: 22, fontSize: 10, flexShrink: 0 }}>{k.umaban}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontWeight: 600 }}>{h.horse_name}</span>
                    <span style={{ color: positive ? '#86EFAC' : '#F87171', fontWeight: 700, fontFamily: 'monospace' }}>
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
  );

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
          <button className="btn-secondary" onClick={reset} disabled={started}>リセット</button>
        </div>
      </div>

      {/* 右：シミュレーション結果 + AI予想 + 履歴 */}
      <div className="sim-right">
        <div className="panel-head">
          <h2 className="section-title">🤖 AI予想 & 結果</h2>
          {raceCompleted && (
            <span style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 999,
              background: lastModeAi ? 'rgba(139,92,246,.2)' : 'rgba(139,148,158,.2)',
              color: lastModeAi ? '#a78bfa' : '#8b949e', fontWeight: 600,
            }}>
              {lastModeAi ? '🤖 AI予想' : '🎲 ロジック'}
            </span>
          )}
        </div>

        {/* レース中表示 */}
        {started && (
          <div className="running-status">
            <div className="big-loader">🏇</div>
            <div style={{ fontWeight: 600 }}>{status}</div>
          </div>
        )}

        {/* レース結果 */}
        {raceCompleted && results.length > 0 && (
          <div className="results-section">
            <h3 className="subhead">🏁 着順</h3>
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
          </div>
        )}

        {/* AI 予想セクション（レース中以外） */}
        {!started && (
          <div className="ai-section">
            {!aiAnalysis && !aiLoading && (
              <button
                className="btn-primary"
                onClick={fetchAi}
                style={{ width: '100%', padding: '12px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
              >
                🤖 AI予想を取得
                <div style={{ fontSize: 11, fontWeight: 400, opacity: 0.85, marginTop: 4 }}>
                  Claude にレース展開を分析させます
                </div>
              </button>
            )}

            {aiLoading && (
              <div className="ai-loading">
                <div className="big-loader">🤖</div>
                <div>Claude が分析中... (10〜20秒)</div>
              </div>
            )}

            {aiAnalysis && (
              <div className="ai-loaded">
                <div className="ai-summary">
                  <span style={{
                    padding: '4px 10px', borderRadius: 999,
                    background: PACE_COLOR[aiAnalysis.pace] + '33',
                    color: PACE_COLOR[aiAnalysis.pace], fontWeight: 700, fontSize: 12,
                  }}>
                    {PACE_LABEL[aiAnalysis.pace]}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>本命:</span>
                  {aiAnalysis.favorites.slice(0, 3).map((u, i) => {
                    const h = horses.find((x) => Number(x.umaban) === Number(u));
                    if (!h) return null;
                    const ws = getWakuStyle(h.waku);
                    return (
                      <span key={u} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ color: '#FFD700', fontSize: 11, fontWeight: 700 }}>{i + 1}.</span>
                        <span className="chip" style={{ background: ws.bg, color: ws.fg, width: 22, height: 22, fontSize: 11 }}>{h.umaban}</span>
                      </span>
                    );
                  })}
                </div>

                <div className="play-row">
                  <button
                    onClick={() => start(aiAnalysis)}
                    className="btn-primary play-btn"
                    disabled={aiLoading}
                  >
                    ▶ {raceCompleted && lastModeAi ? 'もう一度再生' : 'このAI予想で再生'}
                  </button>
                  <button
                    onClick={fetchAi}
                    className="btn-secondary"
                    disabled={aiLoading}
                    title="新しい AI 予想を取得（API リソースを消費）"
                  >
                    🔄 新しい予想
                  </button>
                </div>

                <details className="ai-details" open={!raceCompleted}>
                  <summary>
                    🤖 Claude の分析詳細
                  </summary>
                  {renderAnalysisDetails(aiAnalysis)}
                </details>
              </div>
            )}
          </div>
        )}

        {/* 履歴 */}
        {!started && aiHistory.length > 0 && (
          <details className="history-panel" open={!aiAnalysis}>
            <summary>
              📜 AI予想履歴 ({aiHistory.length}件)
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>
                ワンタップで再生
              </span>
            </summary>
            <div className="history-list">
              {aiHistory.map((item) => {
                const a = item.analysis;
                const date = new Date(item.timestamp);
                const ds = date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
                const isCurrent = aiAnalysis && aiAnalysis === a;
                return (
                  <div key={item.id} className={'history-item' + (isCurrent ? ' active' : '')}>
                    <div className="history-meta">
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{ds}</span>
                      <span style={{
                        padding: '1px 6px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                        background: PACE_COLOR[a.pace] + '33', color: PACE_COLOR[a.pace],
                      }}>
                        {PACE_LABEL[a.pace]}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
                      {a.favorites.slice(0, 3).map((u, i) => {
                        const h = horses.find((x) => Number(x.umaban) === Number(u));
                        if (!h) return null;
                        const ws = getWakuStyle(h.waku);
                        return (
                          <span key={u} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <span style={{ fontSize: 9, color: '#FFD700' }}>{i + 1}</span>
                            <span className="chip" style={{ background: ws.bg, color: ws.fg, width: 18, height: 18, fontSize: 9 }}>{h.umaban}</span>
                          </span>
                        );
                      })}
                    </div>
                    <div className="history-actions">
                      <button
                        onClick={() => playFromHistory(item)}
                        className="btn-primary"
                        style={{ padding: '4px 12px', fontSize: 11 }}
                      >
                        ▶ 再生
                      </button>
                      <button
                        onClick={() => deleteHistory(item.id)}
                        className="btn-secondary"
                        style={{ padding: '4px 10px', fontSize: 11 }}
                        title="この履歴を削除"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              onClick={clearHistory}
              className="btn-secondary"
              style={{ width: '100%', marginTop: 8, fontSize: 11, padding: '6px' }}
            >
              履歴をすべて削除
            </button>
          </details>
        )}

        {/* 未操作時の案内 */}
        {!started && !aiAnalysis && !aiLoading && aiHistory.length === 0 && !raceCompleted && (
          <div className="results-placeholder">
            左下の「ロジック」ボタンで即シミュレーション、<br />
            上の「AI予想を取得」で Claude による分析を実行できます
          </div>
        )}
      </div>
    </div>
  );
}
