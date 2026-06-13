import Anthropic from '@anthropic-ai/sdk';

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    pace: {
      type: 'string',
      enum: ['high', 'mid', 'slow'],
      description: 'ハイペース/ミドルペース/スローペースの3択',
    },
    pace_reason: { type: 'string', description: 'ペース予想の根拠（1-2文）' },
    favorites: {
      type: 'array',
      items: { type: 'integer' },
      description: '上位3頭の馬番',
    },
    key_horses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          umaban: { type: 'integer' },
          adjustment: {
            type: 'number',
            description: '-0.15〜+0.15の能力補正（+が有利、-が不利）',
          },
          reason: { type: 'string' },
        },
        required: ['umaban', 'adjustment', 'reason'],
        additionalProperties: false,
      },
    },
    development: {
      type: 'string',
      description: '予想される展開（3-5文）',
    },
  },
  required: ['pace', 'pace_reason', 'favorites', 'key_horses', 'development'],
  additionalProperties: false,
};

function buildHorseDigest(horses) {
  return horses.map((h) => ({
    umaban: Number(h.umaban),
    name: h.horse_name,
    age_sex: h.barei,
    kinryo: h.kinryo,
    jockey: h.jockey_name,
    trainer: h.trainer_name,
    style: h.style,
    recent: (h.results || []).slice(0, 5).map((r) => ({
      date: r.race_date,
      race: r.race_name,
      distance: r.distance,
      surface: r.surface,
      track: r.track_cond,
      place: r.chakujun,
      time: r.time,
      passage: r.passage,
      pace: r.pace,
    })),
  }));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY が設定されていません' });
  }

  try {
    const { horses, raceInfo } = req.body;
    if (!Array.isArray(horses) || horses.length === 0) {
      return res.status(400).json({ error: 'horses が必要です' });
    }

    const race = raceInfo ?? {
      name: '宝塚記念',
      venue: '阪神競馬場',
      surface: '芝',
      distance: 2200,
      date: '2026年6月28日',
    };

    const client = new Anthropic();
    const digest = buildHorseDigest(horses);

    const prompt = `あなたは長年のキャリアを持つ競馬予想の専門家です。以下の出走馬データから、${race.name}（${race.venue} ${race.surface}${race.distance}m）のレース展開を予想してください。

# レース情報
- レース名: ${race.name}
- 開催: ${race.venue}
- コース: ${race.surface}${race.distance}m
- 開催日: ${race.date}
- 出走頭数: ${digest.length}頭

# 出走馬データ（直近5走を含む）
${JSON.stringify(digest, null, 2)}

# 分析の観点
- 逃げ馬の数と陣営の駆け引きから想定されるペース
- 各馬の脚質（front=逃げ, stalker=先行, mid=差し, closer=追い込み）と適性距離
- 騎手の傾向、近走の調子、斤量、ローテーション
- 過去の通過順位・タイム・走破ペースから読み取れる現在の地力
- 阪神2200m（内回り・坂2回）の特性とこのメンバーでの有利不利

# 出力フォーマット
- pace: ハイペース(high) / ミドル(mid) / スロー(slow) のいずれか
- pace_reason: そのペース予想の根拠
- favorites: 1着候補3頭の馬番
- key_horses: 特に注目する馬5-8頭。それぞれにadjustment（-0.15〜+0.15の能力補正値。+が有利、-が不利）と理由を付ける
- development: 序盤・中盤・終盤の予想展開を具体的に

JSONスキーマに従って厳密に回答してください。`;

    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      output_config: {
        format: { type: 'json_schema', schema: RESPONSE_SCHEMA },
        effort: 'high',
      },
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) {
      throw new Error('テキストブロックが返されませんでした');
    }

    const analysis = JSON.parse(textBlock.text);
    return res.status(200).json({
      analysis,
      usage: response.usage,
    });
  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({
      error: error.message ?? 'Unknown error',
    });
  }
}
