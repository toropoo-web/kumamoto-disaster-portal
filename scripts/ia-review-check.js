const { chromium } = require("playwright");

const BASE_URL = process.env.SITE_URL || "http://localhost:3002";
const CATEGORY_ANCHORS = ["cat-emergency", "cat-shelter", "cat-water", "cat-support"];
const MUNI_ANCHORS = ["kumamoto-pref", "kumamoto-city", "uto-city", "uki-city", "misato-town"];

async function checkViewport(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);

  const base = await page.evaluate(() => ({
    muniLabel: document.querySelector(".page-nav__label")?.textContent || null,
    catLabel: document.querySelectorAll(".page-nav__label")[1]?.textContent || null,
    catLinks: Array.from(document.querySelectorAll(".category-nav__link")).map((a) => ({
      text: a.textContent,
      href: a.getAttribute("href")
    })),
    catAnchors: ["cat-emergency", "cat-shelter", "cat-water", "cat-support"].map((id) => ({
      id,
      exists: !!document.getElementById(id)
    })),
    categoryHeadings: document.querySelectorAll(".area-section__category-title").length,
    cardCount: document.querySelectorAll(".official-info-card").length,
    pageOverflow:
      Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) > window.innerWidth + 1,
    misatoPlaceholder:
      document.querySelector("#misato-town .area-section__placeholder-text")?.textContent.trim() || null
  }));

  const catResults = {};
  for (const id of CATEGORY_ANCHORS) {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(200);
    const selector = `a[href="#${id}"]`;
    const hasLink = await page.$(selector);
    if (!hasLink) {
      catResults[id] = { ok: false, reason: "no-link" };
      continue;
    }
    await page.click(selector);
    await page.waitForTimeout(800);
    catResults[id] = await page.evaluate((anchorId) => {
      const el = document.getElementById(anchorId);
      const navH = document.querySelector(".page-nav")?.offsetHeight || 0;
      if (!el) {
        return { ok: false, reason: "no-anchor" };
      }
      const rect = el.getBoundingClientRect();
      return { ok: rect.top >= 0 && rect.top <= navH + 20, top: rect.top, navH };
    }, id);
  }

  const muniResults = {};
  for (const id of MUNI_ANCHORS) {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(200);
    await page.click(`a[href="#${id}"]`);
    await page.waitForTimeout(800);
    muniResults[id] = await page.evaluate((anchorId) => {
      const el = document.getElementById(anchorId);
      const navH = document.querySelector(".page-nav")?.offsetHeight || 0;
      if (!el) {
        return { ok: false };
      }
      const rect = el.getBoundingClientRect();
      return { ok: rect.top >= 0 && rect.top <= navH + 20, top: rect.top, navH };
    }, id);
  }

  return { base, catResults, muniResults };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const viewports = [
    { name: "mobile-375", width: 375, height: 812 },
    { name: "mobile-320", width: 320, height: 568 },
    { name: "tablet-768", width: 768, height: 1024 },
    { name: "desktop-1440", width: 1440, height: 900 }
  ];

  const results = {};
  for (const vp of viewports) {
    results[vp.name] = await checkViewport(page, vp.width, vp.height);
  }

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();
