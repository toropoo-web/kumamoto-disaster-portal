"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HISTORY_DIR = path.join(ROOT, "operations", "update-history");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function buildAppliedRecord(applyResult, approvedFiles) {
  const approvedAt = new Date().toISOString();
  const entries = [];

  approvedFiles.forEach((file) => {
    (file.candidates || []).forEach((candidate) => {
      entries.push({
        id: candidate.id,
        municipality: candidate.municipality,
        url: candidate.url,
        target: candidate.publicUpdate.target,
        action: candidate.publicUpdate.action || "update",
        fields: candidate.publicUpdate.fields || {},
        approvedAt: file.approvedAt || approvedAt,
        approvedBy: file.approvedBy || "manual-reviewer",
        reviewStatus: candidate.reviewStatus
      });
    });
  });

  return {
    appliedAt: approvedAt,
    applied: applyResult.applied === true,
    approvedCount: applyResult.approvedCount || 0,
    autoPublication: false,
    entries
  };
}

function renderSummary(appliedRecord, validationResult) {
  const lines = [
    "# Update History Summary",
    "",
    "適用日時: " + appliedRecord.appliedAt,
    "承認件数: " + appliedRecord.approvedCount,
    "自動公開: false",
    "",
    "## 更新対象",
    ""
  ];

  if (!appliedRecord.entries.length) {
    lines.push("（更新なし）", "");
  } else {
    appliedRecord.entries.forEach((entry) => {
      lines.push("### " + entry.municipality + " (" + entry.id + ")", "");
      lines.push("- 対象: " + entry.target);
      lines.push("- URL: " + entry.url);
      if (entry.fields && Object.keys(entry.fields).length) {
        lines.push("- 変更: " + JSON.stringify(entry.fields));
      }
      lines.push("- 承認者: " + entry.approvedBy);
      lines.push("");
    });
  }

  lines.push("## 公開確認結果", "");
  lines.push("- POST_APPLY_VALIDATION: " + validationResult.POST_APPLY_VALIDATION);
  lines.push("- 検証日時: " + validationResult.validatedAt);

  if (validationResult.errors && validationResult.errors.length) {
    lines.push("- エラー:");
    validationResult.errors.forEach((error) => {
      lines.push("  - " + error);
    });
  }

  lines.push("");
  return lines.join("\n");
}

function saveUpdateHistory(applyResult, validationResult, approvedFiles) {
  const appliedRecord = buildAppliedRecord(applyResult, approvedFiles);
  const dateKey = appliedRecord.appliedAt.slice(0, 10);
  const operationDir = path.join(HISTORY_DIR, dateKey);
  ensureDir(operationDir);

  const appliedPath = path.join(operationDir, "applied.json");
  const validationPath = path.join(operationDir, "validation.json");
  const summaryPath = path.join(operationDir, "summary.md");

  let history = { date: dateKey, applies: [] };
  if (fs.existsSync(appliedPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(appliedPath, "utf8"));
      if (existing.applies) {
        history = existing;
      } else if (existing.entries) {
        history.applies = [existing];
      }
    } catch (err) {
      history = { date: dateKey, applies: [] };
    }
  }

  history.applies.push(appliedRecord);
  history.lastAppliedAt = appliedRecord.appliedAt;
  history.lastValidation = validationResult.POST_APPLY_VALIDATION;

  fs.writeFileSync(appliedPath, JSON.stringify(history, null, 2) + "\n", "utf8");
  fs.writeFileSync(validationPath, JSON.stringify(validationResult, null, 2) + "\n", "utf8");
  fs.writeFileSync(summaryPath, renderSummary(appliedRecord, validationResult), "utf8");

  return {
    UPDATE_HISTORY: "PASS",
    operationDir,
    appliedPath,
    validationPath,
    summaryPath,
    appliedRecord,
    validationResult
  };
}

function getLatestUpdateHistory() {
  if (!fs.existsSync(HISTORY_DIR)) {
    return null;
  }

  const dates = fs
    .readdirSync(HISTORY_DIR)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort();

  if (!dates.length) {
    return null;
  }

  const latestDate = dates[dates.length - 1];
  const appliedPath = path.join(HISTORY_DIR, latestDate, "applied.json");

  if (!fs.existsSync(appliedPath)) {
    return { date: latestDate, lastAppliedAt: null };
  }

  try {
    const data = JSON.parse(fs.readFileSync(appliedPath, "utf8"));
    return {
      date: latestDate,
      lastAppliedAt: data.lastAppliedAt || null,
      lastValidation: data.lastValidation || null,
      applyCount: data.applies ? data.applies.length : 0
    };
  } catch (err) {
    return { date: latestDate, lastAppliedAt: null };
  }
}

module.exports = {
  HISTORY_DIR,
  buildAppliedRecord,
  renderSummary,
  saveUpdateHistory,
  getLatestUpdateHistory
};
