const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── HEADERS to mimic a real browser ──
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
};

// ── HEALTH CHECK ──
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'ApexBreaksTCG Price Scraper' });
});

// ── MAIN PRICE ENDPOINT ──
// GET /prices?card=Monkey+D+Luffy&number=OP16-001&rarity=SEC
app.get('/prices', async (req, res) => {
  const { card, number, rarity } = req.query;

  if (!card && !number) {
    return res.status(400).json({ error: 'Provide card name or card number' });
  }

  try {
    const [snkrdunk, yuyutei] = await Promise.allSettled([
      scrapeSnkrdunk(card, number),
      scrapeYuyutei(card, number)
    ]);

    const snkrData = snkrdunk.status === 'fulfilled' ? snkrdunk.value : null;
    const yuyuData = yuyutei.status === 'fulfilled' ? yuyutei.value : null;

    // Calculate SGD average from available sources
    const prices = [];
    if (snkrData?.priceSGD) prices.push(snkrData.priceSGD);
    if (yuyuData?.priceSGD) prices.push(yuyuData.priceSGD);
    const avgSGD = prices.length > 0 ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : null;

    res.json({
      success: true,
      card: card || number,
      number: number || null,
      rarity: rarity || null,
      snkrdunk: snkrData,
      yuyutei: yuyuData,
      avgSGD,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SNKRDUNK SCRAPER ──
async function scrapeSnkrdunk(cardName, cardNumber) {
  try {
    const query = encodeURIComponent((cardNumber || cardName) + ' ワンピース');
    const url = `https://snkrdunk.com/en/cards/search?keyword=${query}`;

    const { data } = await axios.get(url, { headers: HEADERS, timeout: 10000 });
    const $ = cheerio.load(data);

    let priceJPY = null;
    let priceSGD = null;
    let listings = 0;
    let cardTitle = null;
    let cardUrl = null;

    // Try to find card listing
    const cardItems = $('.card-item, .product-item, [class*="card"], [class*="product"]');

    cardItems.each((i, el) => {
      if (i > 0) return; // take first result
      const text = $(el).text();
      const priceMatch = text.match(/[¥￥]\s*([\d,]+)/);
      if (priceMatch) {
        priceJPY = parseInt(priceMatch[1].replace(/,/g, ''));
        priceSGD = Math.round(priceJPY / 110 * 1.85); // approx JPY→SGD
      }
      cardTitle = $(el).find('h2, h3, .title, [class*="name"]').first().text().trim();
      cardUrl = $(el).find('a').first().attr('href');
    });

    // Fallback: look for any price in page
    if (!priceJPY) {
      const priceEls = $('[class*="price"], [class*="Price"]');
      priceEls.each((i, el) => {
        if (priceJPY) return;
        const match = $(el).text().match(/[¥￥]\s*([\d,]+)/);
        if (match) {
          priceJPY = parseInt(match[1].replace(/,/g, ''));
          priceSGD = Math.round(priceJPY / 110 * 1.85);
        }
      });
    }

    return {
      source: 'Snkrdunk',
      priceJPY,
      priceSGD,
      listings,
      cardTitle,
      url: cardUrl ? `https://snkrdunk.com${cardUrl}` : url,
      currency: 'JPY',
      note: 'Last sale price'
    };

  } catch (err) {
    console.error('Snkrdunk error:', err.message);
    return { source: 'Snkrdunk', error: err.message, priceJPY: null, priceSGD: null };
  }
}

// ── YUYUTEI SCRAPER ──
async function scrapeYuyutei(cardName, cardNumber) {
  try {
    // Yuyutei search by card number is most reliable
    const query = encodeURIComponent(cardNumber || cardName);
    const url = `https://yuyu-tei.jp/sell/opc/s/${query}`;

    const { data } = await axios.get(url, { headers: HEADERS, timeout: 10000 });
    const $ = cheerio.load(data);

    let priceJPY = null;
    let priceSGD = null;
    let stock = null;
    let cardTitle = null;

    // Yuyutei price selectors
    const priceEl = $('.price, .card-price, [class*="price"], .sell-price').first();
    const priceText = priceEl.text().trim();
    const priceMatch = priceText.match(/([\d,]+)\s*円/);

    if (priceMatch) {
      priceJPY = parseInt(priceMatch[1].replace(/,/g, ''));
      priceSGD = Math.round(priceJPY / 110 * 1.85);
    }

    // Try alternate price format
    if (!priceJPY) {
      $('*').each((i, el) => {
        if (priceJPY) return;
        const text = $(el).text();
        const m = text.match(/買取価格[：:]\s*([\d,]+)円/);
        if (m) {
          priceJPY = parseInt(m[1].replace(/,/g, ''));
          priceSGD = Math.round(priceJPY / 110 * 1.85);
        }
      });
    }

    cardTitle = $('h1, .card-name, [class*="card-name"]').first().text().trim();
    stock = $('.stock, [class*="stock"]').first().text().trim();

    return {
      source: 'Yuyutei',
      priceJPY,
      priceSGD,
      stock,
      cardTitle,
      url,
      currency: 'JPY',
      note: 'Buy price'
    };

  } catch (err) {
    console.error('Yuyutei error:', err.message);
    return { source: 'Yuyutei', error: err.message, priceJPY: null, priceSGD: null };
  }
}

// ── START ──
app.listen(PORT, () => {
  console.log(`ApexBreaksTCG Price Scraper running on port ${PORT}`);
});
