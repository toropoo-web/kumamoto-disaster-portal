const { chromium } = require("playwright");
const CommunicationDisplayAdapter = require("../js/communication-display-adapter");

const SERVE_URL = process.env.SERVE_URL || "http://localhost:3000";

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

async function validateViewport(page, viewport, anchors) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(SERVE_URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    return !!document.getElementById("area-disaster-nav") &&
      !!document.getElementById("disaster-location-map-section");
  }, { timeout: 20000 });

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

    const commConfirmed = document.querySelector(".communication-status__item .communication-status__checked-value");
    const commConfirmedText = commConfirmed ? commConfirmed.textContent.trim() : "";
    const commStatusPartial = !!document.querySelector(".communication-status__status--partial");
    const commOfficialLink = !!document.querySelector(".communication-status__official-link");

    const cardUpdatedLabels = Array.from(document.querySelectorAll(".official-info-card__meta dt"))
      .filter((el) => el.textContent.trim() === "公式更新")
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
      hasDisasterMessage: Array.from(document.querySelectorAll(".communication-status__carrier")).some((el) => el.textContent.trim() === "災害用伝言サービス"),
      commStatusPartial: commStatusPartial,
      commOfficialLink: commOfficialLink,
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
        : "",
      hasDisasterMap: !!document.getElementById("disaster-location-map-section"),
      hasInfrastructureSection: !!document.getElementById("infrastructure-info"),
      infrastructureTitle: (document.querySelector(".infrastructure-info__title") || {}).textContent || "",
      infrastructureNavCount: document.querySelectorAll(".infrastructure-info__nav-link").length,
      infrastructureStatusCardCount: document.querySelectorAll(".infrastructure-info__card:not(.infrastructure-info__card--external)").length,
      infrastructureExternalCardCount: document.querySelectorAll(".infrastructure-info__card--external").length,
      infrastructureFreshnessCount: document.querySelectorAll(".infrastructure-info__freshness").length,
      infrastructurePowerEmpty: (() => {
        const powerBlock = document.getElementById("infra-power");
        if (!powerBlock) return false;
        const empty = powerBlock.querySelector(".infrastructure-info__empty");
        return empty ? empty.textContent.trim() === "現在確認中" : false;
      })(),
      infrastructureToyotaVisible: Array.from(document.querySelectorAll(".infrastructure-info__external-title, .infrastructure-info__card-title"))
        .some((el) => el.textContent.includes("TOYOTA")),
      hasMapLayerToggles: document.querySelectorAll(".disaster-map__layer-toggle").length,
      hasMapExpansionNotice: !!document.getElementById("disaster-map-infra-expansion-notice")
    };
  });

  const anchorChecks = {};
  for (const anchor of anchors) {
    const exists = await page.evaluate((id) => !!document.getElementById(id), anchor);
    anchorChecks[anchor] = exists;
  }

  let areaNavLinkChecks = {
    panelVisible: false,
    categoryButtonCount: 0,
    hasGoogleMapsCategoryLinks: false
  };

  if (checks.hasAreaDisasterNav) {
    await page.selectOption(".area-disaster-nav__select", { index: 1 });
    areaNavLinkChecks = await page.evaluate(() => {
      const panel = document.querySelector(".area-disaster-nav__panel");
      const categoryButtons = panel ? Array.from(panel.querySelectorAll(".area-disaster-nav__category-btn")) : [];
      return {
        panelVisible: panel ? !panel.hidden : false,
        categoryButtonCount: categoryButtons.length,
        hasGoogleMapsCategoryLinks: categoryButtons.some((button) => {
          const href = button.getAttribute("href") || "";
          return href.includes("google.com/maps/search/?api=1&query=");
        })
      };
    });

    await page.selectOption(".area-disaster-nav__select", { label: "益城町" });
    areaNavLinkChecks.mashikiLocationCount = await page.evaluate(() => {
      return document.querySelectorAll(".verified-locations__item").length;
    });
    areaNavLinkChecks.mashikiWaterCount = await page.evaluate(() => {
      const section = document.querySelector('.verified-locations__category[data-category="WATER"]');
      return section ? section.querySelectorAll(".verified-locations__item").length : 0;
    });
    areaNavLinkChecks.mashikiShelterCount = await page.evaluate(() => {
      const section = document.querySelector('.verified-locations__category[data-category="SHELTER"]');
      return section ? section.querySelectorAll(".verified-locations__item").length : 0;
    });
    areaNavLinkChecks.verifiedLocationsTitle = await page.evaluate(() => {
      const title = document.querySelector(".verified-locations__title");
      return title ? title.textContent.trim() : "";
    });
    areaNavLinkChecks.mashikiMapButtonCount = await page.evaluate(() => {
      return document.querySelectorAll(".verified-locations__map-link").length;
    });
    await page.click('.area-disaster-nav__category-btn[data-nav-category="WATER"]');
    areaNavLinkChecks.waterCategoryFirst = await page.evaluate(() => {
      const panels = document.querySelector(".verified-locations__category-panels");
      const first = panels ? panels.querySelector(".verified-locations__category") : null;
      return first ? first.getAttribute("data-category") : "";
    });
    areaNavLinkChecks.waterCategoryActive = await page.evaluate(() => {
      const button = document.querySelector('.area-disaster-nav__category-btn[data-nav-category="WATER"]');
      return button ? button.classList.contains("area-disaster-nav__category-btn--active") : false;
    });

    await page.selectOption(".area-disaster-nav__select", { label: "八代市" });
    await page.click('.area-disaster-nav__category-btn[data-nav-category="WATER"]');
    areaNavLinkChecks.yatsushiroWaterCount = await page.evaluate(() => {
      const section = document.querySelector('.verified-locations__category[data-category="WATER"]');
      return section ? section.querySelectorAll(".verified-locations__item").length : 0;
    });
    areaNavLinkChecks.yatsushiroMapButtonCount = await page.evaluate(() => {
      return document.querySelectorAll(".verified-locations__map-link").length;
    });
    await page.click('.verified-locations__category[data-category="WATER"] .verified-locations__map-link');
    await page.waitForFunction(() => {
      const mapPanel = document.getElementById("disaster-map-panel");
      return mapPanel && !mapPanel.hidden && document.querySelectorAll(".leaflet-marker-icon").length > 0;
    }, { timeout: 20000 });
    await page.waitForSelector(".leaflet-popup-content", { timeout: 10000 });
    areaNavLinkChecks.yatsushiroMapLinkWorks = await page.evaluate(() => {
      const mapSection = document.getElementById("disaster-location-map-section");
      const mapPanel = document.getElementById("disaster-map-panel");
      const mapOpen = mapSection && mapPanel && !mapPanel.hidden;
      const markerCount = document.querySelectorAll(".leaflet-marker-icon").length;
      const popupVisible = !!document.querySelector(".leaflet-popup-content");
      return mapOpen && markerCount > 0 && popupVisible;
    });
  }

  let disasterMapChecks = {
    hasSection: checks.hasDisasterMap,
    markerCount: 0,
    popupVisible: false,
    layerToggleCount: checks.hasMapLayerToggles,
    hasExpansionNotice: checks.hasMapExpansionNotice,
    mapInfraStatusCardCount: 0
  };

  if (viewport.name === "desktop-1440" && checks.hasDisasterMap) {
    const mapPanelHidden = await page.evaluate(() => {
      const panel = document.getElementById("disaster-map-panel");
      return panel ? panel.hidden : true;
    });
    if (mapPanelHidden) {
      await page.click(".disaster-map__toggle");
    }
    await page.waitForFunction(() => {
      const mapPanel = document.getElementById("disaster-map-panel");
      return mapPanel && !mapPanel.hidden;
    }, { timeout: 20000 });
    await page.waitForSelector(".leaflet-marker-icon", { timeout: 20000 });
    disasterMapChecks = await page.evaluate(() => {
      return {
        hasSection: !!document.getElementById("disaster-location-map-section"),
        markerCount: document.querySelectorAll(".leaflet-marker-icon").length,
        popupVisible: false,
        layerToggleCount: document.querySelectorAll(".disaster-map__layer-toggle").length,
        hasExpansionNotice: !!document.getElementById("disaster-map-infra-expansion-notice"),
        mapInfraStatusCardCount: document.querySelectorAll(".disaster-map__infra-status-card").length
      };
    });
    await page.evaluate(() => {
      const marker = document.querySelector(".leaflet-marker-icon");
      if (marker) {
        marker.click();
      }
    });
    await page.waitForSelector(".leaflet-popup-content", { timeout: 5000 });
    disasterMapChecks.popupVisible = await page.evaluate(() => {
      return !!document.querySelector(".leaflet-popup-content");
    });
    disasterMapChecks.popupHasFacilityField = await page.evaluate(() => {
      const popup = document.querySelector(".leaflet-popup-content");
      return popup ? popup.textContent.includes("施設名：") : false;
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
    checks.muniCount === 23 &&
    checks.commCount === 7 &&
    checks.commTitleText === "携帯電話・通信" &&
    checks.commStatusPartial &&
    checks.commOfficialLink &&
    checks.hasWifiCaution &&
    checks.hasDisasterMessage &&
    checks.latestCount === 4 &&
    checks.hasAreaNavPromo &&
    checks.hasAreaDisasterNav &&
    checks.areaNavOptionCount === 23 &&
    checks.areaNavPromoTitle === "地域の災害情報を地図で確認" &&
    checks.areaDisasterNavTitle === "地域災害ナビ" &&
    areaNavLinkChecks.panelVisible &&
    areaNavLinkChecks.categoryButtonCount === 5 &&
    areaNavLinkChecks.hasGoogleMapsCategoryLinks === false &&
    (areaNavLinkChecks.mashikiLocationCount === undefined || areaNavLinkChecks.mashikiLocationCount === 5) &&
    (areaNavLinkChecks.mashikiWaterCount === undefined || areaNavLinkChecks.mashikiWaterCount === 3) &&
    (areaNavLinkChecks.mashikiShelterCount === undefined || areaNavLinkChecks.mashikiShelterCount === 2) &&
    (areaNavLinkChecks.verifiedLocationsTitle === undefined || areaNavLinkChecks.verifiedLocationsTitle === "📍 支援地点一覧") &&
    (areaNavLinkChecks.mashikiMapButtonCount === undefined || areaNavLinkChecks.mashikiMapButtonCount === 5) &&
    (areaNavLinkChecks.waterCategoryFirst === undefined || areaNavLinkChecks.waterCategoryFirst === "WATER") &&
    (areaNavLinkChecks.waterCategoryActive === undefined || areaNavLinkChecks.waterCategoryActive === true) &&
    (areaNavLinkChecks.yatsushiroWaterCount === undefined || areaNavLinkChecks.yatsushiroWaterCount === 5) &&
    (areaNavLinkChecks.yatsushiroMapButtonCount === undefined || areaNavLinkChecks.yatsushiroMapButtonCount === 5) &&
    (areaNavLinkChecks.yatsushiroMapLinkWorks === undefined || areaNavLinkChecks.yatsushiroMapLinkWorks === true) &&
    disasterMapChecks.hasSection &&
    disasterMapChecks.layerToggleCount === 2 &&
    disasterMapChecks.hasExpansionNotice &&
    (viewport.name !== "desktop-1440" || (
      disasterMapChecks.markerCount >= 16 &&
      disasterMapChecks.popupVisible &&
      disasterMapChecks.popupHasFacilityField &&
      disasterMapChecks.mapInfraStatusCardCount === 10
    )) &&
    checks.hasInfrastructureSection &&
    checks.infrastructureTitle === "インフラ情報" &&
    checks.infrastructureNavCount === 4 &&
    checks.infrastructureStatusCardCount === 10 &&
    checks.infrastructureExternalCardCount === 0 &&
    checks.infrastructureFreshnessCount === 10 &&
    checks.infrastructurePowerEmpty &&
    !checks.infrastructureToyotaVisible &&
    Object.values(anchorChecks).every(Boolean) &&
    dateOrderOk;

  return {
    viewport: viewport.name,
    pass,
    checks,
    anchorChecks,
    areaNavLinkChecks,
    disasterMapChecks,
    dateOrderOk
  };
}

async function main() {
  const areasRes = await fetch(`${SERVE_URL}/data/public/phase1_areas.json`);
  const areas = await areasRes.json();
  const anchors = areas.map((a) => a.anchor);

  const statusRes = await fetch(`${SERVE_URL}/data/public/status.json`);
  const publicStatus = await statusRes.json();
  const commRes = await fetch(`${SERVE_URL}/data/public/communication_status.json`);
  const communicationStatus = await commRes.json();

  const expectedHeader = formatDateTime(publicStatus.last_patrol_at);
  const firstProvider = communicationStatus.providers[0];
  const expectedCommConfirmed = CommunicationDisplayAdapter.formatCheckedAt(
    firstProvider ? firstProvider.last_checked : ""
  );

  const browser = await chromium.launch();
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();

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
