// Cookie retrieval logic adapted from "Get cookies.txt LOCALLY"
// (https://github.com/kairi003/Get-cookies.txt-LOCALLY) which uses the
// chrome.cookies.getAll API, plus the Netscape serializer used to download.

/**
 * Get the cookie store id for the currently active tab.
 * @returns {Promise<string|undefined>}
 */
async function getCurrentCookieStoreId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return undefined;
  if (tab.cookieStoreId) return tab.cookieStoreId;
  const stores = await chrome.cookies.getAllCookieStores();
  const found = stores.find((store) => store.tabIds.includes(tab.id));
  return found ? found.id : undefined;
}

/**
 * Get all cookies that match the given details, including partition-key aware
 * browsers (Chrome >= 119).
 * @param {chrome.cookies.GetAllDetails} details
 * @returns {Promise<chrome.cookies.Cookie[]>}
 */
async function getAllCookies(details) {
  if (details.storeId === undefined) details.storeId = await getCurrentCookieStoreId();
  const { partitionKey, ...detailsWithoutPartitionKey } = details;
  const cookiesWithPartitionKey = partitionKey
    ? await Promise.resolve()
        .then(() => chrome.cookies.getAll(details))
        .catch(() => [])
    : [];
  const cookies = await chrome.cookies.getAll(detailsWithoutPartitionKey);
  return [...cookies, ...cookiesWithPartitionKey];
}

/**
 * Collect the Google login + Drive session cookies. URL + host scope so we get
 * SAPISID / __Secure-1PAPISID / SID etc. from .google.com AND COMPASS from
 * drive.google.com. Dedupes by name|domain|path.
 * @param {string} tabUrl
 * @returns {Promise<chrome.cookies.Cookie[]>}
 */
export async function getGDriveCookies(tabUrl) {
  const storeId = await getCurrentCookieStoreId();
  const scope = ["https://google.com/", "https://drive.google.com/", "https://www.google.com/"];
  if (tabUrl && tabUrl.startsWith("http")) scope.unshift(tabUrl);

  const seen = new Map();
  for (const url of scope) {
    const withPartition = await getAllCookies({
      url, storeId,
      partitionKey: tabUrl ? { topLevelSite: new URL(tabUrl).origin } : undefined,
    }).catch(() => []);
    const withoutPartition = await getAllCookies({ url, storeId }).catch(() => []);
    for (const c of [...withPartition, ...withoutPartition]) {
      seen.set(`${c.name}|${c.domain}|${c.path}`, c);
    }
  }

  // Reorder so the critical auth cookies come first (helps debugging).
  const priority = ["SAPISID", "__Secure-1PAPISID", "__Secure-3PAPISID",
                    "SID", "__Secure-1PSID", "__Secure-3PSID", "COMPASS"];
  const all = [...seen.values()];
  all.sort((a, b) => {
    const ia = priority.indexOf(a.name);
    const ib = priority.indexOf(b.name);
    if (ia >= 0 || ib >= 0) return ((ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib));
    return 0;
  });
  return all;
}

/** Netscape cookies.txt serialization (same as Get cookies.txt LOCALLY). */
export function cookiesToNetscape(cookies) {
  const rows = cookies.map(({ domain, expirationDate, path, secure, name, value }) => {
    const includeSubDomain = !!(domain && domain.startsWith("."));
    const expiry = expirationDate ? expirationDate.toFixed() : "0";
    return [
      domain,
      includeSubDomain.toString().toUpperCase(),
      path,
      secure.toString().toUpperCase(),
      expiry,
      name,
      value,
    ].join("\t");
  });
  return [
    "# Netscape HTTP Cookie File",
    "# This is a generated file! Do not edit.",
    "",
    ...rows,
    "",
  ].join("\n");
}