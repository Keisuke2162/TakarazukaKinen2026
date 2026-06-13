import { useMemo } from 'react';
import './index.css';
import RACE_DATA from './data/raceData';
import { computeStrength, computeStyle } from './utils/horseUtils';
import Umabashira from './components/Umabashira';
import Simulator from './components/Simulator';

export default function App() {
  const horses = useMemo(() =>
    RACE_DATA.map((h) => ({
      ...h,
      strength: computeStrength(h),
      style: computeStyle(h),
    })),
    []
  );

  const { maxStr, minStr } = useMemo(() => ({
    maxStr: Math.max(...horses.map((h) => h.strength)),
    minStr: Math.min(...horses.map((h) => h.strength)),
  }), [horses]);

  return (
    <div className="page">
      <header className="app-header compact">
        <div className="race-badge">G I</div>
        <div className="race-name">第65回 宝塚記念</div>
        <div className="race-meta">
          2026年6月28日（日）　阪神競馬場　芝2200m　フルゲート18頭
        </div>
      </header>

      <section className="sim-row">
        <Simulator horses={horses} maxStr={maxStr} minStr={minStr} />
      </section>

      <section className="uma-row">
        <h2 className="section-title">馬柱</h2>
        <Umabashira horses={horses} />
      </section>
    </div>
  );
}
