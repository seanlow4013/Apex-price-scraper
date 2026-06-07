const express = require('express');
const https = require('https');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const TCG_API_KEY = 'tcg_live_32528aa6b4f6dc65f81fe6584c9e46346cb76b9e';
const TCG_BASE = 'api.tcgapi.dev';

app.use(cors());
app.use(express.json());

function fetchJSON(host, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      path: path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TCG_API_KEY}`,
        'Accept': 'application/json',
        'User-Agent': 'ApexBreaksTCG/1.0'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'ApexBreaksTCG Price API', source: 'TCG API' });
});

app.get('/prices', async (req, res) => {
  const { card, number } = req.query;
  if (!card && !number) return res.status(400).json({ error: 'Provide card name or number' });

  try {
    const query = encodeURIComponent(number || card);
    const result = await fetchJSON(TCG_BASE, `/v1/games/one-piece-card-game/search?q=${query}&per_page=5`);
    const cards = result.data || result.results || result.cards || [];

    if (!cards.length) return res.json({ success: false, error: 'Card not found', card: card || number });

    let match = cards[0];
    if (number) {
      const numMatch = cards.find(c =>
        (c.number || c.card_number || c.id || '').toLowerCase().includes(number.toLowerCase())
      );
      if (numMatch) match = numMatch;
    }

    const prices = match.prices || {};
    const normalPrice = prices.normal?.market || prices.normal?.mid || null;
    const foilPrice = prices.foil?.market || prices.foil?.mid || null;
    const usePrice = foilPrice || normalPrice || match.price || null;

    const usdToSGD = p => p ? Math.round(p * 1.35) : null;
    const usdToJPY = p => p ? Math.round(p * 150) : null;
    const priceSGD = usdToSGD(usePrice);
    const priceJPY = usdToJPY(usePrice);

    const change7d = prices.normal?.change_7d || prices.foil?.change_7d || null;
    const trend = change7d !== null
      ? (change7d >= 0 ? `+${(change7d*100).toFixed(1)}%` : `${(change7d*100).toFixed(1)}%`)
      : null;

    res.json({
      success: true,
      card: match.name || card,
      number: match.number || match.card_number || number,
      set: match.set_name || match.set || '',
      rarity: match.rarity || '',
      snkrdunk: { priceSGD, priceJPY, note: 'Market price (SGD)' },
      yuyutei: { priceSGD: priceSGD ? Math.round(priceSGD*0.9) : null, priceJPY: priceJPY ? Math.round(priceJPY*0.9) : null, note: 'Est. JP market' },
      avgSGD: priceSGD,
      priceUSD: usePrice,
      trend,
      timestamp: new Date().toISOString()
    });

  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Provide search query' });
  try {
    const result = await fetchJSON(TCG_BASE, `/v1/games/one-piece-card-game/search?q=${encodeURIComponent(q)}&per_page=10`);
    const cards = result.data || result.results || result.cards || [];
    res.json({
      success: true,
      results: cards.map(c => ({
        name: c.name,
        number: c.number || c.card_number,
        set: c.set_name || c.set,
        rarity: c.rarity,
        priceUSD: c.prices?.normal?.market || c.prices?.foil?.market || c.price || null
      }))
    });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`ApexBreaksTCG Price API running on port ${PORT}`));