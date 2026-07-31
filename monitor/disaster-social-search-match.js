"use strict";

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildEntryContentHaystack(entry) {
  return normalizeSearchText([entry.title, entry.content].filter(Boolean).join(" "));
}

function expandMunicipalityRegionVariants(token) {
  const normalized = normalizeSearchText(token);
  const variants = [normalized];
  if (/(市|町|村)$/.test(normalized)) {
    variants.push(normalized.replace(/(市|町|村)$/, ""));
  }
  return variants.filter(Boolean);
}

function matchesMunicipalityRegionToken(contentHay, metaHay, token) {
  const variants = expandMunicipalityRegionVariants(token);
  return variants.some(function (variant) {
    return metaHay.indexOf(variant) !== -1 || contentHay.indexOf(variant) !== -1;
  });
}

function matchesPetQuery(content) {
  if (/ペットボトル/.test(content)) {
    return false;
  }
  return /迷子(猫|犬)?|迷い(猫|犬)|保護(猫|犬)|ペット(可|避難|支援|用品|保護)?|犬を探|猫を探|犬が迷|猫が迷|飼い主捜索/.test(
    content
  );
}

function matchesLostPetQuery(content, query) {
  const normalized = normalizeSearchText(query);
  if (normalized === "迷子猫" || normalized === "迷い猫") {
    return /迷子猫|迷い猫|猫を探|猫が迷/.test(content);
  }
  if (normalized === "迷子犬" || normalized === "迷い犬") {
    return /迷子犬|迷い犬|犬を探|犬が迷/.test(content);
  }
  if (normalized === "迷子") {
    return /迷子(猫|犬)?|迷い(猫|犬)|を探しています/.test(content);
  }
  return false;
}

function matchesIceQuery(content) {
  if (/氷配布|製氷|氷があり|氷を|氷の|かき氷|冷却|身体を冷やす/.test(content)) {
    return true;
  }
  const stripped = content.replace(/氷川[町村]?/g, "");
  return /氷/.test(stripped);
}

function matchesCoolingQuery(content) {
  return /冷却|冷やす|クーラー|冷房|暑さ対策|熱中症/.test(content);
}

function matchesElectricQuery(content) {
  return /電気|停電|発電|充電/.test(content);
}

function matchesWifiQuery(content) {
  if (/インターネット/.test(content)) {
    return false;
  }
  if (/(?<![ァ-ヶー])ネット(?!ワーク)/.test(content)) {
    return false;
  }
  return /wi-?fi|wifi|ワイファイ|ｗｉ-?ｆｉ/i.test(content);
}

function matchesCarShelterQuery(content) {
  return /車中泊|車で避難|車避難|車両避難/.test(content);
}

function matchesPreciseSearchQuery(contentHay, rawQuery) {
  const query = normalizeSearchText(rawQuery);
  if (!query) {
    return false;
  }

  if (query === "ペット") {
    return matchesPetQuery(contentHay);
  }
  if (query === "迷子" || query === "迷子猫" || query === "迷子犬") {
    return matchesLostPetQuery(contentHay, query);
  }
  if (query === "氷") {
    return matchesIceQuery(contentHay);
  }
  if (query === "冷却") {
    return matchesCoolingQuery(contentHay);
  }
  if (query === "電気") {
    return matchesElectricQuery(contentHay);
  }
  if (query === "wi-fi" || query === "wifi") {
    return matchesWifiQuery(contentHay);
  }
  if (query === "車中泊") {
    return matchesCarShelterQuery(contentHay);
  }
  if (query === "犬" || query === "猫") {
    return false;
  }

  return contentHay.indexOf(query) !== -1;
}

const CATEGORY_KEYWORD_NO_EXPAND = {
  井戸水: true,
  氷: true,
  冷却: true,
  電気: true,
  ペット: true,
  迷子: true,
  迷子猫: true,
  迷子犬: true,
  "wi-fi": true,
  wifi: true,
  車中泊: true
};

function getCategoryKeywordsForQuery(categoryId, rawQuery, categoryKeywords) {
  const keywords = categoryKeywords[categoryId] || [];
  const normalizedQuery = normalizeSearchText(rawQuery);
  if (!normalizedQuery) {
    return keywords;
  }
  if (CATEGORY_KEYWORD_NO_EXPAND[normalizedQuery]) {
    return keywords.filter(function (keyword) {
      return normalizeSearchText(keyword) === normalizedQuery;
    });
  }
  return keywords;
}

function findMatchedCategoryKeyword(contentHay, categoryId, rawQuery, categoryKeywords) {
  const keywords = getCategoryKeywordsForQuery(categoryId, rawQuery, categoryKeywords);
  let matched = "";
  keywords.forEach(function (keyword) {
    if (!matched && matchesPreciseSearchQuery(contentHay, keyword)) {
      matched = keyword;
    }
  });
  return matched;
}

function matchesSocialSearchQuery(entry, categoryQuery, rawQuery, categoryKeywords) {
  if (!categoryQuery && !rawQuery) {
    return true;
  }

  const contentHay = buildEntryContentHaystack(entry);
  const query = String(rawQuery || "").trim();

  if (query && matchesPreciseSearchQuery(contentHay, query)) {
    return true;
  }

  if (!categoryQuery) {
    return false;
  }

  return Boolean(findMatchedCategoryKeyword(contentHay, categoryQuery, query, categoryKeywords));
}

function describeSocialSearchMatch(entry, resolvedCategory, userQuery, categoryLabels, categoryKeywords) {
  const categoryLabel = categoryLabels[resolvedCategory] || resolvedCategory || "その他";
  const contentHay = buildEntryContentHaystack(entry);
  const query = String(userQuery || "").trim();
  let matchedKeyword = "";

  if (query && matchesPreciseSearchQuery(contentHay, query)) {
    matchedKeyword = query;
  } else {
    matchedKeyword =
      findMatchedCategoryKeyword(contentHay, resolvedCategory, query, categoryKeywords) ||
      categoryLabel;
  }

  return {
    categoryLabel: categoryLabel,
    matchedKeyword: matchedKeyword
  };
}

module.exports = {
  normalizeSearchText,
  buildEntryContentHaystack,
  expandMunicipalityRegionVariants,
  matchesMunicipalityRegionToken,
  matchesPreciseSearchQuery,
  getCategoryKeywordsForQuery,
  findMatchedCategoryKeyword,
  matchesSocialSearchQuery,
  describeSocialSearchMatch,
  CATEGORY_KEYWORD_NO_EXPAND
};
