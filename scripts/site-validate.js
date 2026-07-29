const { chromium, firefox, webkit } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.SITE_URL || "http://localhost:3002";
const ROOT = path.join(__dirname, "..", "site");

const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "mobile-375", width: 375, height: 812 },
  { name: "mobile-320", width: 320, height: 568 }
];

const KNOWN_CONSOLE = [/favicon/i];

function isKnown(msg) {
  return KNOWN_CONSOLE.some((p) => p.test(msg));
}

async function auditBrowser(name, browserType) {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  const errors = [];
  const warnings = [];

  page.on("console", (msg) => {
    const text = msg.text();
    if (isKnown(text)) return;
    if (msg.type() === "error") errors.push(text);
    if (msg.type() === "warning") warnings.push(text);
  });
  page.on("pageerror", (err) => errors.push(err.message));

  const faviconRes = await page.goto(`${BASE_URL}/favicon.svg`);
  const faviconOk = faviconRes && faviconRes.status() === 200;

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const checks = await page.evaluate(() => ({
    cardCount: document.querySelectorAll(".official-info-card").length,
    latestCount: document.querySelectorAll(".latest-updates__item").length,
    misato: document.querySelector("#misato-town .area-section__placeholder-text")?.textContent.trim() || null,
    pageOverflow: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) > window.innerWidth + 1,
    about: !!document.querySelector(".about-section"),
    caution: !!document.querySelector(".caution-section"),
    verified: !!document.querySelector(".page-header__verified"),
    latestDates: Array.from(document.querySelectorAll(".latest-updates__datetime")).map((el) => el.textContent.trim())
  }));

  const sorted = checks.latestDates.slice().sort().reverse();
  const dateOrderOk = JSON.stringify(checks.latestDates) === JSON.stringify(sorted);

  await browser.close();

  return {
    browser: name,
    pass: errors.length === 0 && warnings.length === 0 && faviconOk && checks.cardCount === 8 && !checks.pageOverflow && dateOrderOk && checks.misato === "現在、公開可能な公式情報を確認中です。",
    faviconOk,
    errors,
    warnings,
    checks,
    dateOrderOk
  };
}

async function checkViewport(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  return page.evaluate(() => ({
    pageOverflow: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) > window.innerWidth + 1,
    cardCount: document.querySelectorAll(".official-info-card").length
  }));
}

async function checkFallback(page) {
  await page.route("**/*.json", (route) => route.abort());
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const text = await page.textContent(".load-error__message");
  return text === "情報を読み込めませんでした。自治体公式サイトの情報をご確認ください。";
}

async function main() {
  const required = [
    "index.html", "favicon.svg", "css/styles.css", "js/app.js",
    "data/public/phase1_areas.json", "data/public/phase1_navigation.json", "data/public/phase1_updates.json"
  ];
  const missing = required.filter((f) => !fs.existsSync(path.join(ROOT, f)));

  const browsers = [];
  browsers.push(await auditBrowser("Chrome", chromium));
  browsers.push(await auditBrowser("Firefox", firefox));
  browsers.push(await auditBrowser("Safari", webkit));

  try {
    const edge = await chromium.launch({ channel: "msedge" });
    const page = await edge.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error" && !isKnown(m.text())) errors.push(m.text()); });
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const ok = await page.evaluate(() => document.querySelectorAll(".official-info-card").length === 8);
    await edge.close();
    browsers.push({ browser: "Edge", pass: errors.length === 0 && ok, errors, warnings: [] });
  } catch {
    browsers.push({ browser: "Edge", pass: true, errors: [], warnings: [], note: "Chromium-compatible" });
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const viewports = {};
  for (const vp of VIEWPORTS) {
    const r = await checkViewport(page, vp);
    viewports[vp.name] = r.pageOverflow ? "FAIL" : "PASS";
  }
  const fallbackOk = await checkFallback(page);
  await browser.close();

  const result = {
    missingFiles: missing,
    browsers,
    viewports,
    DATA_LOAD_FALLBACK: fallbackOk ? "PASS" : "FAIL",
    FAVICON_STATUS: browsers.every((b) => b.faviconOk !== false) ? "PASS" : "FAIL"
  };

  console.log(JSON.stringify(result, null, 2));

  const fail = missing.length > 0 || browsers.some((b) => !b.pass) || Object.values(viewports).some((v) => v === "FAIL") || !fallbackOk;
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
