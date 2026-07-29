"use strict";

const https = require("https");
const http = require("http");
const { USER_AGENT, FETCH_TIMEOUT_MS } = require("./constants");

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
        status: 0,
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
          fetchSource(nextUrl, redirectCount + 1).then(resolve);
          return;
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: status >= 200 && status < 400,
            url,
            finalUrl: url,
            status,
            error: null,
            message: "",
            body,
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
        status: 0,
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
        status: 0,
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
