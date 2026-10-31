"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const number = new Intl.NumberFormat("it-IT");
  const date = new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" });

  async function load() {
    $("popup-error").hidden = true;
    $("popup-retry").hidden = true;
    $("popup-stats").setAttribute("aria-busy", "true");
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
      if (!response?.ok) throw new Error(response?.error || "Chrome non ha risposto.");
      const data = response.data;
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
      const isAndroid = data.platform === "android";
      $("popup-platform-note").hidden = !isAndroid;
      $("popup-next").textContent = !data.hasPermissions
        ? "Apri Macinacookie per concedere l’accesso ai cookie."
        : data.scanAvailable === false
          ? "Apri Macinacookie per verificare perché la lettura non è disponibile."
        : data.settings.autoEnabled && data.nextRunAt
          ? `${isAndroid ? "Prossima scadenza" : "Prossima pulizia"}: ${date.format(new Date(data.nextRunAt))}${isAndroid ? "." : ", con Chrome aperto."}`
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
  load();
})();
