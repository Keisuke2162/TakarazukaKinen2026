import { useState, useMemo } from 'react';
import './index.css';
import RACE_DATA from './data/raceData';
import { computeStrength, computeStyle } from './utils/horseUtils';
import Umabashira from './components/Umabashira';
import Simulator from './components/Simulator';

const TABS = [
  { id: 'umabashira', label: '馬柱' },
  { id: 'simulator',  label: 'AI予想 & シミュレータ' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('umabashira');

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
    <>
      <header className="app-header">
        <div className="race-badge">G I</div>
        <div className="race-name">第65回 宝塚記念</div>
        <div className="race-meta">
          2026年6月28日（日）　阪神競馬場　芝2200m　フルゲート18頭
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={'tab-btn' + (activeTab === tab.id ? ' active' : '')}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'umabashira' && <Umabashira horses={horses} />}
      {activeTab === 'simulator'  && (
        <Simulator horses={horses} maxStr={maxStr} minStr={minStr} />
      )}
    </>
  );
}
