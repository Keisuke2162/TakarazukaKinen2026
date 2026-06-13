# 宝塚記念 2026 シミュレーター

Claude APIでレース展開を予想し、その結果をシミュレーションに反映するWebアプリ。

## 構成

- React + Vite (フロントエンド)
- Vercel Serverless Function (`api/analyze.js`) で Claude API (claude-opus-4-7) を呼び出し
- 馬柱表示 + AI予想連動シミュレータ

## ローカル開発

### セットアップ

```sh
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
```

### 起動方法

**A. フロントエンドのみ（AI機能は使えない）**

```sh
npm run dev
```

**B. Vercel CLI でフルスタック実行（推奨）**

```sh
npm i -g vercel
vercel dev
```

`/api/analyze` も含めて localhost:3000 で動く。

## Vercel デプロイ

1. GitHubにpush
2. https://vercel.com で import
3. Project Settings → Environment Variables に `ANTHROPIC_API_KEY` を追加
4. Deploy

## ファイル構成

```
api/
  analyze.js          # Vercel Function: Claude API でレース展開予想
src/
  App.jsx
  data/raceData.js    # 18頭の馬データ（埋め込み済み）
  utils/horseUtils.js # 強度計算・脚質判定
  components/
    Umabashira.jsx    # 馬柱
    HorseModal.jsx    # 馬詳細モーダル
    Simulator.jsx     # AI連動シミュレータ（Canvas）
```

## AI予想とシミュレーションの連動

1. 「AIにレース展開を予想させる」ボタン → `POST /api/analyze`
2. Claude が以下を返却:
   - `pace`: ハイ/ミドル/スロー
   - `favorites`: 本命3頭
   - `key_horses`: 注目馬と能力補正値 (-15%〜+15%)
   - `development`: 想定展開
3. シミュレーション側では:
   - 各馬の `baseSpeed` を `key_horses.adjustment` で補正
   - `styleMult` でフェーズ別のスピード曲線を `pace` に応じて変動
   - 例: ハイペースなら追い込み馬が直線で大きく伸びる
