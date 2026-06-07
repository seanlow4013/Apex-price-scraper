# ApexBreaksTCG Price Scraper

Price lookup backend for Snkrdunk and Yuyutei.

## Endpoints

### GET /
Health check

### GET /prices
Fetch prices for a card.

**Params:**
- `card` — card name (e.g. `Monkey D Luffy`)
- `number` — card number (e.g. `OP16-001`) ← more accurate
- `rarity` — optional (e.g. `SEC`)

**Example:**
```
/prices?number=OP16-001&card=Monkey+D+Luffy&rarity=SEC
```

**Response:**
```json
{
  "success": true,
  "card": "Monkey D Luffy",
  "snkrdunk": { "priceJPY": 13000, "priceSGD": 218 },
  "yuyutei": { "priceJPY": 12000, "priceSGD": 202 },
  "avgSGD": 210
}
```

## Deploy on Railway
1. Push this repo to GitHub
2. Go to railway.app → New Project → Deploy from GitHub
3. Select this repo → Deploy
