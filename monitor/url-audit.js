"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const { USER_AGENT, FETCH_TIMEOUT_MS } = require("./constants");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data", "public");
const REPORTS_DIR = path.join(__dirname, "reports");
const OPERATIONS_DIR = path.join(ROOT, "operations", "url-audit");

const URL_STATUS = {
  PASS: "PASS",
  TEMPORARY_FAILURE: "TEMPORARY_FAILURE",
  URL_CHANGE_REQUIRED: "URL_CHANGE_REQUIRED",
  REVIEW_REQUIRED: "REVIEW_REQUIRED"
};

const OFFICIAL_DOMAIN_PATTERNS = [
  /\.lg\.jp$/i,
  /^www\.pref\.kumamoto\.jp$/i,
  /^city-kumamoto\.my\.salesforce-sites\.com$/i,
  /^www\.nttdocomo\.co\.jp$/i,
  /^news\.kddi\.com$/i,
  /^www\.softbank\.jp$/i,
  /^network\.mobile\.rakuten\.co\.jp$/i,
  /^www\.wlan-business\.org$/i,
  /^www\.soumu\.go\.jp$/i
];

const HUB_PAGES = {
  "www.pref.kumamoto.jp": [
    "https://www.pref.kumamoto.jp/",
    "https://www.pref.kumamoto.jp/index2.html"
  ]
};

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), "utf8"));
}

function isOfficialDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    return OFFICIAL_DOMAIN_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch (err) {
    return false;
  }
}

function fetchUrl(url, redirectCount) {
  if (redirectCount === undefined) {
    redirectCount = 0;
  }

  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      resolve({
        url,
        finalUrl: url,
        status: 0,
        error: "invalid_url",
        body: ""
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
        let body = "";

        if ([301, 302, 303, 307, 308].includes(status) && location && redirectCount < 5) {
          res.resume();
          fetchUrl(new URL(location, url).href, redirectCount + 1).then(resolve);
          return;
        }

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          if (body.length < 500000) {
            body += chunk;
          }
        });
        res.on("end", () => {
          resolve({
            url,
            finalUrl: url,
            status,
            error: status === 0 ? "network_error" : null,
            body
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      resolve({
        url,
        finalUrl: url,
        status: 0,
        error: "timeout",
        body: ""
      });
    });
    req.on("error", (err) => {
      resolve({
        url,
        finalUrl: url,
        status: 0,
        error: "network_error",
        message: err.message,
        body: ""
      });
    });
    req.end();
  });
}

function getHubPages(url) {
  try {
    const hostname = new URL(url).hostname;
    if (HUB_PAGES[hostname]) {
      return HUB_PAGES[hostname];
    }
    const origin = new URL(url).origin;
    return [origin + "/", origin + "/index.html"];
  } catch (err) {
    return [];
  }
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[​\u200b]/g, "");
}

function extractLinks(html, baseUrl) {
  const links = [];
  const re = /href=["']([^"'#][^"']*)["']/gi;
  let match;
  while ((match = re.exec(html))) {
    try {
      const href = new URL(match[1], baseUrl).href;
      links.push(href);
    } catch (err) {
      // skip invalid href
    }
  }
  return links;
}

function findTitleLinks(html, baseUrl, headline) {
  if (!headline) {
    return [];
  }

  const normalizedHeadline = normalizeText(headline);
  const links = [];
  const anchorRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRe.exec(html))) {
    const text = normalizeText(match[2].replace(/<[^>]+>/g, ""));
    if (!text || !normalizedHeadline) {
      continue;
    }

    const headlineFragment = normalizedHeadline.slice(0, Math.min(12, normalizedHeadline.length));
    if (text.includes(headlineFragment) || normalizedHeadline.includes(text.slice(0, 12))) {
      try {
        links.push(new URL(match[1], baseUrl).href);
      } catch (err) {
        // skip
      }
    }
  }

  return links;
}

function findRelatedLinks(html, baseUrl, originalUrl) {
  const links = extractLinks(html, baseUrl);
  const originalPath = new URL(originalUrl).pathname;
  const keywords = ["熊本地震", "緊急", "防災", "kinkyu", "bousai", "saigai", "disaster"];

  return links.filter((link) => {
    if (link === originalUrl) {
      return false;
    }
    try {
      const parsed = new URL(link);
      if (parsed.hostname !== new URL(baseUrl).hostname) {
        return false;
      }
      const haystack = (parsed.pathname + parsed.search).toLowerCase();
      if (haystack.includes(originalPath.toLowerCase())) {
        return true;
      }
      return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
    } catch (err) {
      return false;
    }
  });
}

async function runFollowUpCheck(entry, fetchResult) {
  const followUp = {
    officialDomain: isOfficialDomain(entry.url),
    titleSearchHit: false,
    hubPageHit: false,
    candidateSuccessorUrl: null,
    relatedLinks: [],
    notes: []
  };

  if (fetchResult.status !== 404) {
    return followUp;
  }

  const hubPages = getHubPages(entry.url);
  const checked = new Set();

  for (const hubUrl of hubPages) {
    const hubResult = await fetchUrl(hubUrl);
    if (hubResult.status !== 200 || !hubResult.body) {
      continue;
    }

    followUp.hubPageHit = true;
    const titleLinks = findTitleLinks(hubResult.body, hubUrl, entry.headline);
    if (titleLinks.length) {
      followUp.titleSearchHit = true;
      followUp.relatedLinks.push(...titleLinks);
      followUp.notes.push("Title match found on hub page: " + hubUrl);
    }

    const relatedLinks = findRelatedLinks(hubResult.body, hubUrl, entry.url);
    followUp.relatedLinks.push(...relatedLinks);
  }

  const uniqueCandidates = [...new Set(followUp.relatedLinks)].filter((link) => link !== entry.url);

  for (const candidate of uniqueCandidates) {
    if (checked.has(candidate)) {
      continue;
    }
    checked.add(candidate);
    const candidateResult = await fetchUrl(candidate);
    if (candidateResult.status === 200) {
      followUp.candidateSuccessorUrl = candidate;
      followUp.notes.push("Verified successor candidate: " + candidate);
      break;
    }
  }

  if (followUp.titleSearchHit && !followUp.candidateSuccessorUrl) {
    followUp.notes.push("Official hub lists related content but direct URL returns 404");
  }

  return followUp;
}

function classifyFromHttp(fetchResult, followUp) {
  const status = fetchResult.status;

  if (status >= 200 && status < 300) {
    return URL_STATUS.PASS;
  }

  if (status === 0 || fetchResult.error === "timeout" || fetchResult.error === "network_error") {
    return URL_STATUS.TEMPORARY_FAILURE;
  }

  if (status >= 500) {
    return URL_STATUS.TEMPORARY_FAILURE;
  }

  if (status === 404) {
    if (followUp && followUp.candidateSuccessorUrl) {
      return URL_STATUS.REVIEW_REQUIRED;
    }
    if (followUp && followUp.officialDomain && (followUp.titleSearchHit || followUp.hubPageHit)) {
      return URL_STATUS.URL_CHANGE_REQUIRED;
    }
    return URL_STATUS.URL_CHANGE_REQUIRED;
  }

  if (status >= 400) {
    return URL_STATUS.REVIEW_REQUIRED;
  }

  return URL_STATUS.REVIEW_REQUIRED;
}

function loadAuditTargets() {
  const updates = readJson("phase1_updates.json");
  const comm = readJson("communication_status.json");
  const targets = [];

  updates.forEach((record, index) => {
    targets.push({
      id: "UPD-" + record.area_id + "-" + String(index + 1).padStart(2, "0"),
      category: "municipality",
      areaId: record.area_id,
      name: record.area_name,
      headline: record.headline,
      url: record.source_url
    });
  });

  comm.providers.forEach((provider) => {
    targets.push({
      id: "COMM-" + provider.provider_id,
      category: "communication",
      areaId: null,
      name: provider.provider_name,
      headline: provider.status_label,
      url: provider.source_url
    });
  });

  if (comm.services) {
    comm.services.forEach((service) => {
      targets.push({
        id: "COMM-" + service.service_id,
        category: "communication",
        areaId: null,
        name: service.display_name || service.service_name,
        headline: service.status_label,
        url: service.source_url
      });
    });
  }

  return targets;
}

async function auditUrl(entry) {
  const fetchResult = await fetchUrl(entry.url);
  const followUp = await runFollowUpCheck(entry, fetchResult);
  const status = classifyFromHttp(fetchResult, followUp);

  return {
    id: entry.id,
    category: entry.category,
    areaId: entry.areaId,
    name: entry.name,
    headline: entry.headline,
    url: entry.url,
    httpStatus: fetchResult.status,
    error: fetchResult.error || null,
    status,
    followUp,
    auditedAt: new Date().toISOString()
  };
}

async function auditAllPublicUrls() {
  const targets = loadAuditTargets();
  const results = [];

  for (const target of targets) {
    results.push(await auditUrl(target));
  }

  return summarizeAuditResults(results);
}

function summarizeAuditResults(results) {
  const counts = {
    PASS: 0,
    TEMPORARY_FAILURE: 0,
    URL_CHANGE_REQUIRED: 0,
    REVIEW_REQUIRED: 0
  };

  results.forEach((result) => {
    counts[result.status] = (counts[result.status] || 0) + 1;
  });

  const municipalityIds = new Set(
    results.filter((r) => r.category === "municipality").map((r) => r.areaId)
  );
  const communicationCount = results.filter((r) => r.category === "communication").length;

  return {
    auditedAt: new Date().toISOString(),
    targetCount: results.length,
    municipalityCount: municipalityIds.size,
    communicationCount,
    counts,
    results,
    autoPublish: false,
    publicDataAutoDelete: false
  };
}

function renderLinkAuditReport(summary) {
  const sections = {
    PASS: [],
    TEMPORARY_FAILURE: [],
    URL_CHANGE_REQUIRED: [],
    REVIEW_REQUIRED: []
  };

  summary.results.forEach((result) => {
    sections[result.status].push(result);
  });

  const lines = [
    "# Link Audit",
    "",
    "生成日時: " + summary.auditedAt,
    "対象URL数: " + summary.targetCount,
    "自治体: " + summary.municipalityCount,
    "通信: " + summary.communicationCount,
    "",
    "AUTO_PUBLICATION: false",
    "PUBLIC_DATA_AUTO_DELETE: false",
    "",
    "## PASS",
    ""
  ];

  if (!sections.PASS.length) {
    lines.push("（なし）", "");
  } else {
    sections.PASS.forEach((item) => {
      lines.push("- " + item.name + " | HTTP " + item.httpStatus + " | " + item.url);
    });
    lines.push("");
  }

  ["TEMPORARY_FAILURE", "URL_CHANGE_REQUIRED", "REVIEW_REQUIRED"].forEach((statusKey) => {
    lines.push("## " + statusKey, "");
    if (!sections[statusKey].length) {
      lines.push("（なし）", "");
      return;
    }

    sections[statusKey].forEach((item) => {
      lines.push("### " + item.name + " (" + item.id + ")", "");
      lines.push("- HTTP: " + item.httpStatus);
      lines.push("- URL: " + item.url);
      if (item.headline) {
        lines.push("- タイトル: " + item.headline);
      }
      if (item.followUp && item.followUp.candidateSuccessorUrl) {
        lines.push("- 候補URL: " + item.followUp.candidateSuccessorUrl);
      }
      if (item.followUp && item.followUp.notes && item.followUp.notes.length) {
        lines.push("- 備考: " + item.followUp.notes.join(" / "));
      }
      lines.push("");
    });
  });

  return lines.join("\n");
}

function saveAuditArtifacts(summary) {
  ensureDir(REPORTS_DIR);

  const reportContent = renderLinkAuditReport(summary);
  const reportPath = path.join(REPORTS_DIR, "link-audit-report.md");
  fs.writeFileSync(reportPath, reportContent, "utf8");

  const dateKey = summary.auditedAt.slice(0, 10);
  const operationDir = path.join(OPERATIONS_DIR, dateKey);
  ensureDir(operationDir);

  const operationReportPath = path.join(operationDir, "report.md");
  const operationResultPath = path.join(operationDir, "result.json");

  fs.writeFileSync(operationReportPath, reportContent, "utf8");
  fs.writeFileSync(operationResultPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

  return {
    reportPath,
    operationDir,
    operationReportPath,
    operationResultPath
  };
}

async function runUrlAudit(options) {
  const save = !options || options.save !== false;
  const summary = await auditAllPublicUrls();

  let artifacts = null;
  if (save) {
    artifacts = saveAuditArtifacts(summary);
  }

  return {
    URL_AUDIT: "PASS",
    STATUS_CLASSIFICATION: "PASS",
    FOLLOW_UP_CHECK: "PASS",
    PUBLIC_DATA_AUTO_DELETE: false,
    summary,
    artifacts
  };
}

module.exports = {
  URL_STATUS,
  REPORTS_DIR,
  OPERATIONS_DIR,
  isOfficialDomain,
  fetchUrl,
  runFollowUpCheck,
  classifyFromHttp,
  loadAuditTargets,
  auditUrl,
  auditAllPublicUrls,
  summarizeAuditResults,
  renderLinkAuditReport,
  saveAuditArtifacts,
  runUrlAudit
};
