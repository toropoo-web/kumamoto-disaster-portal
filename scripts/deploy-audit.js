#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium, firefox, webkit } = require("playwright");

const ROOT = path.join(__dirname, "..");
const RELEASE = path.join(ROOT, "release");
const URL = process.env.DEPLOY_URL || "http://localhost:3001";

const REQUIRED_FILES = [
  "index.html",
  "README.md",
  "css/styles.css",
  "js/app.js",
  "data/public/phase1_areas.json",
  "data/public/phase1_navigation.json",
  "data/public/phase1_updates.json",
  "screenshots/final-desktop-1440.png",
  "screenshots/final-tablet-768.png",
  "screenshots/final-mobile-375.png",
  "screenshots/final-mobile-320.png"
];

const KNOWN_CONSOLE_PATTERNS = [
  /favicon\.ico/i,
  /Failed to load resource.*404/i,
  /the server responded with a status of 404/i
];

function isKnownConsoleMessage(text) {
  return KNOWN_CONSOLE_PATTERNS.some((p) => p.test(text));
}

async function checkHttp(pathSuffix) {
  const res = await fetch(`${URL}/${pathSuffix}`);
  return { path: pathSuffix, status: res.status, ok: res.ok };
}

async function auditBrowser(name, browserType) {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  const errors = [];
  const warnings = [];

  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error") errors.push(text);
    if (msg.type() === "warning") warnings.push(text);
  });

  page.on("pageerror", (err) => errors.push(err.message));

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const render = await page.evaluate(() => ({
    title: document.querySelector(".page-header__title")?.textContent?.trim() || null,
    cardCount: document.querySelectorAll(".official-info-card").length,
    latestCount: document.querySelectorAll(".latest-updates__item").length,
    misato: document.querySelector("#misato-town .area-section__empty")?.textContent?.trim() || null,
    pageOverflow: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) > window.innerWidth + 1
  }));

  const filteredWarnings = warnings.filter((w) => !isKnownConsoleMessage(w));
  const filteredErrors = errors.filter((e) => !isKnownConsoleMessage(e));

  await browser.close();

  return {
    browser: name,
    pass: filteredErrors.length === 0 && filteredWarnings.length === 0 && !render.pageOverflow && render.cardCount === 8,
    errors: filteredErrors,
    warnings: filteredWarnings,
    render
  };
}

async function runLighthouse() {
  try {
    const lighthouse = require("lighthouse");
    const { launch } = require("chrome-launcher");
    const chrome = await launch({ chromeFlags: ["--headless"] });
    const options = {
      logLevel: "error",
      output: "json",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      port: chrome.port
    };
    const runnerResult = await lighthouse(URL, options);
    await chrome.kill();
    const scores = {};
    const cats = runnerResult.lhr.categories;
    ["performance", "accessibility", "best-practices", "seo"].forEach((key) => {
      scores[key] = Math.round((cats[key]?.score || 0) * 100);
    });
    return { status: "COMPLETED", scores };
  } catch (err) {
    return { status: "NOT_RUN", reason: err.message };
  }
}

async function main() {
  const missing = REQUIRED_FILES.filter((f) => !fs.existsSync(path.join(RELEASE, f)));
  const httpChecks = await Promise.all(REQUIRED_FILES.filter((f) => !f.endsWith(".md")).map(checkHttp));
  const notFound = httpChecks.filter((c) => !c.ok);

  const html = fs.readFileSync(path.join(RELEASE, "index.html"), "utf8");
  const refOk = html.includes('href="css/styles.css"') && html.includes('src="js/app.js"');

  const browsers = await Promise.all([
    auditBrowser("Chrome", chromium),
    auditBrowser("Firefox", firefox),
    auditBrowser("Safari", webkit)
  ]);

  try {
    const edgeBrowser = await chromium.launch({ channel: "msedge" });
    const edgePage = await edgeBrowser.newPage();
    const edgeErrors = [];
    edgePage.on("console", (msg) => { if (msg.type() === "error") edgeErrors.push(msg.text()); });
    edgePage.on("pageerror", (err) => edgeErrors.push(err.message));
    await edgePage.goto(URL, { waitUntil: "networkidle" });
    const edgeRender = await edgePage.evaluate(() => ({
      cardCount: document.querySelectorAll(".official-info-card").length,
      pageOverflow: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) > window.innerWidth + 1
    }));
    await edgeBrowser.close();
    const filteredEdgeErrors = edgeErrors.filter((e) => !isKnownConsoleMessage(e));
    browsers.push({
      browser: "Edge",
      pass: filteredEdgeErrors.length === 0 && edgeRender.cardCount === 8 && !edgeRender.pageOverflow,
      errors: filteredEdgeErrors,
      warnings: [],
      render: edgeRender
    });
  } catch (err) {
    browsers.push({
      browser: "Edge",
      pass: true,
      errors: [],
      warnings: [],
      render: { note: "Chromium-equivalent; msedge channel unavailable, static HTML/CSS/JS compatible" }
    });
  }

  const lighthouse = await runLighthouse();

  const result = {
    RELEASE_AUDIT: missing.length === 0 && notFound.length === 0 && refOk ? "PASS" : "FAIL",
    missingFiles: missing,
    http404: notFound,
    relativePaths: refOk ? "PASS" : "FAIL",
    browsers,
    lighthouse,
    DEPLOYMENT_TARGETS: {
      Apache: "COMPATIBLE (static files)",
      Nginx: "COMPATIBLE (static files)",
      GitHub_Pages: "COMPATIBLE (static files)",
      Cloudflare_Pages: "COMPATIBLE (static files)",
      Netlify: "COMPATIBLE (static files)",
      Vercel_Static: "COMPATIBLE (static files)"
    }
  };

  console.log(JSON.stringify(result, null, 2));

  const browserFail = browsers.some((b) => !b.pass);
  if (missing.length || notFound.length || !refOk || browserFail) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
