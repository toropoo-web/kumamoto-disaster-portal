const { chromium, firefox, webkit } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.SITE_URL || "http://localhost:3002";
const ROOT = path.join(__dirname, "..", "site");
const SCREENSHOTS = path.join(ROOT, "screenshots");

const FORBIDDEN_WORDS = [
  "リアルタイム", "常時更新", "速報", "完全", "すべての情報",
  "安全を保証", "被害なし", "情報なし"
];

const SOURCE_URLS = [
  { area: "熊本県", url: "https://www.pref.kumamoto.jp/soshiki/1/274517.html" },
  { area: "熊本県", url: "https://www.pref.kumamoto.jp/site/chiji/274483.html" },
  { area: "熊本県", url: "https://www.pref.kumamoto.jp/soshiki/27/274494.html" },
  { area: "熊本市", url: "https://city-kumamoto.my.salesforce-sites.com/X_PUB_VF_KUMA_HinanjyoNaviList" },
  { area: "宇土市", url: "https://www.city.uto.lg.jp/article/view/1014/16317.html" },
  { area: "宇土市", url: "https://www.city.uto.lg.jp/article/view/1014/16322.html" },
  { area: "宇土市", url: "https://www.city.uto.lg.jp/article/view/1014/16312.html" },
  { area: "宇城市", url: "https://www.city.uki.kumamoto.jp/kinkyu/2606699" }
];

const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "mobile-375", width: 375, height: 812 },
  { name: "mobile-320", width: 320, height: 568 }
];

async function checkLinks() {
  const results = [];
  for (const item of SOURCE_URLS) {
    try {
      const res = await fetch(item.url, { method: "HEAD", redirect: "follow" });
      const https = item.url.startsWith("https://");
      results.push({
        area: item.area,
        url: item.url,
        status: res.status,
        https,
        pass: res.ok && https
      });
    } catch (err) {
      results.push({ area: item.area, url: item.url, status: 0, pass: false, error: err.message });
    }
  }
  return results;
}

async function runPageAudit(page, viewport) {
  const errors = [];
  const warnings = [];
  const failed404 = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
    if (msg.type() === "warning") warnings.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("response", (res) => {
    if (res.status() === 404) failed404.push(res.url());
  });

  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const audit = await page.evaluate((forbidden) => {
    const bodyText = document.body.innerText;
    const forbiddenFound = forbidden.filter((w) => bodyText.includes(w));
    const h1s = document.querySelectorAll("h1");
    const redElements = Array.from(document.querySelectorAll("*")).filter((el) => {
      const c = getComputedStyle(el).color;
      return c === "rgb(180, 35, 24)" || c === "rgb(176, 35, 24)";
    });

    const anchors = ["kumamoto-pref", "kumamoto-city", "uto-city", "uki-city", "misato-town"];
    const anchorResults = {};
    anchors.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView();
        const rect = el.getBoundingClientRect();
        anchorResults[id] = rect.top < window.innerHeight && rect.bottom > 0;
      } else {
        anchorResults[id] = false;
      }
    });

    const latestDates = Array.from(document.querySelectorAll(".latest-updates__datetime")).map((el) => el.textContent.trim());
    const sorted = latestDates.slice().sort().reverse();

    return {
      title: document.title,
      h1Count: h1s.length,
      hasMain: !!document.querySelector("main"),
      hasNav: !!document.querySelector("nav"),
      hasFooter: !!document.querySelector("footer"),
      hasAbout: !!document.querySelector(".about-section"),
      hasEmergency: !!document.querySelector(".emergency-notice"),
      emergencyText: document.querySelector(".emergency-notice__text")?.textContent.trim() || "",
      verifiedLabel: document.querySelector(".page-header__verified-label")?.textContent.trim() || "",
      subtitle: document.querySelector(".page-header__subtitle")?.textContent.trim() || "",
      areas: document.querySelector(".page-header__areas")?.textContent.trim() || "",
      cardCount: document.querySelectorAll(".official-info-card").length,
      latestCount: document.querySelectorAll(".latest-updates__item").length,
      misato: document.querySelector("#misato-town .area-section__placeholder-text")?.textContent.trim() || null,
      pageOverflow: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) > window.innerWidth + 1,
      forbiddenFound,
      redOnlyEmergency: redElements.every((el) => el.closest(".emergency-notice")),
      latestDates,
      dateOrderOk: JSON.stringify(latestDates) === JSON.stringify(sorted),
      linkCount: document.querySelectorAll("a[href^='http']").length,
      anchorResults,
      bodyFont: parseFloat(getComputedStyle(document.body).fontSize),
      minLinkHeight: Math.min(...Array.from(document.querySelectorAll("a")).map((a) => a.getBoundingClientRect().height).filter((h) => h > 0))
    };
  }, FORBIDDEN_WORDS);

  return { viewport: viewport.name, errors, warnings, failed404, audit };
}

async function checkFallback(page) {
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  await page.route("**/*.json", (route) => route.abort());
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => ({
    title: document.title,
    message: document.querySelector(".load-error__message")?.textContent.trim() || null,
    hasEmergency: !!document.querySelector(".emergency-notice"),
    bodyEmpty: document.body.innerText.trim().length < 20,
    hasJsErrorText: document.body.innerText.includes("Error") || document.body.innerText.includes("Failed")
  }));
  return { ...result, consoleErrors: errors };
}

async function checkKeyboard(page) {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.keyboard.press("Tab");
  let focusLost = 0;
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    const tag = await page.evaluate(() => document.activeElement?.tagName || "");
    if (!tag) focusLost++;
  }
  return focusLost === 0;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const viewportAudits = [];
  for (const vp of VIEWPORTS) {
    const p = await browser.newPage();
    viewportAudits.push(await runPageAudit(p, vp));
    await p.close();
  }

  const fallback = await checkFallback(await browser.newPage());
  const keyboardOk = await checkKeyboard(await browser.newPage());

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(SCREENSHOTS, "final-review-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(SCREENSHOTS, "final-review-mobile.png"), fullPage: true });
  await browser.close();

  const linkAudit = await checkLinks();

  const browsers = [];
  for (const [name, type] of [["Chrome", chromium], ["Firefox", firefox], ["Safari", webkit]]) {
    const b = await type.launch();
    const p = await b.newPage();
    const errs = [];
    p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await p.goto(BASE_URL, { waitUntil: "networkidle" });
    const ok = await p.evaluate(() => document.querySelectorAll(".official-info-card").length === 8);
    await b.close();
    browsers.push({ browser: name, pass: errs.length === 0 && ok, errors: errs });
  }

  const allErrors = viewportAudits.flatMap((v) => v.errors);
  const allWarnings = viewportAudits.flatMap((v) => v.warnings);
  const all404 = [...new Set(viewportAudits.flatMap((v) => v.failed404))];
  const mobile375 = viewportAudits.find((v) => v.viewport === "mobile-375");
  const mobile320 = viewportAudits.find((v) => v.viewport === "mobile-320");

  const result = {
    viewportAudits: viewportAudits.map((v) => ({
      viewport: v.viewport,
      pass: v.errors.length === 0 && v.warnings.length === 0 && v.failed404.length === 0 && !v.audit.pageOverflow,
      errors: v.errors,
      warnings: v.warnings,
      failed404: v.failed404,
      audit: v.audit
    })),
    fallback,
    keyboardOk,
    linkAudit,
    browsers,
    consoleErrors: allErrors.length,
    consoleWarnings: allWarnings.length,
    http404: all404.length
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
