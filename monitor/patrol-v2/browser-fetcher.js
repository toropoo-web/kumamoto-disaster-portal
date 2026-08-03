"use strict";

const { USER_AGENT, FETCH_TIMEOUT_MS } = require("../constants");

let chromiumLoader = null;

function getChromium() {
  if (!chromiumLoader) {
    chromiumLoader = require("playwright").chromium;
  }
  return chromiumLoader;
}

async function fetchWithBrowser(url, options) {
  options = options || {};
  const timeoutMs = options.timeoutMs || FETCH_TIMEOUT_MS + 15000;

  let browser;
  try {
    const chromium = getChromium();
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: "ja-JP"
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs
    });

    const status = response ? response.status() : 0;
    await page.waitForTimeout(1500);

    const body = await page.content();
    const finalUrl = page.url();

    await context.close();
    await browser.close();

    return {
      ok: status >= 200 && status < 400,
      url: url,
      originalUrl: url,
      finalUrl: finalUrl,
      status: status,
      redirectCount: 0,
      error: status >= 400 ? "http_error" : null,
      message: status >= 400 ? "browser http " + status : "",
      body: body,
      bodyBuffer: Buffer.from(body, "utf8"),
      charset: "utf-8",
      headers: {},
      fetchMode: "browser"
    };
  } catch (err) {
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        /* ignore */
      }
    }

    return {
      ok: false,
      url: url,
      originalUrl: url,
      finalUrl: url,
      status: 0,
      redirectCount: 0,
      error: "browser_error",
      message: err.message,
      body: "",
      bodyBuffer: Buffer.alloc(0),
      charset: "utf-8",
      headers: {},
      fetchMode: "browser"
    };
  }
}

module.exports = {
  fetchWithBrowser
};
