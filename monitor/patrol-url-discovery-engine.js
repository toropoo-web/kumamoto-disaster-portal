"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const SOURCES_FILE = path.join(__dirname, "sources.json");
const OUTPUT_DIR = path.join(ROOT, "data", "patrol_discovery");
const MASTER_CANDIDATES_FILE = path.join(OUTPUT_DIR, "patrol_url_candidates.json");

const INCIDENT_SCOPE = "2026_KUMAMOTO_EARTHQUAKE";
const ENGINE_VERSION = 2;
const REGISTRATION_STATUSES = ["PENDING_REVIEW", "APPROVED_FOR_REGISTER", "REJECTED", "REGISTERED"];
const DISCOVERY_STATUSES = ["DISCOVERED", "ALREADY_REGISTERED", "DUPLICATE", "SKIPPED"];

const PAGE_TYPES = [
  "emergency_dashboard",
  "emergency_list",
  "disaster_special",
  "bousai_portal",
  "article_list",
  "normal_info",
  "hazard_map",
  "archive",
  "pdf"
];

const DISASTER_SEARCH_KEYWORDS = [
  "令和8年",
  "令和7年",
  "地震",
  "豪雨",
  "台風",
  "災害対策本部",
  "被害状況",
  "復旧状況"
];

const DISASTER_PATH_PATTERNS = [
  /\/kinkyu\//i,
  /\/saigai\//i,
  /\/disaster\//i,
  /\/bosai\//i,
  /\/bousai\//i
];

const CMS_PATTERNS = {
  CMS_A: [/\/kiji\//i, /\/list\//i, /\/article\/list\//i, /\/q\/list\//i],
  CMS_B: [/\/kinkyu\/pub\//i, /\/loc\/pub\//i],
  CMS_C: [/\/default\.html/i, /\/index\.html/i]
};

const MAX_CRAWL_LINKS_PER_PAGE = 50;
const MAX_CRAWL_DEPTH = 2;
const MAX_HUB_FETCHES = 5;

const EXCLUSION_RULES = [
  {
    type: "pdf",
    patterns: [/防災計画/, /地域防災計画/, /災害対策基本計画/, /bousaikeikaku/i, /\.pdf$/i]
  },
  {
    type: "archive",
    patterns: [/アーカイブ/, /過去の災害/, /2016/, /平成28/, /H28/, /令和元年/, /東日本大震災/]
  },
  {
    type: "hazard_map",
    patterns: [/ハザードマップ/, /hazardmap/i, /bosaimap/i, /洪水ハザード/, /土砂災害警戒区域/, /浸水想定/]
  },
  {
    type: "normal_info",
    patterns: [/組織案内/, /市役所案内/, /施設案内/, /広報誌/, /イベント情報/, /住民説明会/, /ふるさと納税/, /防災訓練/, /防災教育/, /キッズ/, /学習コンテンツ/, /しつもんコーナー/, /防災クイズ/]
  }
];

const { fetchSource } = require("./crawler");
const { parsePage, extractTitle, normalizeContent } = require("./parser");
const { CONTAMINATION_PATTERNS } = require("./constants");

const LINK_HINTS_BASE = [
  "避難",
  "給水",
  "断水",
  "水道",
  "災害",
  "緊急",
  "防災",
  "罹災",
  "通行",
  "支援",
  "ボランティア",
  "kinkyu",
  "bousai",
  "saigai",
  "hinan",
  "water",
  "bosai"
];

const LINK_HINTS = LINK_HINTS_BASE.concat(DISASTER_SEARCH_KEYWORDS);

function detectCmsPattern(url) {
  if (CMS_PATTERNS.CMS_B.some(function (pattern) {
    return pattern.test(url);
  })) {
    return "CMS_B";
  }
  if (CMS_PATTERNS.CMS_A.some(function (pattern) {
    return pattern.test(url);
  })) {
    return "CMS_A";
  }
  if (CMS_PATTERNS.CMS_C.some(function (pattern) {
    return pattern.test(url);
  })) {
    return "CMS_C";
  }
  return null;
}

function isTopPortalPage(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] || "";
    return segments.length <= 2 && /^(default|index)\.html?$/i.test(last);
  } catch (err) {
    return false;
  }
}

function isCmsHubUrl(url) {
  return (
    CMS_PATTERNS.CMS_A.some(function (pattern) {
      return pattern.test(url);
    }) ||
    CMS_PATTERNS.CMS_B.some(function (pattern) {
      return pattern.test(url);
    }) ||
    DISASTER_PATH_PATTERNS.some(function (pattern) {
      return pattern.test(url);
    })
  );
}

function matchesDisasterSignals(haystack, url) {
  if (DISASTER_SEARCH_KEYWORDS.some(function (keyword) {
    return haystack.includes(keyword);
  })) {
    return true;
  }
  if (DISASTER_PATH_PATTERNS.some(function (pattern) {
    return pattern.test(url || haystack);
  })) {
    return true;
  }
  return LINK_HINTS_BASE.some(function (hint) {
    return haystack.includes(hint);
  });
}

function isRelevantDiscoveryLink(link) {
  const haystack = [link.label, link.url].concat(link.matched_hints || []).join(" ");
  if (matchesDisasterSignals(haystack, link.url)) {
    return true;
  }
  return isCmsHubUrl(link.url);
}

function buildDisasterProbeUrls(officialDomain) {
  const domain = normalizeDomain(officialDomain);
  const hosts = ["https://www." + domain, "https://" + domain];
  const paths = [
    "/kinkyu/",
    "/saigai/",
    "/disaster/",
    "/bosai/",
    "/bousai/",
    "/kinkyu/index.html",
    "/bousai/default.html",
    "/bosai/default.html"
  ];
  const probes = [];
  hosts.forEach(function (host) {
    paths.forEach(function (segment) {
      probes.push(normalizeUrl(host + segment));
    });
  });
  return probes;
}

const CATEGORY_RULES = [
  { category: "WATER", patterns: [/断水/, /水道/, /給水/, /water/i] },
  { category: "SHELTER", patterns: [/避難/, /避難所/, /hinan/i, /shelter/i] },
  { category: "SUPPORT", patterns: [/罹災/, /支援/, /救助/] },
  { category: "ROAD", patterns: [/道路/, /通行/, /交通/] },
  { category: "COMMUNICATION", patterns: [/通信/, /Wi-?Fi/i, /伝言/] },
  { category: "EMERGENCY", patterns: [/災害/, /緊急/, /防災/, /kinkyu/i, /bousai/i, /saigai/i, /bosai/i] }
];

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function toRepoRelative(filePath) {
  if (!filePath) {
    return null;
  }
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch (err) {
    return String(url || "").trim();
  }
}

function normalizeDomain(domain) {
  return String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

function urlMatchesDomain(url, officialDomain) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const domain = normalizeDomain(officialDomain);
    return host === domain || host.endsWith("." + domain);
  } catch (err) {
    return false;
  }
}

function validateDiscoveryInput(input) {
  const errors = [];
  if (!input || typeof input !== "object") {
    return ["input object missing"];
  }
  if (!input.prefecture) {
    errors.push("prefecture is required");
  }
  if (!input.municipality) {
    errors.push("municipality is required");
  }
  if (!input.official_domain) {
    errors.push("official_domain is required");
  }
  return errors;
}

function loadSourcesRegistry() {
  return readJson(SOURCES_FILE, { municipalities: [], communication: [] });
}

function listMunicipalities(registry) {
  const map = new Map();
  (registry.municipalities || []).forEach(function (source) {
    if (!map.has(source.name)) {
      map.set(source.name, {
        municipality: source.name,
        area_id: source.area_id,
        sources: []
      });
    }
    map.get(source.name).sources.push(source);
  });
  return Array.from(map.values());
}

function resolveDiscoveryTarget(input, options) {
  options = options || {};
  const inputErrors = validateDiscoveryInput(input);
  if (inputErrors.length) {
    return { found: false, reason: inputErrors.join("; "), inputErrors: inputErrors };
  }

  const registry = loadSourcesRegistry();
  const municipalities = listMunicipalities(registry);
  const target = municipalities.find(function (item) {
    return item.municipality === input.municipality;
  });

  const officialDomain = normalizeDomain(input.official_domain);
  let areaId = target ? target.area_id : null;
  let registeredSources = target ? target.sources : [];
  let registeredUrls = registeredSources.map(function (source) {
    return normalizeUrl(source.url);
  });

  const domainMatchedSources = (registry.municipalities || []).filter(function (source) {
    return urlMatchesDomain(source.url, officialDomain);
  });

  if (domainMatchedSources.length) {
    registeredSources = domainMatchedSources.filter(function (source) {
      return !target || source.name === input.municipality;
    });
    if (!registeredSources.length) {
      registeredSources = domainMatchedSources;
    }
    registeredUrls = registeredSources.map(function (source) {
      return normalizeUrl(source.url);
    });
    if (!areaId && registeredSources[0]) {
      areaId = registeredSources[0].area_id;
    }
  }

  const entrySource =
    registeredSources.find(function (source) {
      return source.patrol_role === "primary" && source.public_category_id === "EMERGENCY";
    }) ||
    registeredSources.find(function (source) {
      return source.patrol_role === "primary";
    }) ||
    registeredSources[0];

  let entryUrl = options.entryUrl || (entrySource && entrySource.url) || null;
  if (!entryUrl) {
    entryUrl = "https://www." + officialDomain + "/";
  }

  if (entryUrl && !urlMatchesDomain(entryUrl, officialDomain)) {
    return {
      found: false,
      reason: "entry_url does not match official_domain",
      inputErrors: ["entry_url domain mismatch"]
    };
  }

  return {
    found: true,
    input: {
      prefecture: input.prefecture,
      municipality: input.municipality,
      official_domain: officialDomain
    },
    municipality: input.municipality,
    prefecture: input.prefecture,
    official_domain: officialDomain,
    area_id: areaId || "UNKNOWN",
    entry_url: entryUrl,
    registered_urls: registeredUrls,
    registered_sources: registeredSources
  };
}

function extractInternalLinks(html, baseUrl, officialDomain, options) {
  options = options || {};
  const maxLinks = options.maxLinks || MAX_CRAWL_LINKS_PER_PAGE;
  const links = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = re.exec(html)) !== null) {
    const href = match[1];
    const label = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) {
      continue;
    }

    let absolute;
    try {
      absolute = new URL(href, baseUrl).href;
    } catch (err) {
      continue;
    }

    if (!/^https?:/i.test(absolute)) {
      continue;
    }

    if (!urlMatchesDomain(absolute, officialDomain)) {
      continue;
    }

    const haystack = label + " " + href + " " + absolute;
    const matchedHints = LINK_HINTS.filter(function (hint) {
      return haystack.includes(hint);
    });

    links.push({
      url: normalizeUrl(absolute),
      label: label || href,
      matched_hints: matchedHints
    });
  }

  const seen = new Set();
  return links
    .filter(function (item) {
      if (seen.has(item.url)) {
        return false;
      }
      seen.add(item.url);
      return true;
    })
    .slice(0, maxLinks);
}

function extractDiscoveryLinks(html, baseUrl, officialDomain) {
  return extractInternalLinks(html, baseUrl, officialDomain, {
    maxLinks: MAX_CRAWL_LINKS_PER_PAGE
  }).filter(function (link) {
    return isRelevantDiscoveryLink(link);
  });
}

function mergeDiscoveryLinks(linkGroups) {
  const merged = new Map();

  linkGroups.forEach(function (group) {
    (group.links || []).forEach(function (link) {
      const key = normalizeUrl(link.url);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, Object.assign({}, link, {
          discovery_methods: [group.method],
          crawl_depth: group.depth || 0,
          discovered_from: group.from || null,
          cms_pattern: group.cms_pattern || link.cms_pattern || null
        }));
        return;
      }

      const methods = existing.discovery_methods || [];
      if (methods.indexOf(group.method) < 0) {
        methods.push(group.method);
      }
      existing.discovery_methods = methods;
      existing.matched_hints = Array.from(
        new Set((existing.matched_hints || []).concat(link.matched_hints || []))
      );
      if ((group.depth || 0) < (existing.crawl_depth || 99)) {
        existing.crawl_depth = group.depth || 0;
        existing.discovered_from = group.from || existing.discovered_from;
      }
      if (!existing.cms_pattern && (group.cms_pattern || link.cms_pattern)) {
        existing.cms_pattern = group.cms_pattern || link.cms_pattern;
      }
    });
  });

  return Array.from(merged.values());
}

async function collectDiscoveryLinks(target, entryFetch, options) {
  options = options || {};
  const entryUrl = entryFetch.finalUrl || target.entry_url;
  const entryHtml = entryFetch.body || "";
  const pageCache = options.pageCache || new Map();
  const groups = [];

  const entryLinks = extractInternalLinks(entryHtml, entryUrl, target.official_domain, {
    maxLinks: MAX_CRAWL_LINKS_PER_PAGE
  }).filter(isRelevantDiscoveryLink);

  groups.push({
    method: "entry_link",
    depth: 1,
    from: entryUrl,
    cms_pattern: detectCmsPattern(entryUrl),
    links: entryLinks
  });

  const hubCandidates = entryLinks
    .filter(function (link) {
      return isCmsHubUrl(link.url) || detectCmsPattern(link.url);
    })
    .slice(0, MAX_HUB_FETCHES);

  let hubFetchCount = 0;
  for (let i = 0; i < hubCandidates.length && hubFetchCount < MAX_HUB_FETCHES; i += 1) {
    const hub = hubCandidates[i];
    let hubFetch = pageCache.get(hub.url);
    if (!hubFetch) {
      hubFetch = await fetchPageContent(hub.url, {
        fixtureHtml: resolveFixtureHtml(hub.url, options)
      });
      pageCache.set(hub.url, hubFetch);
      hubFetchCount += 1;
    }

    if (!hubFetch.ok || !hubFetch.body) {
      continue;
    }

    const depthTwoLinks = extractInternalLinks(
      hubFetch.body,
      hubFetch.finalUrl || hub.url,
      target.official_domain,
      { maxLinks: MAX_CRAWL_LINKS_PER_PAGE }
    ).filter(isRelevantDiscoveryLink);

    groups.push({
      method: "crawl_depth_2",
      depth: 2,
      from: hub.url,
      cms_pattern: detectCmsPattern(hub.url),
      links: depthTwoLinks
    });
  }

  const probeLinks = [];
  const probes = buildDisasterProbeUrls(target.official_domain).slice(0, 4);
  for (let probeIndex = 0; probeIndex < probes.length; probeIndex += 1) {
    const probeUrl = probes[probeIndex];
    let probeFetch = pageCache.get(probeUrl);
    if (!probeFetch) {
      probeFetch = await fetchPageContent(probeUrl, {
        fixtureHtml: resolveFixtureHtml(probeUrl, options)
      });
      pageCache.set(probeUrl, probeFetch);
    }
    if (!probeFetch.ok || !probeFetch.body) {
      continue;
    }
    const probePageLinks = extractInternalLinks(
      probeFetch.body,
      probeFetch.finalUrl || probeUrl,
      target.official_domain,
      { maxLinks: MAX_CRAWL_LINKS_PER_PAGE }
    ).filter(isRelevantDiscoveryLink);
    probeLinks.push.apply(probeLinks, probePageLinks);
  }

  if (probeLinks.length) {
    groups.push({
      method: "disaster_probe",
      depth: 1,
      from: entryUrl,
      links: probeLinks
    });
  }

  (target.registered_urls || []).forEach(function (url) {
    groups.push({
      method: "registered_seed",
      depth: 0,
      from: entryUrl,
      cms_pattern: detectCmsPattern(url),
      links: [
        {
          url: url,
          label: "registered source",
          matched_hints: ["災害"],
          cms_pattern: detectCmsPattern(url)
        }
      ]
    });
  });

  const merged = mergeDiscoveryLinks(groups);
  const filtered = merged.filter(function (link) {
    if (isTopPortalPage(link.url) && normalizeUrl(link.url) !== normalizeUrl(entryUrl)) {
      return isRelevantDiscoveryLink(link);
    }
    if (
      isTopPortalPage(link.url) &&
      normalizeUrl(link.url) === normalizeUrl(entryUrl) &&
      target.registered_urls.indexOf(normalizeUrl(link.url)) < 0
    ) {
      return false;
    }
    return true;
  });

  return rankDiscoveryLinks(filtered);
}

function scoreDiscoveryLinkHeuristic(link) {
  let score = (link.matched_hints || []).length * 5;
  if (isCmsHubUrl(link.url)) {
    score += 15;
  }
  if (detectCmsPattern(link.url)) {
    score += 10;
  }
  if (matchesDisasterSignals([link.label, link.url].join(" "), link.url)) {
    score += 12;
  }
  if ((link.crawl_depth || 1) === 1) {
    score += 4;
  }
  if ((link.discovery_methods || []).indexOf("registered_seed") >= 0) {
    score += 20;
  }
  return score;
}

function rankDiscoveryLinks(links) {
  return links.slice().sort(function (a, b) {
    return scoreDiscoveryLinkHeuristic(b) - scoreDiscoveryLinkHeuristic(a);
  });
}

function resolveFixtureHtml(url, options) {
  const fixtureMap = options.candidateFixtureMap || {};
  if (fixtureMap[url]) {
    return fixtureMap[url];
  }
  const normalized = normalizeUrl(url);
  return fixtureMap[normalized] || options.candidateFixtureHtml;
}

function inferPublicCategory(link, pageText) {
  const haystack = [link.label, link.url].concat(link.matched_hints || []).join(" ") + " " + (pageText || "");
  const matched = [];

  CATEGORY_RULES.forEach(function (rule) {
    if (rule.patterns.some(function (pattern) {
      return pattern.test(haystack);
    })) {
      matched.push(rule.category);
    }
  });

  if (!matched.length) {
    return { public_category_id: "EMERGENCY", confidence: "LOW" };
  }

  const priority = ["WATER", "SHELTER", "SUPPORT", "ROAD", "COMMUNICATION", "EMERGENCY"];
  const category = priority.find(function (item) {
    return matched.indexOf(item) >= 0;
  });

  return {
    public_category_id: category,
    confidence: matched.length === 1 ? "HIGH" : "MEDIUM"
  };
}

function inferPatrolRole(entryUrl, candidateUrl, publicCategoryId) {
  if (publicCategoryId === "EMERGENCY" && normalizeUrl(candidateUrl) === normalizeUrl(entryUrl)) {
    return "primary";
  }
  return "secondary";
}

function buildDiscoveryId(areaId, category, url) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const digest = crypto
    .createHash("sha256")
    .update([areaId, category, url].join("|"))
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return "PDU-" + stamp + "-" + areaId + "-" + category + "-" + digest;
}

function buildSourceId(areaId, category, patrolRole) {
  const slug = category.toLowerCase();
  const roleSuffix = patrolRole === "primary" ? "" : "-" + slug;
  return areaId + roleSuffix;
}

function analyzeFetchedPage(fetchResult) {
  const parsed = parsePage(fetchResult);
  const html = fetchResult.body || "";
  const normalized = normalizeContent(html);
  const text = normalized.text || "";
  const title = parsed.title || extractTitle(html);

  const httpPass = fetchResult.ok && fetchResult.status >= 200 && fetchResult.status < 400;
  const htmlPass = Boolean(title) && text.length >= 40;
  const contamination = CONTAMINATION_PATTERNS.some(function (pattern) {
    return pattern.test(text);
  });

  let verdict = "WARNING";
  let reason = "page fetched but weak disaster signals";

  if (!httpPass) {
    verdict = "FAIL";
    reason = "HTTP fetch failed";
  } else if (!htmlPass) {
    verdict = "FAIL";
    reason = "HTML parse insufficient";
  } else if (contamination) {
    verdict = "FAIL";
    reason = "possible 2016 contamination";
  } else if ((parsed.keywords || []).length >= 2) {
    verdict = "PASS";
    reason = "disaster keywords detected";
  } else if ((parsed.keywords || []).length === 1) {
    verdict = "WARNING";
    reason = "limited disaster keywords";
  }

  return {
    http_status: fetchResult.status,
    http_pass: httpPass,
    html_pass: htmlPass,
    title: title,
    text_length: text.length,
    keywords: parsed.keywords || [],
    content_hash: parsed.contentHash,
    contamination_risk: contamination,
    verdict: verdict,
    reason: reason,
    checked_at: new Date().toISOString(),
    final_url: fetchResult.finalUrl || fetchResult.url
  };
}

function buildCandidateHaystack(link, analysis) {
  return [
    link.label,
    link.url,
    analysis && analysis.title,
    analysis && (analysis.keywords || []).join(" ")
  ]
    .filter(Boolean)
    .join(" ");
}

function detectExclusion(link, analysis) {
  const haystack = buildCandidateHaystack(link, analysis);
  for (let i = 0; i < EXCLUSION_RULES.length; i += 1) {
    const rule = EXCLUSION_RULES[i];
    const matched = rule.patterns.some(function (pattern) {
      return pattern.test(haystack);
    });
    if (matched) {
      return {
        excluded: true,
        exclusion_type: rule.type,
        exclusion_reason: "matched exclusion rule: " + rule.type
      };
    }
  }
  return {
    excluded: false,
    exclusion_type: null,
    exclusion_reason: null
  };
}

function inferPageType(link, analysis) {
  const haystack = buildCandidateHaystack(link, analysis);
  const url = link.url || "";

  if (/\.pdf$/i.test(url)) {
    return "pdf";
  }
  if (/ハザードマップ|hazardmap|bosaimap|浸水想定|土砂災害警戒/.test(haystack)) {
    return "hazard_map";
  }
  if (/アーカイブ|過去の災害|2016|平成28|H28/.test(haystack)) {
    return "archive";
  }
  if (
    /令和[78]年|地震|豪雨|台風|災害対策本部|被害状況|復旧状況/.test(haystack) ||
    /\/saigai\//i.test(url)
  ) {
    return "disaster_special";
  }
  if (/対策本部|本部設置|情報提供|dashboard/i.test(haystack)) {
    return "emergency_dashboard";
  }
  if (
    (/一覧|list/.test(haystack) || /\/list\//.test(url) || /\/q\/list\//.test(url)) &&
    /緊急|災害|防災|kinkyu|bousai|bosai/.test(haystack)
  ) {
    return "emergency_list";
  }
  if (
    /bousai|bosai|防災/.test(haystack) &&
    (/default|ハブ|portal|index|トップ/.test(haystack) || /\/bousai\/default|\/bosai\/default|\/bousai\//.test(url))
  ) {
    return "bousai_portal";
  }
  if (/\/article\/list\/|\/q\/list\/|\/kiji\//.test(url) || /記事一覧|お知らせ一覧/.test(haystack)) {
    return "article_list";
  }
  if (/組織案内|市役所案内|防災訓練|防災教育|キッズ|広報|イベント|ふるさと納税/.test(haystack)) {
    return "normal_info";
  }
  if (/お知らせ|更新|状況|復旧|断水|避難所|開設|被害|支援/.test(haystack)) {
    return "disaster_special";
  }
  return "normal_info";
}

function scoreTier(score) {
  if (score >= 80) {
    return "HIGH";
  }
  if (score >= 50) {
    return "MEDIUM";
  }
  return "LOW";
}

function inferRecommendedRole(pageType, score, exclusion) {
  if (exclusion && exclusion.excluded) {
    return "skip";
  }
  if (score < 50) {
    return "skip";
  }
  if (
    score >= 80 &&
    (pageType === "bousai_portal" ||
      pageType === "emergency_list" ||
      pageType === "emergency_dashboard")
  ) {
    return "primary";
  }
  if (
    score >= 50 &&
    (pageType === "disaster_special" ||
      pageType === "article_list" ||
      pageType === "emergency_list" ||
      pageType === "bousai_portal")
  ) {
    return "secondary";
  }
  if (
    pageType === "pdf" ||
    pageType === "archive" ||
    pageType === "hazard_map" ||
    pageType === "normal_info"
  ) {
    return "skip";
  }
  return "secondary";
}

function collectDetectedKeywords(link, analysis) {
  const keywords = new Set();
  (link.matched_hints || []).forEach(function (keyword) {
    keywords.add(keyword);
  });
  if (analysis && analysis.keywords) {
    analysis.keywords.forEach(function (keyword) {
      keywords.add(keyword);
    });
  }
  return Array.from(keywords);
}

function calculateCandidateScore(link, analysis, categoryInfo, target, exclusion) {
  let score = 0;

  score += Math.min((link.matched_hints || []).length * 8, 24);

  if (categoryInfo.confidence === "HIGH") {
    score += 20;
  } else if (categoryInfo.confidence === "MEDIUM") {
    score += 12;
  } else {
    score += 4;
  }

  if (analysis) {
    if (analysis.verdict === "PASS") {
      score += 30;
    } else if (analysis.verdict === "WARNING") {
      score += 12;
    }
    score += Math.min((analysis.keywords || []).length * 4, 20);
    if (analysis.contamination_risk) {
      score -= 50;
    }
  }

  if (urlMatchesDomain(link.url, target.official_domain)) {
    score += 10;
  }

  if (target.registered_urls.indexOf(normalizeUrl(link.url)) >= 0) {
    score -= 5;
  }

  if (matchesDisasterSignals(link.label + " " + link.url, link.url)) {
    score += 10;
  }

  if (link.cms_pattern) {
    score += 6;
  }

  if (exclusion && exclusion.excluded) {
    score = Math.min(score, 35);
  }

  const pageType = inferPageType(link, analysis);
  if (
    pageType === "bousai_portal" ||
    pageType === "emergency_list" ||
    pageType === "disaster_special" ||
    pageType === "emergency_dashboard"
  ) {
    score += 8;
  }
  if (
    pageType === "pdf" ||
    pageType === "archive" ||
    pageType === "hazard_map" ||
    pageType === "normal_info"
  ) {
    score -= 25;
  }

  return Math.max(0, Math.min(100, score));
}

function buildPatrolCandidate(target, link, analysis, options) {
  options = options || {};
  const categoryInfo = inferPublicCategory(link, analysis ? analysis.title : link.label);
  const patrolRole = inferPatrolRole(target.entry_url, link.url, categoryInfo.public_category_id);
  const normalizedUrl = normalizeUrl(link.url);
  const alreadyRegistered = target.registered_urls.indexOf(normalizedUrl) >= 0;
  const registeredSource = (target.registered_sources || []).find(function (source) {
    return normalizeUrl(source.url) === normalizedUrl;
  });
  const exclusion = detectExclusion(link, analysis);
  const pageType = inferPageType(link, analysis);
  const score = calculateCandidateScore(link, analysis, categoryInfo, target, exclusion);
  const detectedKeywords = collectDetectedKeywords(link, analysis);
  const recommendedRole = inferRecommendedRole(pageType, score, exclusion);
  const tier = scoreTier(score);
  let discoveryStatus = alreadyRegistered ? "ALREADY_REGISTERED" : "DISCOVERED";
  if (exclusion.excluded && !alreadyRegistered) {
    discoveryStatus = "SKIPPED";
  }

  return {
    discovery_id: buildDiscoveryId(target.area_id, categoryInfo.public_category_id, normalizedUrl),
    prefecture: target.prefecture,
    municipality: target.municipality,
    official_domain: target.official_domain,
    area_id: target.area_id,
    entry_url: target.entry_url,
    candidate_url: normalizedUrl,
    link_label: link.label,
    public_category_id: categoryInfo.public_category_id,
    patrol_role: patrolRole,
    recommended_role: recommendedRole,
    confidence: categoryInfo.confidence,
    score: score,
    score_tier: tier,
    page_type: pageType,
    detected_keywords: detectedKeywords,
    exclusion: exclusion,
    discovery_status: discoveryStatus,
    registration_status: "PENDING_REVIEW",
    auto_register: false,
    proposed_source: {
      id: registeredSource ? registeredSource.id : buildSourceId(target.area_id, categoryInfo.public_category_id, patrolRole),
      area_id: target.area_id,
      name: target.municipality,
      category: "municipality",
      url: normalizedUrl,
      public_category_id: categoryInfo.public_category_id,
      status: "CANDIDATE",
      source_type: "official",
      patrol_role: patrolRole
    },
    page_analysis: analysis || null,
    source_trace: {
      discovered_from: link.discovered_from || target.entry_url,
      discovered_at: options.discoveredAt || new Date().toISOString(),
      matched_hints: link.matched_hints || [],
      discovery_methods: link.discovery_methods || ["entry_link"],
      crawl_depth: typeof link.crawl_depth === "number" ? link.crawl_depth : 1,
      cms_pattern: link.cms_pattern || detectCmsPattern(normalizedUrl),
      registry_match_id: registeredSource ? registeredSource.id : null,
      input: target.input
    }
  };
}

function validateDiscoveryCandidate(candidate) {
  const errors = [];
  const required = [
    "discovery_id",
    "prefecture",
    "municipality",
    "official_domain",
    "area_id",
    "entry_url",
    "candidate_url",
    "public_category_id",
    "patrol_role",
    "recommended_role",
    "score",
    "score_tier",
    "page_type",
    "detected_keywords",
    "exclusion",
    "discovery_status",
    "registration_status",
    "proposed_source",
    "source_trace"
  ];

  required.forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(candidate, key)) {
      errors.push("missing field: " + key);
    }
  });

  if (candidate.auto_register !== false) {
    errors.push("auto_register must be false");
  }

  if (typeof candidate.score !== "number" || candidate.score < 0 || candidate.score > 100) {
    errors.push("score must be a number between 0 and 100");
  }

  if (!Array.isArray(candidate.detected_keywords)) {
    errors.push("detected_keywords must be an array");
  }

  if (PAGE_TYPES.indexOf(candidate.page_type) < 0) {
    errors.push("invalid page_type: " + candidate.page_type);
  }

  if (["HIGH", "MEDIUM", "LOW"].indexOf(candidate.score_tier) < 0) {
    errors.push("invalid score_tier: " + candidate.score_tier);
  }

  if (REGISTRATION_STATUSES.indexOf(candidate.registration_status) < 0) {
    errors.push("invalid registration_status: " + candidate.registration_status);
  }

  if (DISCOVERY_STATUSES.indexOf(candidate.discovery_status) < 0) {
    errors.push("invalid discovery_status: " + candidate.discovery_status);
  }

  if (!candidate.source_trace || !candidate.source_trace.discovered_from) {
    errors.push("source_trace.discovered_from is required");
  }

  return errors;
}

function validateDiscoveryBatch(batch) {
  const errors = [];

  if (!batch || !Array.isArray(batch.candidates)) {
    errors.push("candidates array missing");
    return errors;
  }

  if (batch.autoRegister !== false) {
    errors.push("autoRegister must be false");
  }

  const inputErrors = validateDiscoveryInput(batch.input || {});
  if (inputErrors.length) {
    errors.push.apply(errors, inputErrors.map(function (message) {
      return "input: " + message;
    }));
  }

  const seenUrls = new Set();
  batch.candidates.forEach(function (candidate, index) {
    const itemErrors = validateDiscoveryCandidate(candidate);
    itemErrors.forEach(function (message) {
      errors.push("candidates[" + index + "]: " + message);
    });

    if (seenUrls.has(candidate.candidate_url)) {
      errors.push("candidates[" + index + "]: duplicate candidate_url");
    }
    seenUrls.add(candidate.candidate_url);
  });

  return errors;
}

function buildDiscoveryBatch(candidates, options) {
  options = options || {};
  return {
    version: ENGINE_VERSION,
    engineVersion: ENGINE_VERSION,
    generatedAt: options.generatedAt || new Date().toISOString(),
    incidentScope: INCIDENT_SCOPE,
    input: options.input || null,
    municipality: options.municipality || (options.input && options.input.municipality) || null,
    prefecture: options.prefecture || (options.input && options.input.prefecture) || null,
    official_domain: options.official_domain || (options.input && options.input.official_domain) || null,
    area_id: options.area_id || null,
    entry_url: options.entry_url || null,
    candidateCount: candidates.length,
    discoveredCount: candidates.filter(function (item) {
      return item.discovery_status === "DISCOVERED";
    }).length,
    alreadyRegisteredCount: candidates.filter(function (item) {
      return item.discovery_status === "ALREADY_REGISTERED";
    }).length,
    autoRegister: false,
    sourceRegistryFile: toRepoRelative(SOURCES_FILE),
    candidates: candidates
  };
}

async function fetchPageContent(url, options) {
  if (options && options.fixtureHtml) {
    return {
      ok: true,
      url: url,
      finalUrl: url,
      status: 200,
      body: options.fixtureHtml,
      headers: { "content-type": "text/html; charset=utf-8" }
    };
  }
  return fetchSource(url);
}

async function discoverPatrolUrls(input, options) {
  options = options || {};
  const target = resolveDiscoveryTarget(input, {
    entryUrl: options.entryUrl
  });

  if (!target.found) {
    return {
      saved: false,
      reason: target.reason || "discovery target not resolved",
      errors: target.inputErrors || [],
      candidates: []
    };
  }

  const entryFetch = await fetchPageContent(target.entry_url, {
    fixtureHtml: options.entryFixtureHtml
  });
  const entryAnalysis = analyzeFetchedPage(entryFetch);
  const pageCache = new Map();
  pageCache.set(normalizeUrl(target.entry_url), entryFetch);
  const links = await collectDiscoveryLinks(target, entryFetch, {
    pageCache: pageCache,
    candidateFixtureMap: options.candidateFixtureMap,
    candidateFixtureHtml: options.candidateFixtureHtml
  });
  const maxCandidates = options.maxCandidates || 15;
  const limitedLinks = links.slice(0, maxCandidates);

  const candidates = [];
  for (let i = 0; i < limitedLinks.length; i += 1) {
    const link = limitedLinks[i];
    let analysis = null;

    if (options.analyzeCandidates !== false) {
      const fixtureMap = options.candidateFixtureMap || {};
      let candidateFetch = pageCache.get(normalizeUrl(link.url));
      if (!candidateFetch) {
        candidateFetch = await fetchPageContent(link.url, {
          fixtureHtml: resolveFixtureHtml(link.url, options)
        });
        pageCache.set(normalizeUrl(link.url), candidateFetch);
      }
      analysis = analyzeFetchedPage(candidateFetch);
    }

    candidates.push(
      buildPatrolCandidate(target, link, analysis, {
        discoveredAt: options.discoveredAt
      })
    );
  }

  candidates.sort(function (a, b) {
    return b.score - a.score;
  });

  const batch = buildDiscoveryBatch(candidates, {
    input: target.input,
    municipality: target.municipality,
    prefecture: target.prefecture,
    official_domain: target.official_domain,
    area_id: target.area_id,
    entry_url: target.entry_url,
    generatedAt: options.discoveredAt
  });

  const batchErrors = validateDiscoveryBatch(batch);
  if (batchErrors.length) {
    return {
      saved: false,
      reason: "discovery batch validation failed",
      errors: batchErrors,
      entry_analysis: entryAnalysis,
      candidates: candidates
    };
  }

  let runOutputPath = null;
  if (!options.dryRun) {
    ensureDir(OUTPUT_DIR);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    runOutputPath = path.join(
      OUTPUT_DIR,
      "patrol-url-discovery-" + target.area_id + "-" + stamp + ".json"
    );
    writeJson(runOutputPath, batch);
    writeJson(MASTER_CANDIDATES_FILE, batch);
  }

  return {
    saved: !options.dryRun,
    dryRun: options.dryRun === true,
    input: target.input,
    municipality: target.municipality,
    prefecture: target.prefecture,
    official_domain: target.official_domain,
    area_id: target.area_id,
    entry_url: target.entry_url,
    entry_analysis: entryAnalysis,
    linkCount: links.length,
    candidateCount: candidates.length,
    discoveredCount: batch.discoveredCount,
    alreadyRegisteredCount: batch.alreadyRegisteredCount,
    masterOutputPath: options.dryRun ? null : MASTER_CANDIDATES_FILE,
    runOutputPath: runOutputPath,
    candidates: candidates,
    errors: []
  };
}

module.exports = {
  INCIDENT_SCOPE,
  ENGINE_VERSION,
  REGISTRATION_STATUSES,
  DISCOVERY_STATUSES,
  PAGE_TYPES,
  DISASTER_SEARCH_KEYWORDS,
  DISASTER_PATH_PATTERNS,
  CMS_PATTERNS,
  MAX_CRAWL_LINKS_PER_PAGE,
  MAX_CRAWL_DEPTH,
  EXCLUSION_RULES,
  SOURCES_FILE,
  OUTPUT_DIR,
  MASTER_CANDIDATES_FILE,
  LINK_HINTS,
  LINK_HINTS_BASE,
  CATEGORY_RULES,
  normalizeUrl,
  normalizeDomain,
  urlMatchesDomain,
  validateDiscoveryInput,
  loadSourcesRegistry,
  listMunicipalities,
  resolveDiscoveryTarget,
  detectCmsPattern,
  isTopPortalPage,
  isCmsHubUrl,
  matchesDisasterSignals,
  isRelevantDiscoveryLink,
  buildDisasterProbeUrls,
  extractInternalLinks,
  extractDiscoveryLinks,
  mergeDiscoveryLinks,
  collectDiscoveryLinks,
  inferPublicCategory,
  inferPatrolRole,
  detectExclusion,
  inferPageType,
  scoreTier,
  inferRecommendedRole,
  collectDetectedKeywords,
  calculateCandidateScore,
  buildDiscoveryId,
  analyzeFetchedPage,
  buildPatrolCandidate,
  validateDiscoveryCandidate,
  validateDiscoveryBatch,
  buildDiscoveryBatch,
  discoverPatrolUrls
};
