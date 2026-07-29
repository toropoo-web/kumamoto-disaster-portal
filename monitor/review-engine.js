"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeCandidate, validateCandidateShape } = require("./candidate-format");

const ROOT = path.join(__dirname, "..");
const CANDIDATE_DIR = path.join(ROOT, "data", "update_candidates");
const REPORTS_DIR = path.join(__dirname, "reports");
const REVIEW_QUEUE_FILE = path.join(REPORTS_DIR, "review_queue.md");
const NORMALIZED_FILE = path.join(REPORTS_DIR, "normalized_candidates.json");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function loadCandidateFiles() {
  if (!fs.existsSync(CANDIDATE_DIR)) {
    return [];
  }

  return fs
    .readdirSync(CANDIDATE_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const filePath = path.join(CANDIDATE_DIR, name);
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return { filePath, payload };
    });
}

function flattenCandidates(files) {
  const all = [];
  let index = 0;

  files.forEach((file) => {
    const list = file.payload.candidates || [];
    list.forEach((raw) => {
      all.push(normalizeCandidate(raw, index));
      index += 1;
    });
  });

  const latestBySource = new Map();
  all.forEach((candidate) => {
    latestBySource.set(candidate.source, candidate);
  });

  return Array.from(latestBySource.values()).sort((a, b) => {
    const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    const diff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (diff !== 0) {
      return diff;
    }
    return a.detectedAt < b.detectedAt ? 1 : -1;
  });
}

function describeChange(candidate) {
  const parts = [];
  parts.push("変更種別: " + candidate.changeType);

  if (candidate.before && candidate.before.title !== candidate.after.title) {
    parts.push("タイトル: " + (candidate.before.title || "（なし）") + " → " + (candidate.after.title || "（なし）"));
  }

  if (
    candidate.before &&
    candidate.before.pageUpdatedAt !== candidate.after.pageUpdatedAt &&
    candidate.after.pageUpdatedAt
  ) {
    parts.push("更新日時: " + (candidate.before.pageUpdatedAt || "（なし）") + " → " + candidate.after.pageUpdatedAt);
  }

  if (candidate.keywords.length) {
    parts.push("キーワード: " + candidate.keywords.join("・"));
  }

  if (candidate.safetyFlags.length) {
    parts.push("安全フラグ: " + candidate.safetyFlags.join("・"));
  }

  return parts.join("\n");
}

function renderReviewQueue(candidates) {
  const groups = { HIGH: [], MEDIUM: [], LOW: [] };
  candidates.forEach((candidate) => {
    groups[candidate.priority].push(candidate);
  });

  const lines = [
    "# Update Review Queue",
    "",
    "自動巡回で検知された更新候補です。公開反映前に人手で確認してください。",
    "",
    "生成日時: " + new Date().toISOString(),
    "候補数: " + candidates.length,
    ""
  ];

  ["HIGH", "MEDIUM", "LOW"].forEach((priority) => {
    lines.push("## " + priority);
    lines.push("");

    if (!groups[priority].length) {
      lines.push("（候補なし）");
      lines.push("");
      return;
    }

    groups[priority].forEach((candidate) => {
      lines.push("### " + candidate.id);
      lines.push("");
      lines.push("- 自治体: " + candidate.municipality);
      lines.push("- タイトル: " + (candidate.after.title || "（なし）"));
      lines.push("- URL: " + candidate.url);
      lines.push("- 変更内容:");
      lines.push("");
      describeChange(candidate)
        .split("\n")
        .forEach((line) => lines.push("  " + line));
      lines.push("- reviewStatus: " + candidate.reviewStatus);
      lines.push("");
    });
  });

  return lines.join("\n");
}

function generateReviewArtifacts() {
  const files = loadCandidateFiles();
  const candidates = flattenCandidates(files);

  candidates.forEach((candidate) => {
    if (!validateCandidateShape(candidate)) {
      throw new Error("Invalid candidate shape: " + candidate.id);
    }
  });

  ensureDir(REPORTS_DIR);

  const normalizedPayload = {
    generatedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    autoPublish: false,
    candidates
  };

  fs.writeFileSync(NORMALIZED_FILE, JSON.stringify(normalizedPayload, null, 2) + "\n", "utf8");
  fs.writeFileSync(REVIEW_QUEUE_FILE, renderReviewQueue(candidates) + "\n", "utf8");

  const priorityCounts = candidates.reduce(
    (acc, candidate) => {
      acc[candidate.priority] += 1;
      return acc;
    },
    { HIGH: 0, MEDIUM: 0, LOW: 0 }
  );

  return {
    candidateCount: candidates.length,
    priorityCounts,
    reviewQueuePath: REVIEW_QUEUE_FILE,
    normalizedPath: NORMALIZED_FILE,
    candidates
  };
}

module.exports = {
  loadCandidateFiles,
  flattenCandidates,
  generateReviewArtifacts,
  REVIEW_QUEUE_FILE,
  NORMALIZED_FILE
};
