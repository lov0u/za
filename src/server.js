const express = require('express');
const cors = require('cors');
const { fetchAndParse, closeBrowser } = require('./crawler');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors());
app.use(express.static('public'));

app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));

// POST /api/crawl
// body: { url: string, renderJs?: boolean, screenshot?: boolean }
app.post('/api/crawl', async (req, res) => {
  const { url, renderJs = true, screenshot = false } = req.body || {};
  if (!url) return res.status(400).json({ ok: false, error: 'missing url' });
  try {
    const parsed = new URL(url);
    // Basic check passed
  } catch (e) {
    return res.status(400).json({ ok: false, error: 'invalid url' });
  }

  try {
    const result = await fetchAndParse(url, { renderJs, screenshot });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`za-crawler listening on ${PORT}`));

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down...');
  server.close(async () => {
    try { await closeBrowser(); } catch (e) {}
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
