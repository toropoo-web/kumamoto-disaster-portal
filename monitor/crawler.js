"use strict";

const https = require("https");
const http = require("http");
const { USER_AGENT, FETCH_TIMEOUT_MS } = require("./constants");

function normalizeCharset(charset) {
  const value = String(charset || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]/g, "-");
  if (!value) {
    return "utf-8";
  }
  if (value === "shift-jis" || value === "sjis" || value === "windows-31j" || value === "cp932" || value === "ms932") {
    return "shift_jis";
  }
  if (value === "euc-jp" || value === "eucjp") {
    return "euc-jp";
  }
  return value;
}

function detectCharset(headers, bodyBuffer) {
  const contentType = String((headers && headers["content-type"]) || "").toLowerCase();
  const headerMatch = contentType.match(/charset=([^;\s]+)/);
  if (headerMatch) {
    return normalizeCharset(headerMatch[1]);
  }

  const head = bodyBuffer.slice(0, 8192).toString("latin1");
  const metaPatterns = [
    /<meta[^>]+charset=["']?([^"'\s>]+)/i,
    /<meta[^>]+content=["'][^"']*charset=([^"'\s;>]+)/i
  ];
  for (const pattern of metaPatterns) {
    const match = head.match(pattern);
    if (match) {
      return normalizeCharset(match[1]);
    }
  }
  return "utf-8";
}

function decodeBody(bodyBuffer, charset) {
  if (!bodyBuffer || !bodyBuffer.length) {
    return "";
  }
  try {
    return new TextDecoder(charset).decode(bodyBuffer);
  } catch (err) {
    if (charset !== "utf-8") {
      try {
        return new TextDecoder("utf-8").decode(bodyBuffer);
      } catch (fallbackErr) {
        return bodyBuffer.toString("utf8");
      }
    }
    return bodyBuffer.toString("utf8");
  }
}

function fetchSource(url, redirectCount) {
  if (redirectCount === undefined) {
    redirectCount = 0;
  }

  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      resolve({
        ok: false,
        url,
        originalUrl: url,
        status: 0,
        redirectCount,
        error: "invalid_url",
        message: err.message,
        body: "",
        headers: {}
      });
      return;
    }

    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        timeout: FETCH_TIMEOUT_MS,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
        }
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;

        if (
          status >= 300 &&
          status < 400 &&
          location &&
          redirectCount < 5
        ) {
          res.resume();
          const nextUrl = new URL(location, url).toString();
          fetchSource(nextUrl, redirectCount + 1).then((result) => {
            resolve({
              ...result,
              originalUrl: result.originalUrl || url,
              redirectCount: redirectCount + 1
            });
          });
          return;
        }

        if (status >= 300 && status < 400 && location) {
          res.resume();
          resolve({
            ok: false,
            url,
            originalUrl: url,
            finalUrl: url,
            status,
            redirectCount,
            error: "redirect_anomaly",
            message: "too many redirects",
            body: "",
            headers: res.headers || {}
          });
          return;
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const bodyBuffer = Buffer.concat(chunks);
          const contentType = String(res.headers["content-type"] || "").toLowerCase();
          const isPdf = contentType.includes("pdf") || url.toLowerCase().endsWith(".pdf");
          const charset = detectCharset(res.headers, bodyBuffer);
          resolve({
            ok: status >= 200 && status < 400,
            url,
            originalUrl: url,
            finalUrl: url,
            status,
            redirectCount,
            error: null,
            message: "",
            body: isPdf ? "" : decodeBody(bodyBuffer, charset),
            bodyBuffer,
            charset: isPdf ? null : charset,
            headers: res.headers || {}
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      resolve({
        ok: false,
        url,
        originalUrl: url,
        status: 0,
        redirectCount,
        error: "timeout",
        message: "request timeout",
        body: "",
        headers: {}
      });
    });

    req.on("error", (err) => {
      resolve({
        ok: false,
        url,
        originalUrl: url,
        status: 0,
        redirectCount,
        error: "network_error",
        message: err.message,
        body: "",
        headers: {}
      });
    });

    req.end();
  });
}

module.exports = {
  fetchSource
};
