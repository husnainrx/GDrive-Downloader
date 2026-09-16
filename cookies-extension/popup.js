import { getGDriveCookies, cookiesToNetscape } from "./cookieFetch.js";

const downloadBtn = document.getElementById("download");
const statusEl = document.getElementById("status");

const setStatus = (msg) => { statusEl.textContent = msg; };

downloadBtn.addEventListener("click", async () => {
  setStatus("Reading cookies…");
  downloadBtn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Prefer the active tab URL if it's a Google page, otherwise use Drive scope.
    let tabUrl = "";
    if (tab && tab.url && /^https:\/\/([a-z0-9-]+\.)*google\.com/.test(tab.url)) {
      tabUrl = tab.url;
    }

    const cookies = await getGDriveCookies(tabUrl);

    if (!cookies.length) {
      setStatus("No cookies found. Open drive.google.com and sign in first.");
      return;
    }

    const text = cookiesToNetscape(cookies);

    // Warn if any critical auth cookies are missing so the file is known-good.
    const critical = cookies.map((c) => c.name);
    const missing = ["SAPISID", "__Secure-1PAPISID", "__Secure-3PAPISID",
                     "SID", "__Secure-1PSID", "__Secure-3PSID"].filter((n) => !critical.includes(n));
    const warning = missing.length
      ? `\n\nNOTE: missing critical cookies: ${missing.join(", ")} — re-sign in to Google and retry.`
      : "";

    const blob = new Blob([text + warning], { type: "text/plain" });
    const dataUrl = URL.createObjectURL(blob);

    await chrome.downloads.download({
      url: dataUrl,
      filename: "cookies.txt",
      saveAs: false,
      conflictAction: "overwrite",
    });

    setStatus(`${cookies.length} cookies saved to Downloads (all cookies).${warning}`);
  } catch (e) {
    setStatus("Failed: " + e.message);
  } finally {
    downloadBtn.disabled = false;
  }
});