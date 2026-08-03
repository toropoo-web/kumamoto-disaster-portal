"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const ROOT = path.join(__dirname, "..", "..");
const ALERT_LOG = path.join(ROOT, "monitor", "reports", "patrol-alerts.json");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readAlertLog() {
  if (!fs.existsSync(ALERT_LOG)) {
    return { alerts: [] };
  }
  return JSON.parse(fs.readFileSync(ALERT_LOG, "utf8"));
}

function writeAlertLog(payload) {
  ensureDir(path.dirname(ALERT_LOG));
  fs.writeFileSync(ALERT_LOG, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function postWebhook(webhookUrl, body) {
  return new Promise(function (resolve) {
    try {
      const parsed = new URL(webhookUrl);
      const client = parsed.protocol === "https:" ? https : http;
      const data = JSON.stringify(body);
      const req = client.request(
        webhookUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data)
          },
          timeout: 10000
        },
        function (res) {
          res.resume();
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300 });
        }
      );
      req.on("timeout", function () {
        req.destroy();
        resolve({ ok: false, error: "timeout" });
      });
      req.on("error", function (err) {
        resolve({ ok: false, error: err.message });
      });
      req.write(data);
      req.end();
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

async function dispatchPatrolAlert(alert) {
  const entry = Object.assign(
    {
      dispatchedAt: new Date().toISOString(),
      channel: "log"
    },
    alert
  );

  const log = readAlertLog();
  log.alerts = (log.alerts || []).slice(-199);
  log.alerts.push(entry);
  writeAlertLog(log);

  const webhookUrl = process.env.PATROL_ALERT_WEBHOOK_URL || "";
  const emailWebhook = process.env.PATROL_ALERT_EMAIL_WEBHOOK_URL || "";

  const targets = [];
  if (webhookUrl) {
    targets.push(webhookUrl);
  }
  if (emailWebhook && emailWebhook !== webhookUrl) {
    targets.push(emailWebhook);
  }

  const deliveries = [];
  for (let i = 0; i < targets.length; i += 1) {
    const result = await postWebhook(targets[i], {
      text:
        "[Kumamoto Patrol] " +
        alert.level +
        ": " +
        alert.summary +
        (alert.detail ? "\n" + alert.detail : "")
    });
    deliveries.push({ url: targets[i], ok: result.ok, error: result.error || null });
  }

  return {
    logged: true,
    logPath: ALERT_LOG,
    deliveries: deliveries
  };
}

async function dispatchPatrolSummary(summary) {
  const alerts = [];

  if (summary.failedCount > 0 && summary.successCount === 0) {
    alerts.push({
      level: "CRITICAL",
      summary: "全ソース巡回失敗 (" + summary.failedCount + "件)",
      detail: summary.failureSample || ""
    });
  } else if (summary.failedCount > 0) {
    alerts.push({
      level: "WARNING",
      summary: "巡回失敗 " + summary.failedCount + "件 / 成功 " + summary.successCount + "件",
      detail: summary.failureSample || ""
    });
  }

  if (summary.highPriorityCount > 0) {
    alerts.push({
      level: "INFO",
      summary: "高優先度変更 " + summary.highPriorityCount + "件",
      detail: ""
    });
  }

  const results = [];
  for (let i = 0; i < alerts.length; i += 1) {
    results.push(await dispatchPatrolAlert(alerts[i]));
  }

  return results;
}

module.exports = {
  ALERT_LOG,
  dispatchPatrolAlert,
  dispatchPatrolSummary
};
