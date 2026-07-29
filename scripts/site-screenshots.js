const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..", "site");
const SCREENSHOTS_DIR = path.join(ROOT, "screenshots");
const URL = process.env.SITE_URL || "http://localhost:3002";

const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "mobile-375", width: 375, height: 812 },
  { name: "mobile-320", width: 320, height: 568 }
];

async function main() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, `${viewport.name}.png`),
      fullPage: true
    });
    console.log(`Captured: ${viewport.name}.png`);
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
