import { useEffect } from 'react';
import { getWakuStyle, getGradeLabel, getGradeClass, STYLE_LABEL } from '../utils/horseUtils';

function pillClass(chakujun) {
  const p = parseInt(chakujun, 10);
  if (p === 1) return 'p1';
  if (p === 2) return 'p2';
  if (p === 3) return 'p3';
  return '';
}

export default function HorseModal({ horse, onClose }) {
  const ws = getWakuStyle(horse.waku);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-overlay">
      <div className="modal-bg" onClick={onClose} />
      <div className="modal-box">
        <button className="modal-close" onClick={onClose}>✕</button>

        <div className="modal-horse-head">
          <span
            className="umaban-circle"
            style={{ background: ws.bg, color: ws.fg, width: 50, height: 50, fontSize: 20, flexShrink: 0 }}
          >
            {horse.umaban}
          </span>
          <div>
            <h2>{horse.horse_name}</h2>
            <div className="modal-meta">
              {horse.barei} | 斤量{horse.kinryo}kg | {horse.jockey_name}騎手 | {horse.trainer_name}調教師 | {horse.stable}
            </div>
            <div className="modal-meta" style={{ marginTop: 4 }}>
              脚質：{STYLE_LABEL[horse.style] ?? 'ミドル'}
            </div>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="hist-table">
            <thead>
              <tr>
                <th>日付</th><th>開催</th>
                <th style={{ textAlign: 'left' }}>レース名</th>
                <th>頭数</th><th>着順</th><th>騎手</th>
                <th>コース</th><th>馬場</th><th>タイム</th>
                <th>通過順位</th><th>馬体重</th>
              </tr>
            </thead>
            <tbody>
              {horse.results.map((r, i) => {
                const gc = getGradeClass(r.race_name);
                const gl = getGradeLabel(r.race_name);
                const pc = pillClass(r.chakujun);
                const cleanName = r.race_name.replace(/\([^)]*\)/g, '');
                return (
                  <tr key={i}>
                    <td>{r.race_date}</td>
                    <td style={{ fontSize: 11 }}>{r.kaisai}</td>
                    <td className={`tal ${gc}`}>
                      {cleanName}
                      {gl && <><br /><span style={{ fontSize: 10, opacity: 0.6 }}>{gl}</span></>}
                    </td>
                    <td style={{ fontSize: 11 }}>{r.head_count ? `${r.head_count}頭` : '-'}</td>
                    <td className={pc} style={{ fontWeight: 700, fontSize: 15 }}>{r.chakujun}</td>
                    <td>{r.jockey}</td>
                    <td>{r.surface}{r.distance}m</td>
                    <td style={{ fontSize: 11 }}>{r.track_cond || '-'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.time || '-'}</td>
                    <td style={{ fontSize: 11 }}>{r.passage || '-'}</td>
                    <td style={{ fontSize: 11 }}>{r.bataiju || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
