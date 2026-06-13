export const WAKU_STYLE = {
  1: { bg: '#F0F0F0', fg: '#111111' },
  2: { bg: '#111111', fg: '#FFFFFF' },
  3: { bg: '#CC0022', fg: '#FFFFFF' },
  4: { bg: '#0033C0', fg: '#FFFFFF' },
  5: { bg: '#F5C800', fg: '#111111' },
  6: { bg: '#006820', fg: '#FFFFFF' },
  7: { bg: '#CC5500', fg: '#FFFFFF' },
  8: { bg: '#CC0066', fg: '#FFFFFF' },
};

export function getWakuStyle(waku) {
  return WAKU_STYLE[Number(waku)] ?? { bg: '#555', fg: '#fff' };
}

function gradeMultiplier(raceName) {
  if (/\(GI\)|\(G1\)/.test(raceName)) return 1.6;
  if (/\(GII\)/.test(raceName)) return 1.3;
  if (/\(GIII\)/.test(raceName)) return 1.1;
  return 0.85;
}

function distanceAffinity(dist, surface) {
  if (surface !== '芝') return 0.65;
  const d = parseInt(dist, 10);
  if (isNaN(d)) return 1.0;
  const diff = Math.abs(d - 2200);
  if (diff <= 100) return 1.15;
  if (diff <= 300) return 1.05;
  if (diff <= 600) return 0.98;
  if (diff <= 1000) return 0.92;
  return 0.87;
}

function positionScore(chakujun) {
  const p = parseInt(chakujun, 10);
  if (isNaN(p)) return 0;
  const table = [0, 100, 82, 65, 50, 38, 28, 20, 14, 10, 7, 5, 3, 2, 1, 1, 1, 0, 0, 0];
  return p < table.length ? table[p] : 0;
}

export function computeStrength(horse) {
  let totalScore = 0;
  let totalWeight = 0;
  horse.results.slice(0, 10).forEach((r, idx) => {
    if (isNaN(parseInt(r.chakujun, 10))) return;
    const w = Math.pow(0.78, idx);
    const score =
      positionScore(r.chakujun) *
      gradeMultiplier(r.race_name) *
      distanceAffinity(r.distance, r.surface) *
      w;
    totalScore += score;
    totalWeight += w;
  });
  return totalWeight > 0 ? totalScore / totalWeight : 30;
}

export function computeStyle(horse) {
  const positions = [];
  horse.results.slice(0, 6).forEach((r) => {
    if (!r.passage) return;
    const nums = r.passage.split('-').map(Number).filter((n) => !isNaN(n) && n > 0);
    if (nums.length) positions.push(nums[0]);
  });
  if (!positions.length) return 'mid';
  const avg = positions.reduce((a, b) => a + b, 0) / positions.length;
  if (avg <= 2) return 'front';
  if (avg <= 4) return 'stalker';
  if (avg <= 8) return 'mid';
  return 'closer';
}

export const STYLE_LABEL = {
  front: '逃げ',
  stalker: '先行',
  mid: '差し',
  closer: '追い込み',
};

export function gaussianRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}


export function getGradeLabel(raceName) {
  if (/\(GI\)|\(G1\)/.test(raceName)) return 'GI';
  if (/\(GII\)/.test(raceName)) return 'GII';
  if (/\(GIII\)/.test(raceName)) return 'GIII';
  return '';
}

export function getGradeClass(raceName) {
  if (/\(GI\)|\(G1\)/.test(raceName)) return 'gi';
  if (/\(GII\)/.test(raceName)) return 'gii';
  if (/\(GIII\)/.test(raceName)) return 'giii';
  return '';
}
