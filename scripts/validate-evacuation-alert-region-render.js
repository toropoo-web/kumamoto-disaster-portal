#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const REGION_FILE = path.join(ROOT, "data", "public", "evacuation_alert_region.json");
const SERVE_URL = process.env.SERVE_URL || "http://localhost:3000";
const RENDER_URL = process.env.RENDER_URL || "https://kumamoto-disaster-portal.onrender.com";

const EXPECTED_MUNICIPALITIES = JSON.parse(fs.readFileSync(REGION_FILE, "utf8")).municipalities;

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    return { ok: false, status: response.status };
  }
  return { ok: true, status: response.status, data: await response.json() };
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    return { ok: false, status: response.status, text: "" };
  }
  return { ok: true, status: response.status, text: await response.text() };
}

async function verifyUi(baseUrl) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const checks = [];
  const errors = [];

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector("#disaster-search-official-post", { timeout: 30000 });
    await page.locator("#disaster-search-official-post").scrollIntoViewIfNeeded();

    const buttonTexts = await page.locator(".evacuation-alert-region__btn").allTextContents();
    const normalizedButtons = buttonTexts.map(function (text) {
      return text.trim();
    });

    checks.push({
      check: "23自治体表示 PASS",
      pass: normalizedButtons.length === 23,
      button_count: normalizedButtons.length
    });
    if (normalizedButtons.length !== 23) {
      errors.push("expected 23 evacuation alert buttons, got " + normalizedButtons.length);
    }

    EXPECTED_MUNICIPALITIES.forEach(function (name) {
      const pass = normalizedButtons.indexOf(name) !== -1;
      checks.push({ check: name + " PASS", pass: pass });
      if (!pass) {
        errors.push("missing button: " + name);
      }
    });

    const navCount = await page.locator(".municipality-nav__item").count();
    checks.push({
      check: "既存ナビ影響なし PASS",
      pass: navCount === 23,
      navigation_count: navCount
    });
    if (navCount !== 23) {
      errors.push("municipality nav count changed: " + navCount);
    }

    const sampleMunicipalities = ["熊本市", "霧島市", "阿蘇市", "南阿蘇村"];
    for (let i = 0; i < sampleMunicipalities.length; i += 1) {
      const name = sampleMunicipalities[i];
      const button = page.locator(
        '.evacuation-alert-region__btn[data-municipality="' + name + '"]'
      );
      await button.click();
      const inputValue = await page.locator("#disaster-search-official-post-input").inputValue();
      const resultsText = await page.locator("#disaster-search-official-post-results").innerText();
      const pass = inputValue === name && resultsText.trim().length > 0;
      checks.push({
        check: "検索連携 PASS: " + name,
        pass: pass,
        input_value: inputValue,
        results_preview: resultsText.trim().slice(0, 80)
      });
      if (!pass) {
        errors.push("search integration failed for " + name);
      }
    }
  } finally {
    await browser.close();
  }

  return { checks: checks, errors: errors };
}

async function verifyRenderArtifacts() {
  const checks = [];
  const errors = [];

  const jsonResult = await fetchJson(RENDER_URL + "/data/public/evacuation_alert_region.json");
  checks.push({
    check: "Render evacuation_alert_region.json available",
    pass: jsonResult.ok,
    status: jsonResult.status
  });
  if (!jsonResult.ok) {
    errors.push("Render evacuation_alert_region.json not available (HTTP " + jsonResult.status + ")");
  } else {
    const municipalities = Array.isArray(jsonResult.data.municipalities)
      ? jsonResult.data.municipalities
      : [];
    checks.push({
      check: "Render JSON municipality count",
      pass: municipalities.length === 23,
      municipality_count: municipalities.length
    });
    if (municipalities.length !== 23) {
      errors.push("Render JSON municipality count is " + municipalities.length);
    }
  }

  const appResult = await fetchText(RENDER_URL + "/js/app.js");
  const hasLoader = appResult.ok && /loadEvacuationAlertRegion/.test(appResult.text);
  const hasButtons = appResult.ok && /evacuation-alert-region__btn/.test(appResult.text);
  checks.push({
    check: "Render app.js includes evacuation alert UI",
    pass: hasLoader && hasButtons
  });
  if (!hasLoader || !hasButtons) {
    errors.push("Render app.js does not include evacuation alert region UI");
  }

  return { checks: checks, errors: errors };
}

async function main() {
  const errors = [];
  const checks = [];

  const regionPayload = JSON.parse(fs.readFileSync(REGION_FILE, "utf8"));
  checks.push({
    check: "evacuation_alert_region.json in static build list",
    pass: fs.readFileSync(path.join(ROOT, "scripts", "static-build.js"), "utf8").indexOf(
      "data/public/evacuation_alert_region.json"
    ) !== -1
  });
  checks.push({
    check: "local evacuation_alert_region.json count",
    pass: regionPayload.municipalities.length === 23,
    municipality_count: regionPayload.municipalities.length
  });

  const localUi = await verifyUi(SERVE_URL);
  checks.push.apply(checks, localUi.checks.map(function (item) {
    return Object.assign({}, item, { scope: "local" });
  }));
  errors.push.apply(errors, localUi.errors);

  const renderArtifacts = await verifyRenderArtifacts();
  checks.push.apply(checks, renderArtifacts.checks.map(function (item) {
    return Object.assign({}, item, { scope: "render" });
  }));
  errors.push.apply(errors, renderArtifacts.errors);

  let renderUi = { checks: [], errors: [{ message: "skipped: render artifacts missing" }] };
  if (renderArtifacts.errors.length === 0) {
    renderUi = await verifyUi(RENDER_URL);
    checks.push.apply(checks, renderUi.checks.map(function (item) {
      return Object.assign({}, item, { scope: "render-ui" });
    }));
    errors.push.apply(errors, renderUi.errors);
  }

  const output = {
    EVACUATION_ALERT_REGION_RENDER_VERIFY: errors.length === 0 ? "PASS" : "FAIL",
    serve_url: SERVE_URL,
    render_url: RENDER_URL,
    checks: checks,
    errors: errors
  };

  console.log("=== Evacuation Alert Region Render Verify ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
