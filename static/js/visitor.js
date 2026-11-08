(() => {
  "use strict";

  const endpoint = document.currentScript.dataset.endpoint;
  const hostname = location.hostname.toLowerCase();
  if (!["http:", "https:"].includes(location.protocol) ||
      hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname)) return;

  const key = "portfolio-visitor-notified";
  const pending = String(Date.now());
  try {
    const state = sessionStorage.getItem(key);
    if (state === "sent" || (state && Date.now() - Number(state) < 30000)) return;
    sessionStorage.setItem(key, pending);
  } catch (error) {
    console.warn("Visitor notification unavailable: session storage is blocked.", error);
    return;
  }

  fetch(endpoint, { method: "POST", keepalive: true, credentials: "omit" })
    .then((response) => {
      if (!response.ok) throw new Error(`Visitor relay returned ${response.status}`);
      sessionStorage.setItem(key, "sent");
    })
    .catch((error) => {
      try {
        if (sessionStorage.getItem(key) === pending) sessionStorage.removeItem(key);
      } catch (storageError) {
        console.warn("Could not reset visitor notification state.", storageError);
      }
      console.warn("Visitor notification failed.", error);
    });
})();
