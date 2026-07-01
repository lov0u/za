const { chromium } = require('playwright');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const robotsParser = require('robots-parser');
const fetch = require('node-fetch');
const pLimit = require('p-limit');
const { URL } = require('url');

const USER_AGENT = process.env.USER_AGENT || 'za-crawler/1.0 (+https://github.com/lov0u/za)';
const GLOBAL_CONCURRENCY = parseInt(process.env.GLOBAL_CONCURRENCY || '3', 10);
const limit = pLimit(GLOBAL_CONCURRENCY);

let _browser = null;
async function getBrowser() {
  if (!_browser) {
    _browser = await chromium.launch({ headless: true });
  }
  return _browser;
}

function isLocalAddress(hostname) {
  if (!hostname) return true;
  return /^(localhost|127\.0\.0\.1|::1|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(hostname);
}

async function canCrawl(url) {
  try {
    const u = new URL(url);
    if (isLocalAddress(u.hostname)) return false;
    const robotsUrl = `${u.protocol}//${u.hostname}/robots.txt`;
    const res = await fetch(robotsUrl, { headers: { 'User-Agent': USER_AGENT }, timeout: 5000 });
    const txt = res.ok ? await res.text() : '';
    const robots = robotsParser(robotsUrl, txt);
    return robots.isAllowed(url, USER_AGENT);
  } catch (e) {
    // on error, allow to avoid blocking due to robots fetch failures
    return true;
  }
}

async function fetchAndParse(rawUrl, options = {}) {
  const { renderJs = true, timeout = 15000, screenshot = false } = options;
  const normalizedUrl = new URL(rawUrl).toString();

  if (!await canCrawl(normalizedUrl)) {
    throw new Error('Blocked by robots.txt or refused (local address)');
  }

  return limit(async () => {
    const browser = await getBrowser();
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    try {
      await page.goto(normalizedUrl, { waitUntil: renderJs ? 'networkidle' : 'domcontentloaded', timeout });
      const html = await page.content();
      let shot = null;
      if (screenshot) {
        try {
          const buf = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false });
          shot = `data:image/jpeg;base64,${buf.toString('base64')}`;
        } catch (e) {
          shot = null;
        }
      }

      // Use JSDOM + Readability to extract main article
      const dom = new JSDOM(html, { url: normalizedUrl });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      // Fallback: simple title/description
      const title = (article && article.title) || (dom.window.document.querySelector('title') && dom.window.document.querySelector('title').textContent) || '';
      const excerpt = (article && article.excerpt) || (article && article.textContent && article.textContent.slice(0, 2000)) || '';

      // Extract links and tag counts
      const anchors = Array.from(dom.window.document.querySelectorAll('a[href]'));
      const links = anchors.map(a => {
        try {
          const href = new URL(a.getAttribute('href'), normalizedUrl).toString();
          return { href, text: (a.textContent || '').trim().slice(0, 200) };
        } catch (e) {
          return null;
        }
      }).filter(Boolean);

      const all = Array.from(dom.window.document.getElementsByTagName('*'));
      const tagCounts = {};
      all.forEach(el => {
        const t = el.tagName.toLowerCase();
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      });

      await page.close();
      await context.close();

      return {
        url: normalizedUrl,
        title,
        excerpt: excerpt || (article && article.content ? stripHtml(article.content).slice(0, 2000) : ''),
        content: article ? article.content : '',
        length: article && article.length ? article.length : (article && article.textContent ? article.textContent.length : null),
        links,
        tagCounts,
        screenshot: shot
      };
    } catch (err) {
      try { await page.close(); } catch (e) {}
      try { await context.close(); } catch (e) {}
      throw err;
    }
  });
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch (e) {}
    _browser = null;
  }
}

module.exports = { fetchAndParse, closeBrowser };
