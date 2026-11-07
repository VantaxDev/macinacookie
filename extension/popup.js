"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const number = new Intl.NumberFormat("it-IT");
  const date = new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" });

  let viewEpoch = 0;
  async function load() {
    const ticket = ++viewEpoch;
    $("popup-error").hidden = true;
    $("popup-retry").hidden = true;
    $("popup-stats").setAttribute("aria-busy", "true");
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
      if (ticket !== viewEpoch) return;
      if (!response?.ok) throw new Error(response?.error || "Chrome non ha risposto.");
      const data = response.data;
      if (!data.consent?.active) {
        $("popup-mode").textContent = "Osservazione inattiva";
        $("popup-mode").classList.remove("is-active");
        $("popup-total").textContent = "—";
        $("popup-eligible").textContent = "—";
        $("popup-next").textContent = "Apri Macinacookie per leggere l’informativa e scegliere se attivare l’osservazione.";
        $("popup-warning").hidden = !data.consent?.warning;
        $("popup-warning").textContent = data.consent?.warning || "";
        return;
      }
      const warning = data.warning || data.lastRun?.error;
      $("popup-warning").textContent = warning ? `Attenzione: ${warning}` : "";
      $("popup-warning").hidden = !warning;
      $("popup-total").textContent = data.stats ? number.format(data.stats.total) : "—";
      $("popup-eligible").textContent = data.stats ? number.format(data.stats.eligible) : "—";
      const label = !data.hasPermissions ? "Accesso ai cookie da consentire" : data.scanAvailable === false ? "Lettura non disponibile" : data.settings.autoEnabled ? "Pulizia automatica attiva" : "Modalità manuale";
      const badge = $("popup-mode");
      badge.replaceChildren();
      const dot = document.createElement("span");
      dot.className = "status-dot";
      badge.append(dot, document.createTextNode(label));
      badge.classList.toggle("is-active", data.hasPermissions && data.scanAvailable !== false && data.settings.autoEnabled);
      $("popup-next").textContent = !data.hasPermissions
        ? "Apri Macinacookie per concedere l’accesso ai cookie."
        : data.scanAvailable === false
          ? "Apri Macinacookie per verificare perché la lettura non è disponibile."
        : data.settings.autoEnabled && data.nextRunAt
          ? `Prossima pulizia: ${date.format(new Date(data.nextRunAt))}, con Chrome aperto.`
          : `Conservazione: ${data.settings.maxAgeDays} ${data.settings.maxAgeDays === 1 ? "giorno" : "giorni"}. Sei tu a decidere quando fare pulizia.`;
    } catch (error) {
      $("popup-error").textContent = error.message || "Impossibile leggere i cookie. Riprova tra un momento.";
      $("popup-error").hidden = false;
      $("popup-retry").hidden = false;
      $("popup-mode").textContent = "Lettura non disponibile";
      $("popup-next").textContent = "Puoi aprire la pagina completa per gestire le preferenze.";
    } finally {
      $("popup-stats").setAttribute("aria-busy", "false");
    }
  }

  $("popup-retry").addEventListener("click", load);
  $("open-dashboard").addEventListener("click", async () => {
    const button = $("open-dashboard");
    if (button.disabled) return;
    button.disabled = true;
    try {
      try {
        await chrome.runtime.openOptionsPage();
      } catch {
        await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
      }
      window.close();
    } catch (error) {
      $("popup-error").textContent = error.message || "Non è stato possibile aprire Macinacookie.";
      $("popup-error").hidden = false;
    } finally { button.disabled = false; }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.macinacookieConsent) load();
  });
  load();
})();
