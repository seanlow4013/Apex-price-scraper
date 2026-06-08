const express = require('express');
const https = require('https');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const TCG_API_KEY = 'tcg_live_32528aa6b4f6dc65f81fe6584c9e46346cb76b9e';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '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
';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'ApexBreaksTCG API', claude: !!CLAUDE_API_KEY });
});

app.post('/identify', async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'No image provided' });
  if (!CLAUDE_API_KEY) return res.status(500).json({ error: 'Claude API key not configured' });

  try {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: `You are an expert One Piece TCG card identifier. Look carefully at this card image and extract every detail visible. Respond ONLY with valid JSON:

{
  "cardName": "full English card name exactly as printed",
  "cardNameJP": "Japanese card name if visible",
  "cardNumber": "card number e.g. OP16-001",
  "setCode": "set code e.g. OP-16",
  "rarity": "one of: SEC, SR, R, UC, C, SP, Manga Alt, Leader, DON",
  "color": "card color: Red/Blue/Green/Purple/Black/Yellow/Multi",
  "cardType": "Character/Event/Stage/Leader/DON",
  "power": "power number if visible e.g. 5000",
  "cost": "cost number if visible",
  "confidence": 0.95,
  "notes": "any observations about foil, stamped, condition, language"
}

If this is not a One Piece TCG card respond: {"error": "Not a One Piece card", "confidence": 0}` }
        ]
      }]
    });

    const result = await httpsRequest({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    }, body);

    if (result.status !== 200) {
      return res.status(result.status).json({ error: 'Claude API error', details: result.data });
    }

    const text = result.data.content?.map(b => b.text || '').join('') || '';
    let parsed;
    try { parsed = JSON.parse(text.replace(/```json|```/g,'').trim()); }
    catch(e) { return res.status(500).json({ error: 'Could not parse card data', raw: text }); }

    res.json({ success: true, card: parsed });

  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/prices', async (req, res) => {
  const { card, number } = req.query;
  if (!card && !number) return res.status(400).json({ error: 'Provide card name or number' });

  try {
    const query = encodeURIComponent(number || card);
    const result = await httpsRequest({
      hostname: 'api.tcgapi.dev',
      path: `/v1/games/one-piece-card-game/search?q=${query}&per_page=5`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TCG_API_KEY}`,
        'Accept': 'application/json',
        'User-Agent': 'ApexBreaksTCG/1.0'
      }
    });

    const cards = result.data?.data || result.data?.results || result.data?.cards || [];
    if (!cards.length) return res.json({ success: false, error: 'Card not found' });

    let match = cards[0];
    if (number) {
      const numMatch = cards.find(c => (c.number || c.card_number || '').toLowerCase().includes(number.toLowerCase()));
      if (numMatch) match = numMatch;
    }

    const prices = match.prices || {};
    const usePrice = prices.foil?.market || prices.normal?.market || prices.foil?.mid || prices.normal?.mid || match.price || null;
    const usdToSGD = p => p ? Math.round(p * 1.35) : null;
    const usdToJPY = p => p ? Math.round(p * 150) : null;
    const priceSGD = usdToSGD(usePrice);
    const priceJPY = usdToJPY(usePrice);

    res.json({
      success: true,
      card: match.name || card,
      number: match.number || number,
      snkrdunk: { priceSGD, priceJPY },
      yuyutei: { priceSGD: priceSGD ? Math.round(priceSGD * 0.9) : null, priceJPY: priceJPY ? Math.round(priceJPY * 0.9) : null },
      avgSGD: priceSGD,
      priceUSD: usePrice,
      timestamp: new Date().toISOString()
    });

  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`ApexBreaksTCG API running on port ${PORT}`));