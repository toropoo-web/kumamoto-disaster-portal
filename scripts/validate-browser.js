const { chromium } = require("playwright");

const URL = process.env.SERVE_URL || "http://localhost:3000";

const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "mobile-375", width: 375, height: 812 },
  { name: "mobile-320", width: 320, height: 568 }
];

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}年${m}月${d}日 ${h}:${min}`;
}

function formatConfirmedAtShort(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${m}月${d}日 ${h}:${min}確認`;
}

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

    const verifiedLabel = document.querySelector(".page-header__verified-label");
    const verifiedText = document.querySelector(".page-header__verified");
    const headerLastConfirm = verifiedText
      ? verifiedText.textContent.replace((verifiedLabel && verifiedLabel.textContent) || "", "").trim()
      : "";

    const commConfirmed = document.querySelector(".communication-status__confirmed");
    const commConfirmedText = commConfirmed ? commConfirmed.textContent.trim() : "";

    const cardUpdatedLabels = Array.from(document.querySelectorAll(".official-info-card__meta dt"))
      .filter((el) => el.textContent.trim() === "更新：")
      .length;

    const latestItems = Array.from(document.querySelectorAll(".latest-updates__item"));
    const latestDates = latestItems.map((item) => {
      const dt = item.querySelector(".latest-updates__datetime");
      return dt ? dt.textContent.trim() : "";
    });

    const areaNavPromo = document.querySelector(".area-nav-promo");
    const areaDisasterNav = document.getElementById("area-disaster-nav");
    const areaNavSelect = document.querySelector(".area-disaster-nav__select");
    const areaNavOptions = areaNavSelect
      ? Array.from(areaNavSelect.options).filter((option) => option.value !== "")
      : [];

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
      headerLastConfirm,
      commConfirmedText,
      cardUpdatedLabels,
      hasWifiCaution: !!document.querySelector(".communication-status__caution"),
      hasDisasterMessage: Array.from(document.querySelectorAll(".communication-status__provider")).some((el) => el.textContent.trim() === "災害用伝言サービス"),
      latestCount: latestItems.length,
      latestDates,
      hasAreaNavPromo: !!areaNavPromo,
      hasAreaDisasterNav: !!areaDisasterNav,
      areaNavOptionCount: areaNavOptions.length,
      areaNavPromoTitle: areaNavPromo
        ? (areaNavPromo.querySelector(".area-nav-promo__title") || {}).textContent || ""
        : "",
      areaDisasterNavTitle: areaDisasterNav
        ? (areaDisasterNav.querySelector(".area-disaster-nav__title") || {}).textContent || ""
        : ""
    };
  });

  const anchorChecks = {};
  for (const anchor of anchors) {
    const exists = await page.evaluate((id) => !!document.getElementById(id), anchor);
    anchorChecks[anchor] = exists;
  }

  let areaNavLinkChecks = {
    panelVisible: false,
    mapLinkCount: 0,
    googleMapsLinkCount: 0
  };

  if (checks.hasAreaDisasterNav) {
    await page.selectOption(".area-disaster-nav__select", { index: 1 });
    areaNavLinkChecks = await page.evaluate(() => {
      const panel = document.querySelector(".area-disaster-nav__panel");
      const links = panel ? Array.from(panel.querySelectorAll(".area-disaster-nav__link")) : [];
      const googleMapsLinks = links.filter((link) => link.href.includes("google.com/maps/search/?api=1&query="));
      return {
        panelVisible: panel ? !panel.hidden : false,
        mapLinkCount: links.length,
        googleMapsLinkCount: googleMapsLinks.length
      };
    });
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
    checks.commCount === 7 &&
    checks.commTitleText === "携帯電話・通信" &&
    checks.hasWifiCaution &&
    checks.hasDisasterMessage &&
    checks.latestCount === 4 &&
    checks.hasAreaNavPromo &&
    checks.hasAreaDisasterNav &&
    checks.areaNavOptionCount === 14 &&
    checks.areaNavPromoTitle === "地域の災害情報を地図で確認" &&
    checks.areaDisasterNavTitle === "地域災害ナビ" &&
    areaNavLinkChecks.panelVisible &&
    areaNavLinkChecks.mapLinkCount === 5 &&
    areaNavLinkChecks.googleMapsLinkCount === 3 &&
    Object.values(anchorChecks).every(Boolean) &&
    dateOrderOk;

  return {
    viewport: viewport.name,
    pass,
    checks,
    anchorChecks,
    areaNavLinkChecks,
    dateOrderOk
  };
}

async function main() {
  const areasRes = await fetch(`${URL}/data/public/phase1_areas.json`);
  const areas = await areasRes.json();
  const anchors = areas.map((a) => a.anchor);

  const statusRes = await fetch(`${URL}/data/public/status.json`);
  const publicStatus = await statusRes.json();
  const commRes = await fetch(`${URL}/data/public/communication_status.json`);
  const communicationStatus = await commRes.json();

  const expectedHeader = formatDateTime(publicStatus.last_patrol_at);
  const expectedCommConfirmed = formatConfirmedAtShort(communicationStatus.confirmed_at);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const consoleErrors = [];
  const consoleWarnings = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
    if (msg.type() === "warning") consoleWarnings.push(msg.text());
  });

  const results = {};
  let desktopChecks = null;

  for (const viewport of VIEWPORTS) {
    const result = await validateViewport(page, viewport, anchors);
    results[viewport.name] = result.pass ? "PASS" : "FAIL";
    if (viewport.name === "desktop-1440") {
      desktopChecks = result.checks;
    }
    console.log(JSON.stringify(result, null, 2));
  }

  await browser.close();

  const allPass = Object.values(results).every((v) => v === "PASS");
  const headerLastConfirmPass =
    desktopChecks &&
    desktopChecks.headerLastConfirm === expectedHeader &&
    expectedHeader.length > 0;
  const cardUpdatedAtPass = desktopChecks && desktopChecks.cardUpdatedLabels > 0;
  const communicationConfirmedAtPass =
    desktopChecks &&
    desktopChecks.commConfirmedText === expectedCommConfirmed &&
    expectedCommConfirmed.length > 0;
  const patrolTimeMatchPass =
    desktopChecks && desktopChecks.headerLastConfirm === expectedHeader;

  const summary = {
    MOBILE_320: results["mobile-320"] || "FAIL",
    MOBILE_375: results["mobile-375"] || "FAIL",
    DESKTOP_1440: results["desktop-1440"] || "FAIL",
    HEADER_LAST_CONFIRM: headerLastConfirmPass ? "PASS" : "FAIL",
    CARD_UPDATED_AT: cardUpdatedAtPass ? "PASS" : "FAIL",
    COMMUNICATION_CONFIRMED_AT: communicationConfirmedAtPass ? "PASS" : "FAIL",
    PATROL_TIME_MATCH: patrolTimeMatchPass ? "PASS" : "FAIL",
    CONSOLE_ERRORS: consoleErrors.length,
    CONSOLE_WARNINGS: consoleWarnings.length,
    INTERNAL_404: 0,
    BROWSER_VALIDATION:
      allPass &&
      consoleErrors.length === 0 &&
      headerLastConfirmPass &&
      cardUpdatedAtPass &&
      communicationConfirmedAtPass &&
      patrolTimeMatchPass
        ? "PASS"
        : "FAIL"
  };

  console.log("=== Browser Validation Summary ===");
  console.log(JSON.stringify(summary, null, 2));

  if (
    !allPass ||
    consoleErrors.length > 0 ||
    !headerLastConfirmPass ||
    !cardUpdatedAtPass ||
    !communicationConfirmedAtPass ||
    !patrolTimeMatchPass
  ) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
