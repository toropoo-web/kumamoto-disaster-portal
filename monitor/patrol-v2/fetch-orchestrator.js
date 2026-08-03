"use strict";

const { fetchSource } = require("../crawler");
const { fetchWithBrowser } = require("./browser-fetcher");
const { probeFeeds } = require("./feed-fetcher");

const FETCH_MODE = {
  HTTP: "http",
  BROWSER: "browser",
  AUTO: "auto"
};

function resolveFetchMode(source) {
  if (source.fetch_mode) {
    return source.fetch_mode;
  }
  if (source.requires_browser === true) {
    return FETCH_MODE.BROWSER;
  }
  return process.env.PATROL_DEFAULT_FETCH_MODE || FETCH_MODE.AUTO;
}

function shouldRetryWithBrowser(httpResult, mode) {
  if (mode === FETCH_MODE.HTTP) {
    return false;
  }
  if (mode === FETCH_MODE.BROWSER) {
    return true;
  }

  if (!httpResult.ok) {
    return true;
  }

  const body = httpResult.body || "";
  if (body.length < 500) {
    return true;
  }

  if (/loading|データを読み込み|しばらくお待ち/i.test(body) && body.length < 3000) {
    return true;
  }

  return false;
}

async function fetchPageForPatrol(source) {
  try {
    const mode = resolveFetchMode(source);
    const httpResult = await fetchSource(source.url);
    let result = httpResult;
    let fetchModeUsed = "http";

    if (mode === FETCH_MODE.BROWSER || shouldRetryWithBrowser(httpResult, mode)) {
      const browserResult = await fetchWithBrowser(source.url);
      if (browserResult.ok || !httpResult.ok) {
        result = browserResult;
        fetchModeUsed = "browser";
      }
    }

    result = Object.assign({}, result, { fetchMode: fetchModeUsed });

    let feedProbe = [];
    if (result.ok && result.body) {
      try {
        feedProbe = await probeFeeds(result.finalUrl || source.url, result.body);
      } catch (err) {
        feedProbe = [];
      }
    }

    return {
      fetched: result,
      meta: {
        fetchModeUsed: fetchModeUsed,
        feedProbe: feedProbe,
        feedFingerprint: feedProbe[0] ? feedProbe[0].fingerprint : "",
        feedUrl: feedProbe[0] ? feedProbe[0].feedUrl : ""
      }
    };
  } catch (err) {
    return {
      fetched: {
        ok: false,
        url: source.url,
        originalUrl: source.url,
        finalUrl: source.url,
        status: 0,
        redirectCount: 0,
        error: "orchestrator_error",
        message: err.message,
        body: "",
        bodyBuffer: Buffer.alloc(0),
        charset: "utf-8",
        headers: {},
        fetchMode: "error"
      },
      meta: {
        fetchModeUsed: "error",
        feedProbe: [],
        feedFingerprint: "",
        feedUrl: "",
        error: err.message
      }
    };
  }
}

module.exports = {
  FETCH_MODE,
  resolveFetchMode,
  shouldRetryWithBrowser,
  fetchPageForPatrol
};
