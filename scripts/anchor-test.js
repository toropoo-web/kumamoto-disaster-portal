const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("http://localhost:3002", { waitUntil: "networkidle" });

  const anchors = ["kumamoto-pref", "kumamoto-city", "uto-city", "uki-city", "misato-town"];
  const results = {};

  for (const anchor of anchors) {
    await page.click(`a[href="#${anchor}"]`);
    await page.waitForTimeout(800);
    const rect = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, ih: window.innerHeight };
    }, anchor);
    results[anchor] = rect ? rect.top < rect.ih && rect.bottom > 56 : false;
    results[anchor + "_rect"] = rect;
  }

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();
