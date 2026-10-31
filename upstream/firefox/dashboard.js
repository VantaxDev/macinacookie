"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const number = new Intl.NumberFormat("it-IT");
  const date = new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" });
  let status = null;
  let preview = null;
  let selected = new Set();
  let busy = false;
  let dirty = false;
  let deleting = false;
  let confirmIds = [];

  async function request(type, fields = {}) {
    const response = await browser.runtime.sendMessage({ type, ...fields });
    if (!response || !response.ok) throw new Error(response?.error || "Firefox non ha risposto. Riprova tra un momento.");
    return response.data;
  }

  function showFeedback(message, kind = "success") {
    const element = $("feedback");
    element.textContent = message;
    element.className = `notice${kind === "error" ? " notice-error" : kind === "warning" ? " notice-warning" : ""}`;
    element.hidden = false;
    element.setAttribute("role", kind === "error" ? "alert" : "status");
  }

  function safeDate(timestamp) {
    return timestamp && Number.isFinite(Number(timestamp)) ? date.format(new Date(Number(timestamp))) : "—";
  }

  function setMode(label, active = false) {
    const badge = $("mode-badge");
    badge.replaceChildren();
    const dot = document.createElement("span");
    dot.className = "status-dot";
    badge.append(dot, document.createTextNode(label));
    badge.classList.toggle("is-active", active);
  }

  function syncSchedule() {
    const enabled = $("auto-enabled").checked;
    $("interval-value").disabled = !enabled || busy;
    $("interval-unit").disabled = !enabled || busy;
    $("auto-help").textContent = enabled ? "La pulizia seguirà l’intervallo che scegli qui sotto." : "Attivala per lasciare fare a Macinacookie.";
    $("interval-value").max = String(2880 / Number($("interval-unit").value));
  }

  function applySettings(settings) {
    $("max-age").value = String(settings.maxAgeDays);
    $("max-age-range").value = String(settings.maxAgeDays);
    $("auto-enabled").checked = settings.autoEnabled;
    const unit = settings.intervalHours % 24 === 0 ? 24 : 1;
    $("interval-unit").value = String(unit);
    $("interval-value").value = String(settings.intervalHours / unit);
    $("excluded-domains").value = settings.excludedDomains.join("\n");
    dirty = false;
    $("dirty-badge").hidden = true;
    syncSchedule();
  }

  function renderStatus(data, fillForm = false) {
    status = data;
    $("stats").setAttribute("aria-busy", "false");
    $("stat-total").textContent = data.stats ? number.format(data.stats.total) : "—";
    $("stat-eligible").textContent = data.stats ? number.format(data.stats.eligible) : "—";
    $("stat-protected").textContent = data.stats ? number.format(data.stats.protected) : "—";
    $("stat-sites").textContent = data.stats
      ? `${number.format(data.stats.sites)} ${data.stats.sites === 1 ? "sito osservato" : "siti osservati"}`
      : "Lettura momentaneamente non disponibile";
    $("stat-age").textContent = `Età osservata di almeno ${data.settings.maxAgeDays} ${data.settings.maxAgeDays === 1 ? "giorno" : "giorni"}`;
    $("tracking-since").textContent = data.trackingSince ? `Osservazione iniziata il ${safeDate(data.trackingSince)}.` : "";
    $("permission-notice").hidden = data.hasPermissions;
    $("status-warning").hidden = !data.warning;
    $("status-warning").textContent = data.warning ? `Attenzione: ${data.warning}` : "";
    if (!data.hasPermissions) setMode("Accesso da consentire");
    else if (data.scanAvailable === false) setMode("Lettura non disponibile");
    else setMode(data.settings.autoEnabled ? "Pulizia automatica attiva" : "Modalità manuale", data.settings.autoEnabled);
    const isAndroid = data.platform === "android";
    $("schedule-help").textContent = isAndroid
      ? "Da 1 ora a 120 giorni. Android può sospendere Firefox: la pulizia può quindi avvenire in ritardo, quando riapri il browser."
      : "Da 1 ora a 120 giorni. Funziona mentre Firefox è aperto; recupera le scadenze alla riapertura.";
    $("saved-rule-description").textContent = data.settings.autoEnabled
      ? `${isAndroid ? "Prossima scadenza" : "Prossima pulizia"}: ${data.nextRunAt ? safeDate(data.nextRunAt) : "in programmazione"}. ${isAndroid ? "Se Firefox è sospeso, la pulizia riprende quando lo riapri." : "Firefox deve essere aperto."}`
      : "Pulizia automatica disattivata. Decidi tu quando intervenire.";
    const run = data.lastRun;
    $("last-run").textContent = run
      ? `Ultima pulizia ${run.mode === "auto" ? "automatica" : "manuale"}${run.error ? " interrotta" : ""}: ${safeDate(run.at)} · ${number.format(run.deleted)} cancellati${run.skipped ? ` · ${number.format(run.skipped)} saltati` : ""}${run.failed ? ` · ${number.format(run.failed)} non riusciti` : ""}.${run.error ? ` ${run.error}` : ""}`
      : "Nessuna pulizia ancora registrata.";
    if (fillForm) applySettings(data.settings);
    updateControls();
  }

  function previewExpired() {
    return !!preview && Date.now() >= Number(preview.expiresAt);
  }

  function updateControls() {
    const ready = !!status && !busy;
    $("max-age").disabled = !ready;
    $("max-age-range").disabled = !ready;
    $("auto-enabled").disabled = !ready;
    $("excluded-domains").disabled = !ready;
    $("save-settings").disabled = !ready || !dirty;
    $("reset-settings").disabled = !ready || !dirty;
    $("preview-button").disabled = !ready || !status?.hasPermissions || status?.scanAvailable === false || dirty;
    $("preview-button").title = dirty ? "Salva o annulla le modifiche alle regole prima di creare il riepilogo." : "";
    $("grant-permissions").disabled = busy;
    $("delete-button").disabled = !ready || !status?.hasPermissions || status?.scanAvailable === false || dirty || !preview || previewExpired() || selected.size === 0;
    $("cookie-search").disabled = busy;
    $("clear-selection").disabled = busy || selected.size === 0;
    $("select-visible").disabled = busy || !preview || previewExpired();
    for (const box of $("cookie-rows").querySelectorAll("input")) box.disabled = busy || previewExpired();
    if (status) syncSchedule();
    else {
      $("interval-value").disabled = true;
      $("interval-unit").disabled = true;
    }
  }

  function setBusy(value) {
    busy = value;
    $("settings-form").setAttribute("aria-busy", String(value));
    updateControls();
  }

  function markDirty() {
    dirty = true;
    $("dirty-badge").hidden = false;
    updateControls();
  }

  function resetPreview() {
    preview = null;
    selected = new Set();
    $("cookie-rows").replaceChildren();
    $("cookie-search").value = "";
    $("preview-intro").hidden = false;
    $("preview-empty").hidden = true;
    $("preview-results").hidden = true;
    $("preview-loading").hidden = true;
    $("preview-button").replaceChildren(document.createTextNode("Crea riepilogo ↗"));
    updateControls();
  }

  function matchingRows() {
    const query = $("cookie-search").value.trim().toLocaleLowerCase("it-IT");
    return (preview?.rows || []).filter((row) => !query || `${row.domain} ${row.name} ${row.path} ${row.partitionSite || ""}`.toLocaleLowerCase("it-IT").includes(query));
  }

  function updateSelection() {
    const visible = matchingRows();
    const count = visible.filter((row) => selected.has(row.id)).length;
    $("select-visible").checked = visible.length > 0 && count === visible.length;
    $("select-visible").indeterminate = count > 0 && count < visible.length;
    const hiddenSelected = selected.size - count;
    $("selected-count").textContent = `${number.format(selected.size)} ${selected.size === 1 ? "cookie selezionato" : "cookie selezionati"}${hiddenSelected > 0 ? ` · ${number.format(hiddenSelected)} fuori ricerca` : ""}`;
    $("visible-count").textContent = `${number.format(visible.length)} di ${number.format(preview?.rows.length || 0)}`;
    $("delete-button").textContent = selected.size ? `Macina ${number.format(selected.size)} cookie →` : "Macina selezionati →";
    updateControls();
  }

  function appendText(parent, tag, className, value) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = value;
    parent.append(element);
    return element;
  }

  function renderRows() {
    const rows = matchingRows();
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const tr = document.createElement("tr");
      const selectCell = document.createElement("td");
      selectCell.className = "checkbox-cell";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(row.id);
      checkbox.setAttribute("aria-label", `Seleziona ${row.name || "cookie senza nome"} di ${row.domain}, percorso ${row.path}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(row.id);
        else selected.delete(row.id);
        updateSelection();
      });
      const checkboxTarget = document.createElement("label");
      checkboxTarget.className = "checkbox-target";
      checkboxTarget.append(checkbox);
      selectCell.append(checkboxTarget);
      tr.append(selectCell);
      const cookieCell = document.createElement("td");
      appendText(cookieCell, "span", "cookie-domain", row.domain);
      appendText(cookieCell, "span", "cookie-name", row.name || "(senza nome)");
      appendText(cookieCell, "span", "cookie-path", `Percorso: ${row.path}`);
      tr.append(cookieCell);
      const ageCell = document.createElement("td");
      ageCell.className = "age-cell";
      const days = Math.floor(row.ageDays);
      appendText(ageCell, "span", "", `${number.format(days)} ${days === 1 ? "giorno" : "giorni"}`);
      appendText(ageCell, "small", "", `Dal ${safeDate(row.firstSeenAt)}`);
      tr.append(ageCell);
      const durationCell = document.createElement("td");
      appendText(durationCell, "span", "table-tag", row.session ? "Di sessione" : "Persistente");
      tr.append(durationCell);
      const contextCell = document.createElement("td");
      const context = [];
      if (row.storeId && row.storeId !== "firefox-default") context.push(row.storeId);
      if (row.partitionSite) context.push(`Partizione: ${row.partitionSite}`);
      if (row.firstPartyDomain) context.push(`Sito principale: ${row.firstPartyDomain}`);
      if (row.secure) context.push("Solo HTTPS");
      appendText(contextCell, "span", "context-text", context.join(" · ") || "Standard");
      tr.append(contextCell);
      fragment.append(tr);
    }
    $("cookie-rows").replaceChildren(fragment);
    $("no-search-results").hidden = rows.length !== 0;
    updateSelection();
  }

  function renderPreview(data) {
    preview = data;
    selected = new Set(data.rows.map((row) => row.id));
    $("preview-intro").hidden = true;
    $("preview-loading").hidden = true;
    $("preview-empty").hidden = data.rows.length > 0;
    $("preview-results").hidden = data.rows.length === 0;
    $("cookie-search").value = "";
    $("preview-button").textContent = "Aggiorna riepilogo ↻";
    if (!data.rows.length) {
      $("preview-empty-text").textContent = `Nessun cookie non protetto ha raggiunto ${data.maxAgeDays} ${data.maxAgeDays === 1 ? "giorno" : "giorni"} di osservazione. I cookie già presenti all’installazione vengono osservati a partire da quel momento.`;
      updateControls();
      return;
    }
    $("preview-total").textContent = number.format(data.rows.length);
    $("preview-sites").textContent = number.format(new Set(data.rows.map((row) => row.domain.replace(/^\./, ""))).size);
    const oldest = Math.floor(data.rows.reduce((oldestAge, row) => Math.max(oldestAge, row.ageDays), 0));
    $("preview-oldest").textContent = `${number.format(oldest)} ${oldest === 1 ? "giorno" : "giorni"}`;
    checkExpiry();
    renderRows();
  }

  function checkExpiry() {
    if (!preview) return;
    const expired = previewExpired();
    $("preview-expired").hidden = !expired;
    $("preview-validity").textContent = expired ? "Riepilogo scaduto: aggiorna per continuare." : `Riepilogo valido fino al ${safeDate(preview.expiresAt)}. I valori dei cookie non vengono mostrati.`;
    if (expired && $("confirm-dialog").open && !deleting) $("confirm-dialog").close();
    updateControls();
  }

  async function refreshStatus(fillForm = false) {
    const data = await request("GET_STATUS");
    renderStatus(data, fillForm);
    return data;
  }

  $("max-age").addEventListener("input", () => {
    if ($("max-age").validity.valid) $("max-age-range").value = $("max-age").value;
    markDirty();
  });
  $("max-age-range").addEventListener("input", () => {
    $("max-age").value = $("max-age-range").value;
    markDirty();
  });
  $("auto-enabled").addEventListener("change", markDirty);
  $("interval-value").addEventListener("input", markDirty);
  $("interval-unit").addEventListener("change", () => {
    const max = 2880 / Number($("interval-unit").value);
    if (Number($("interval-value").value) > max) $("interval-value").value = String(max);
    markDirty();
  });
  $("excluded-domains").addEventListener("input", markDirty);
  $("reset-settings").addEventListener("click", () => {
    if (status) applySettings(status.settings);
    updateControls();
  });

  $("settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !status || !$("settings-form").reportValidity()) return;
    const typedInterval = Number($("interval-value").value) * Number($("interval-unit").value);
    const intervalHours = !$("auto-enabled").checked && (!Number.isInteger(typedInterval) || typedInterval < 1 || typedInterval > 2880)
      ? status.settings.intervalHours : typedInterval;
    const settings = {
      maxAgeDays: Number($("max-age").value),
      autoEnabled: $("auto-enabled").checked,
      intervalHours,
      excludedDomains: $("excluded-domains").value.split(/[\n,;]+/).map((value) => value.trim().toLowerCase()).filter(Boolean)
    };
    if (!Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 2880) {
      showFeedback("Scegli un intervallo compreso tra 1 ora e 120 giorni.", "error");
      return;
    }
    setBusy(true);
    try {
      const data = await request("SAVE_SETTINGS", { settings });
      renderStatus(data, true);
      resetPreview();
      showFeedback("Regole salvate. Il prossimo riepilogo userà queste preferenze.");
    } catch (error) {
      showFeedback(error.message || "Non è stato possibile salvare le regole.", "error");
    } finally {
      setBusy(false);
    }
  });

  $("preview-button").addEventListener("click", async () => {
    if (busy || dirty || !status?.hasPermissions || status?.scanAvailable === false) return;
    setBusy(true);
    $("feedback").hidden = true;
    $("preview-intro").hidden = true;
    $("preview-empty").hidden = true;
    $("preview-results").hidden = true;
    $("preview-loading").hidden = false;
    try {
      renderPreview(await request("PREVIEW"));
      try { await refreshStatus(); } catch (error) { showFeedback(`Riepilogo pronto. Statistiche non aggiornate: ${error.message}`, "warning"); }
    } catch (error) {
      resetPreview();
      showFeedback(error.message || "Non è stato possibile creare il riepilogo.", "error");
    } finally {
      $("preview-loading").hidden = true;
      setBusy(false);
    }
  });

  $("cookie-search").addEventListener("input", renderRows);
  $("select-visible").addEventListener("change", () => {
    for (const row of matchingRows()) {
      if ($("select-visible").checked) selected.add(row.id);
      else selected.delete(row.id);
    }
    renderRows();
  });
  $("clear-selection").addEventListener("click", () => {
    selected.clear();
    renderRows();
  });

  $("delete-button").addEventListener("click", () => {
    if (busy || dirty || !status?.hasPermissions || status?.scanAvailable === false || !preview || previewExpired() || !selected.size) return;
    confirmIds = [...selected];
    const rows = preview.rows.filter((row) => selected.has(row.id));
    const domains = [...new Set(rows.map((row) => row.domain.replace(/^\./, "")))].sort();
    $("confirm-description").textContent = `Stai per cancellare ${number.format(rows.length)} cookie su ${number.format(domains.length)} ${domains.length === 1 ? "sito" : "siti"}. Verranno considerati soltanto i cookie selezionati in questo riepilogo.`;
    $("confirm-domains").replaceChildren();
    for (const domain of domains.slice(0, 20)) appendText($("confirm-domains"), "span", "domain-chip", domain);
    if (domains.length > 20) appendText($("confirm-domains"), "span", "domain-chip", `e altri ${number.format(domains.length - 20)} siti`);
    $("confirm-delete").textContent = `Cancella ${number.format(rows.length)} cookie`;
    $("confirm-delete").disabled = false;
    $("cancel-delete").disabled = false;
    $("confirm-dialog").showModal();
    $("cancel-delete").focus();
  });

  $("cancel-delete").addEventListener("click", () => $("confirm-dialog").close());
  $("confirm-dialog").addEventListener("cancel", (event) => { if (deleting) event.preventDefault(); });
  $("confirm-delete").addEventListener("click", async () => {
    if (busy || deleting || !status?.hasPermissions || status?.scanAvailable === false || !preview || previewExpired() || !confirmIds.length) return;
    deleting = true;
    setBusy(true);
    $("confirm-delete").disabled = true;
    $("cancel-delete").disabled = true;
    $("confirm-delete").textContent = "Pulizia in corso…";
    try {
      const result = await request("DELETE_PREVIEW", { token: preview.token, ids: confirmIds });
      $("confirm-dialog").close();
      resetPreview();
      let message = `Pulizia completata: ${number.format(result.deleted)} cookie cancellati.`;
      if (result.skipped) message += ` ${number.format(result.skipped)} saltati perché cambiati o non più eliminabili.`;
      if (result.failed) message += ` ${number.format(result.failed)} non sono stati cancellati. Crea un nuovo riepilogo per riprovare.`;
      showFeedback(message, result.failed ? "warning" : "success");
      try { await refreshStatus(); } catch (error) { showFeedback(`${message} Statistiche non aggiornate: ${error.message}`, "warning"); }
    } catch (error) {
      $("confirm-dialog").close();
      resetPreview();
      showFeedback(error.message || "Non è stato possibile completare la pulizia. Crea un nuovo riepilogo per verificare i cookie rimasti.", "error");
    } finally {
      deleting = false;
      confirmIds = [];
      setBusy(false);
      $("preview-button").focus();
    }
  });

  $("grant-permissions").addEventListener("click", async () => {
    if (busy) return;
    try {
      const granted = await browser.permissions.request({ origins: ["http://*/*", "https://*/*"] });
      if (!granted) {
        showFeedback("Accesso non concesso. Puoi autorizzarlo quando vuoi dal pulsante qui sopra.", "warning");
        return;
      }
      setBusy(true);
      await refreshStatus(!status);
      showFeedback("Accesso consentito. Macinacookie può osservare i cookie.");
    } catch (error) {
      showFeedback(error.message || "Non è stato possibile ottenere l’accesso ai cookie.", "error");
    } finally { setBusy(false); }
  });

  setInterval(checkExpiry, 15000);
  document.addEventListener("visibilitychange", async () => {
    if (!document.hidden && !busy && status) {
      checkExpiry();
      try {
        const data = await request("GET_STATUS");
        if (!busy) renderStatus(data, !dirty);
      } catch (error) { showFeedback(error.message, "error"); }
    }
  });

  setBusy(true);
  refreshStatus(true).catch((error) => {
    setMode("Lettura non disponibile");
    $("stats").setAttribute("aria-busy", "false");
    $("stat-sites").textContent = "Ricarica la pagina per riprovare";
    $("saved-rule-description").textContent = "Impossibile caricare le preferenze. Ricarica la pagina per riprovare.";
    showFeedback(`${error.message || "Impossibile leggere i cookie."} Ricarica la pagina per riprovare.`, "error");
  }).finally(() => setBusy(false));
})();
