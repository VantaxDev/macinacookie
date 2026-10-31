/* Macinacookie — pure helpers, shared by the background script and tests. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MacinacookieCore = api;
})(globalThis, function () {
  "use strict";
  const DAY_MS = 86400000;
  const HOUR_MS = 3600000;
  const DEFAULT_SETTINGS = Object.freeze({maxAgeDays: 30, autoEnabled: false, intervalHours: 24, excludedDomains: Object.freeze([])});

  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
    }
    return value;
  }

  function normalizeDomain(value) {
    if (typeof value !== "string") throw new Error("Inserisci solo nomi di dominio, per esempio esempio.it.");
    const text = value.trim().toLowerCase().replace(/^\./, "").replace(/\.$/, "");
    if (!text || /[\s/@?#\\*%]/u.test(text) || (text.includes(":") && !/^\[[0-9a-f:]+\]$/i.test(text))) {
      throw new Error("Dominio non valido: usa un nome come esempio.it, senza indirizzi, percorsi o asterischi.");
    }
    let hostname;
    try { hostname = new URL("https://" + text + "/").hostname; }
    catch (_) { throw new Error("Uno dei domini da proteggere non è valido."); }
    if (!hostname.startsWith("[") && (hostname.length > 253 || hostname.split(".").some(part => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part)))) {
      throw new Error("Uno dei domini da proteggere non è valido.");
    }
    return hostname;
  }

  function normalizeSettings(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Impostazioni non valide.");
    if (!Number.isInteger(input.maxAgeDays) || input.maxAgeDays < 1 || input.maxAgeDays > 120) {
      throw new Error("L’età dei cookie deve essere un numero intero da 1 a 120 giorni.");
    }
    if (typeof input.autoEnabled !== "boolean") throw new Error("Scegli se attivare la pulizia automatica.");
    if (!Number.isInteger(input.intervalHours) || input.intervalHours < 1 || input.intervalHours > 2880) {
      throw new Error("L’intervallo deve essere un numero intero da 1 a 2880 ore (120 giorni).");
    }
    if (!Array.isArray(input.excludedDomains) || input.excludedDomains.length > 1000) throw new Error("Inserisci al massimo 1000 domini da proteggere.");
    return {
      maxAgeDays: input.maxAgeDays,
      autoEnabled: input.autoEnabled,
      intervalHours: input.intervalHours,
      excludedDomains: [...new Set(input.excludedDomains.map(normalizeDomain))].sort()
    };
  }

  function partition(cookie) {
    return cookie.partitionKey && Object.keys(cookie.partitionKey).length ? stable(cookie.partitionKey) : null;
  }

  function cookieIdentity(cookie) {
    return JSON.stringify([cookie.storeId, cookie.domain, cookie.path, cookie.name, cookie.firstPartyDomain || "", partition(cookie)]);
  }

  function fingerprintInput(cookie) {
    return JSON.stringify([
      cookieIdentity(cookie), cookie.value, Boolean(cookie.hostOnly), Boolean(cookie.secure),
      Boolean(cookie.httpOnly), Boolean(cookie.session), cookie.sameSite || "", cookie.expirationDate ?? null
    ]);
  }

  function domainName(domain) {
    return String(domain).toLowerCase().replace(/^\./, "").replace(/\.$/, "");
  }

  function isExcluded(domain, exclusions) {
    const host = domainName(domain);
    return exclusions.some(item => host === item || host.endsWith("." + item));
  }

  function eligibility(record, cookie, settings, now) {
    return Boolean(record && Number.isFinite(record.firstSeenAt) && record.firstSeenAt <= now &&
      now - record.firstSeenAt >= settings.maxAgeDays * DAY_MS && !isExcluded(cookie.domain, settings.excludedDomains));
  }

  function removalDetails(cookie) {
    // Firefox selects by URL/name, not by exact cookie path/domain. Reject URLs
    // that normalize to a different path; the caller also verifies cookies.get.
    if (typeof cookie.path !== "string" || !cookie.path.startsWith("/") || /[?#\\\u0000-\u0020\u007f]/u.test(cookie.path)) return null;
    const host = String(cookie.domain).replace(/^\./, "");
    if (!host || /[\s/@?#\\%]/u.test(host)) return null;
    let url;
    try { url = new URL((cookie.secure ? "https://" : "http://") + host + cookie.path); }
    catch (_) { return null; }
    if (url.hostname.toLowerCase() !== host.toLowerCase() || url.pathname !== cookie.path || url.search || url.hash || url.port || url.username || url.password) return null;
    const details = {url: url.href, name: cookie.name, storeId: cookie.storeId, firstPartyDomain: cookie.firstPartyDomain || ""};
    const key = partition(cookie);
    if (key) {
      // Unknown partition attributes cannot safely be passed to Firefox's API.
      if (Object.keys(key).some(name => name !== "topLevelSite" && name !== "hasCrossSiteAncestor") ||
          typeof key.topLevelSite !== "string" || !key.topLevelSite ||
          ("hasCrossSiteAncestor" in key && typeof key.hasCrossSiteAncestor !== "boolean")) return null;
      details.partitionKey = key;
    }
    return details;
  }

  function summarize(entries, settings, now) {
    let eligible = 0;
    let protectedCount = 0;
    const sites = new Set();
    for (const {cookie, record} of entries) {
      sites.add(domainName(cookie.domain));
      if (isExcluded(cookie.domain, settings.excludedDomains)) protectedCount++;
      if (eligibility(record, cookie, settings, now)) eligible++;
    }
    return {total: entries.length, eligible, protected: protectedCount, sites: sites.size};
  }

  function removalResultMatches(result, cookie, details) {
    if (!result || typeof result !== "object") return false;
    if (typeof result.domain === "string" && typeof result.path === "string") {
      return cookieIdentity(result) === cookieIdentity(cookie);
    }
    // Firefox returns removal selector details, including partitionKey: null
    // for an unpartitioned cookie. Some API descriptions specify a full Cookie.
    return result.url === details.url && result.name === details.name &&
      result.storeId === details.storeId &&
      (result.firstPartyDomain || "") === (details.firstPartyDomain || "") &&
      JSON.stringify(partition(result)) === JSON.stringify(partition(details));
  }

  return Object.freeze({DAY_MS, HOUR_MS, DEFAULT_SETTINGS, normalizeSettings, normalizeDomain, cookieIdentity, fingerprintInput, domainName, isExcluded, eligibility, removalDetails, removalResultMatches, summarize});
});
