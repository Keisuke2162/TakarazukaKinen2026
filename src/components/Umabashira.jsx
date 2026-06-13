import { useState } from 'react';
import { getWakuStyle } from '../utils/horseUtils';
import HorseModal from './HorseModal';

function pillClass(chakujun) {
  const p = parseInt(chakujun, 10);
  if (p === 1) return 'r1';
  if (p === 2) return 'r2';
  if (p === 3) return 'r3';
  if (p === 4 || p === 5) return 'r4';
  if (!isNaN(p)) return 'r-other';
  return 'r-fail';
}

function WakuBox({ waku }) {
  const ws = getWakuStyle(waku);
  return (
    <span className="waku-box" style={{ background: ws.bg, color: ws.fg }}>
      {waku}
    </span>
  );
}

function UmabanCircle({ horse }) {
  const ws = getWakuStyle(horse.waku);
  return (
    <span className="umaban-circle" style={{ background: ws.bg, color: ws.fg }}>
      {horse.umaban}
    </span>
  );
}

export default function Umabashira({ horses }) {
  const [selected, setSelected] = useState(null);

  return (
    <>
      <div className="uma-wrap">
        <table className="uma-table">
          <thead>
            <tr>
              <th>枠</th>
              <th>馬番</th>
              <th style={{ textAlign: 'left', minWidth: 140 }}>馬名 / 騎手</th>
              <th>性齢</th>
              <th>斤量</th>
              <th>調教師</th>
              <th>所属</th>
              <th>近走（新→旧）</th>
            </tr>
          </thead>
          <tbody>
            {horses.map((horse) => (
              <tr key={horse.umaban} onClick={() => setSelected(horse)}>
                <td><WakuBox waku={horse.waku} /></td>
                <td><UmabanCircle horse={horse} /></td>
                <td className="tal">
                  <div style={{ fontWeight: 700 }}>{horse.horse_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{horse.jockey_name}騎手</div>
                </td>
                <td>{horse.barei}</td>
                <td>{horse.kinryo}</td>
                <td style={{ fontSize: 12 }}>{horse.trainer_name}師</td>
                <td style={{ fontSize: 11, color: 'var(--muted)' }}>{horse.stable}</td>
                <td>
                  {horse.results.slice(0, 5).map((r, i) => (
                    <span
                      key={i}
                      className={`rpill ${pillClass(r.chakujun)}`}
                      title={`${r.race_name} (${r.race_date})`}
                    >
                      {r.chakujun}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <HorseModal horse={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
