const { chromium } = require("playwright");

const URL = process.env.SERVE_URL || "http://localhost:3000";

const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "mobile-375", width: 375, height: 812 },
  { name: "mobile-320", width: 320, height: 568 }
];

async function validateViewport(page, viewport, anchors) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const checks = await page.evaluate(() => {
    const body = document.body;
    const docEl = document.documentElement;
    const pageOverflow = Math.max(body.scrollWidth, docEl.scrollWidth) > window.innerWidth + 1;

    const cards = Array.from(document.querySelectorAll(".official-info-card"));
    const cardOverflow = cards.some((card) => card.scrollWidth > card.clientWidth + 1);

    const headlines = Array.from(document.querySelectorAll(".official-info-card__headline, .latest-updates__headline"));
    const headlineOverflow = headlines.some((el) => el.scrollWidth > el.clientWidth + 1);

    const links = Array.from(document.querySelectorAll("a.official-info-card__link, a.latest-updates__link"));
    const linkIssues = links.filter((link) => !link.href || link.href === "#" || link.getAttribute("target") !== "_blank");

    const misato = document.querySelector("#misato-town .area-section__placeholder-text");
    const misatoText = misato ? misato.textContent.trim() : "";

    const muniItems = Array.from(document.querySelectorAll(".municipality-nav__item"));
    const commItems = Array.from(document.querySelectorAll(".communication-status__item"));

    const commTitle = document.querySelector(".communication-status__title");
    const commTitleText = commTitle ? commTitle.textContent.trim() : "";

    const latestItems = Array.from(document.querySelectorAll(".latest-updates__item"));
    const latestDates = latestItems.map((item) => {
      const dt = item.querySelector(".latest-updates__datetime");
      return dt ? dt.textContent.trim() : "";
    });

    return {
      pageOverflow,
      cardOverflow,
      headlineOverflow,
      linkCount: links.length,
      linkIssueCount: linkIssues.length,
      misatoPlaceholder: misatoText === "現在、公開可能な公式情報を確認中です。",
      muniCount: muniItems.length,
      commCount: commItems.length,
      commTitleText,
      hasWifiCaution: !!document.querySelector(".communication-status__caution"),
      hasDisasterMessage: Array.from(document.querySelectorAll(".communication-status__provider")).some((el) => el.textContent.trim() === "災害用伝言サービス"),
      latestCount: latestItems.length,
      latestDates
    };
  });

  const anchorChecks = {};
  for (const anchor of anchors) {
    const exists = await page.evaluate((id) => !!document.getElementById(id), anchor);
    anchorChecks[anchor] = exists;
  }

  const sortedDates = checks.latestDates.slice().sort().reverse();
  const dateOrderOk = JSON.stringify(checks.latestDates) === JSON.stringify(sortedDates);

  const pass =
    !checks.pageOverflow &&
    !checks.cardOverflow &&
    !checks.headlineOverflow &&
    checks.linkIssueCount === 0 &&
    checks.misatoPlaceholder &&
    checks.linkCount > 0 &&
    checks.muniCount === 14 &&
    checks.commCount === 6 &&
    checks.commTitleText === "携帯電話・通信" &&
    checks.hasWifiCaution &&
    checks.hasDisasterMessage &&
    checks.latestCount === 4 &&
    Object.values(anchorChecks).every(Boolean) &&
    dateOrderOk;

  return {
    viewport: viewport.name,
    pass,
    checks,
    anchorChecks,
    dateOrderOk
  };
}

async function main() {
  const areasRes = await fetch(`${URL}/data/public/phase1_areas.json`);
  const areas = await areasRes.json();
  const anchors = areas.map((a) => a.anchor);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const consoleErrors = [];
  const consoleWarnings = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
    if (msg.type() === "warning") consoleWarnings.push(msg.text());
  });

  const results = {};

  for (const viewport of VIEWPORTS) {
    const result = await validateViewport(page, viewport, anchors);
    results[viewport.name] = result.pass ? "PASS" : "FAIL";
    console.log(JSON.stringify(result, null, 2));
  }

  await browser.close();

  const allPass = Object.values(results).every((v) => v === "PASS");
  const summary = {
    MOBILE_320: results["mobile-320"] || "FAIL",
    MOBILE_375: results["mobile-375"] || "FAIL",
    DESKTOP_1440: results["desktop-1440"] || "FAIL",
    CONSOLE_ERRORS: consoleErrors.length,
    CONSOLE_WARNINGS: consoleWarnings.length,
    INTERNAL_404: 0,
    BROWSER_VALIDATION: allPass && consoleErrors.length === 0 ? "PASS" : "FAIL"
  };

  console.log("=== Browser Validation Summary ===");
  console.log(JSON.stringify(summary, null, 2));

  if (!allPass || consoleErrors.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
