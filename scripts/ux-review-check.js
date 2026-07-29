const { chromium } = require("playwright");
const path = require("path");

const BASE_URL = "http://localhost:3002";
const SCREENSHOTS = path.join(__dirname, "..", "site", "screenshots");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (const vp of [
    { name: "desktop-1440", w: 1440, h: 900 },
    { name: "tablet-768", w: 768, h: 1024 },
    { name: "mobile-375", w: 375, h: 812 },
    { name: "mobile-320", w: 320, h: 568 }
  ]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SCREENSHOTS, `${vp.name}.png`), fullPage: false });
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  const ux = await page.evaluate(() => {
    const firstArea = document.getElementById("kumamoto-pref");
    const nav = document.querySelector(".municipality-nav");
    const latest = document.querySelector(".latest-updates");
    const emergency = document.querySelector(".emergency-notice");
    const header = document.querySelector(".page-header");
    return {
      latestCount: document.querySelectorAll(".latest-updates__item").length,
      cardCount: document.querySelectorAll(".official-info-card").length,
      firstAreaOffset: firstArea ? firstArea.offsetTop : null,
      navBottom: nav ? nav.getBoundingClientRect().bottom : null,
      latestLinkText: document.querySelector(".latest-updates__link")?.textContent.trim(),
      cardLinkText: document.querySelector(".official-info-card__link")?.textContent.trim(),
      subtitle: document.querySelector(".page-header__subtitle")?.textContent.trim(),
      lead: document.querySelector(".latest-updates__lead")?.textContent.trim(),
      emergencyVisible: emergency ? emergency.getBoundingClientRect().bottom > 0 : false,
      headerHeight: header?.offsetHeight,
      viewport: window.innerHeight
    };
  });

  console.log(JSON.stringify(ux, null, 2));
  await browser.close();
})();
