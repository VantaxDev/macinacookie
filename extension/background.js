/* Macinacookie — Chrome event background. No cookie values leave memory. */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory(require("./core.js"));
  else {
    const api = factory(root.MacinacookieCore);
    api.createApp(root.chrome);
  }
})(globalThis, function (Core) {
  "use strict";
  const STATE_KEY = "macinacookieState";
  const PREVIEW_KEY = "macinacookiePreview";
  const ALARM_NAME = "macinacookie-cleanup";
  const ORIGINS = ["http://*/*", "https://*/*"];
  const PREVIEW_LIFETIME = 10 * 60 * 1000;

  function createApp(chrome, options = {}) {
    const now = options.now || (() => Date.now());
    const cryptoAPI = options.crypto || globalThis.crypto;
    let state = null;
    let queue = Promise.resolve();
    let lastError = null;
    let platform = null;
    // Updated synchronously by the event listener, including while a scan or
    // deletion awaits Chrome. This protects removal/recreation with same value.
    const epochs = new Map();

    function problem(message) {
      const error = new Error(message);
      error.userFacing = true;
      return error;
    }

    function explain(error) {
      return error && error.userFacing ? error.message : "Operazione interrotta. Riprova dal riepilogo; nessun altro cookie verrà cancellato.";
    }

    function enqueue(operation) {
      const result = queue.then(operation);
      queue = result.catch(() => undefined);
      return result;
    }

    function backgroundTask(operation) {
      const result = enqueue(operation);
      result.catch(error => { lastError = explain(error); });
      return result;
    }

    function privateStore(id) {
      // Incognito access is prohibited by the manifest. Unknown stores fail closed.
      return typeof id !== "string" || id !== "0";
    }

    async function hash(text) {
      const bytes = new TextEncoder().encode(text);
      const digest = await cryptoAPI.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    }

    function randomToken() {
      if (cryptoAPI.randomUUID) return cryptoAPI.randomUUID();
      return Array.from(cryptoAPI.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, "0")).join("");
    }

    async function persist(next) {
      try { await chrome.storage.local.set({[STATE_KEY]: next}); }
      catch (_) { throw problem("Impossibile salvare i dati locali. La pulizia è stata interrotta: nessun altro cookie verrà cancellato."); }
      state = next;
    }

    async function sessionGet() {
      try { return (await chrome.storage.session.get(PREVIEW_KEY))[PREVIEW_KEY]; }
      catch (_) { throw problem("Impossibile leggere il riepilogo. Riapri Macinacookie e riprova."); }
    }

    async function clearPreview() {
      try { await chrome.storage.session.remove(PREVIEW_KEY); }
      catch (_) { throw problem("Impossibile aggiornare il riepilogo. La cancellazione non è stata avviata."); }
    }

    async function hasPermissions() {
      try { return await chrome.permissions.contains({origins: ORIGINS}); }
      catch (_) { throw problem("Impossibile verificare l’accesso ai cookie. Controlla i permessi di Macinacookie."); }
    }

    async function requirePermissions() {
      if (!await hasPermissions()) throw problem("Concedi l’accesso ai siti per leggere e cancellare i cookie.");
    }

    async function getPlatform() {
      if (platform !== null) return platform;
      let info;
      try {
        if (typeof chrome.runtime.getPlatformInfo !== "function") throw new Error();
        info = await chrome.runtime.getPlatformInfo();
      } catch (_) {
        throw problem("Impossibile riconoscere la versione di Chrome in uso. Riapri Macinacookie e riprova; la pulizia è sospesa.");
      }
      if (!info || !["win", "mac", "linux", "cros"].includes(info.os)) {
        throw problem("La piattaforma di Chrome non è riconosciuta. La pulizia è sospesa per evitare una lettura incompleta dei cookie.");
      }
      // This package targets Chrome desktop; unsupported platforms fail closed.
      platform = "desktop";
      return platform;
    }

    function firstSeen(key, previous, observedAt) {
      const epoch = epochs.get(key);
      const original = previous && Number.isFinite(previous.firstSeenAt) ? previous.firstSeenAt : epoch?.continuityAt ?? observedAt;
      return epoch && Number.isFinite(epoch.freshSince) ? Math.max(original, epoch.freshSince) : original;
    }

    async function load() {
      if (state) return;
      let stored;
      try { stored = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY]; }
      catch (_) { throw problem("Impossibile leggere i dati locali. La pulizia è sospesa."); }
      if (!stored) {
        await persist({version: 1, settings: Core.normalizeSettings(Core.DEFAULT_SETTINGS), records: {}, trackingSince: now(), nextRunAt: null, lastRun: null});
        return;
      }
      try {
        if (stored.version !== 1 || !stored.records || typeof stored.records !== "object" || Array.isArray(stored.records) || !Number.isFinite(stored.trackingSince)) throw new Error();
        const settings = Core.normalizeSettings(stored.settings);
        const records = {};
        for (const [key, record] of Object.entries(stored.records)) {
          const identity = JSON.parse(key);
          if (!Array.isArray(identity) || identity.length !== 6 || !record || !Number.isFinite(record.firstSeenAt) || record.firstSeenAt < 0 || !/^[a-f0-9]{64}$/.test(record.fingerprint) || !/^[a-f0-9]{64}$/.test(record.id)) throw new Error();
          if (!privateStore(identity[0])) records[key] = {id: record.id, firstSeenAt: record.firstSeenAt, fingerprint: record.fingerprint};
        }
        state = {version: 1, settings, records, trackingSince: stored.trackingSince, nextRunAt: Number.isFinite(stored.nextRunAt) ? stored.nextRunAt : null, lastRun: stored.lastRun || null};
      } catch (_) {
        throw problem("I dati di Macinacookie non sono leggibili. La pulizia è sospesa per proteggere i cookie.");
      }
    }

    async function scan() {
      await requirePermissions();
      await getPlatform();
      // Chrome has no Firefox containers. Omitting storeId selects the current
      // regular store (incognito is forbidden); {} includes all CHIPS partitions.
      const results = await Promise.allSettled([
        chrome.cookies.getAll({partitionKey: {}})
      ]);
      if (results.some(result => result.status !== "fulfilled" || !Array.isArray(result.value))) {
        throw problem("La lettura dei cookie è incompleta. I dati precedenti sono conservati e la pulizia è sospesa.");
      }
      const observedAt = now();
      const cookies = new Map();
      for (const result of results) {
        for (const cookie of result.value) {
          if (!privateStore(cookie.storeId)) cookies.set(Core.cookieIdentity(cookie), cookie);
        }
      }
      const entries = [];
      const pending = [...cookies.entries()];
      // Bound concurrent digest operations for large cookie stores.
      for (let index = 0; index < pending.length; index += 100) {
        const batch = await Promise.all(pending.slice(index, index + 100).map(async ([key, cookie]) => {
          const previous = state.records[key];
          const [id, fingerprint] = await Promise.all([previous ? previous.id : hash(key), hash(Core.fingerprintInput(cookie))]);
          return {key, cookie, record: {id, fingerprint, firstSeenAt: firstSeen(key, previous, observedAt)}};
        }));
        entries.push(...batch);
      }
      const records = {};
      for (const entry of entries) {
        entry.record.firstSeenAt = firstSeen(entry.key, entry.record, observedAt);
        records[entry.key] = entry.record;
      }
      // Never replace the durable ledger unless every store was read, and the
      // permission set still permits a complete view.
      await requirePermissions();
      await persist({...state, records});
      lastError = null;
      return entries;
    }

    function previewRow(entry, at) {
      const cookie = entry.cookie;
      return {
        id: entry.record.id, domain: cookie.domain, name: cookie.name, path: cookie.path,
        storeId: cookie.storeId, partitionSite: cookie.partitionKey?.topLevelSite || "",
        firstPartyDomain: cookie.firstPartyDomain || "", firstSeenAt: entry.record.firstSeenAt,
        ageDays: Math.max(0, (at - entry.record.firstSeenAt) / Core.DAY_MS),
        session: Boolean(cookie.session), secure: Boolean(cookie.secure)
      };
    }

    function candidates(entries, at) {
      return entries.filter(entry => Core.eligibility(entry.record, entry.cookie, state.settings, at));
    }

    async function status() {
      await load();
      let permitted = false;
      let entries = null;
      let warning = null;
      try {
        await getPlatform();
        permitted = await hasPermissions();
        if (permitted) {
          // Mobile OS suspension can delay an alarm without restarting the
          // background. Reconcile an overdue run when the user reopens the UI.
          await runDueAutomatic();
          entries = await scan();
        } else {
          warning = "Concedi l’accesso ai siti per leggere e cancellare i cookie.";
        }
      } catch (error) {
        warning = explain(error);
        lastError = warning;
      }
      return {
        settings: state.settings, stats: entries === null ? null : Core.summarize(entries, state.settings, now()),
        trackingSince: state.trackingSince, nextRunAt: state.nextRunAt, lastRun: state.lastRun,
        hasPermissions: permitted, platform, scanAvailable: entries !== null, warning: warning || lastError
      };
    }

    async function restoreAlarm() {
      await chrome.alarms.clear(ALARM_NAME);
      if (state.settings.autoEnabled && state.nextRunAt !== null) {
        await chrome.alarms.create(ALARM_NAME, {when: Math.max(state.nextRunAt, now() + 1000)});
      }
    }

    async function saveSettings(input) {
      let settings;
      try { settings = Core.normalizeSettings(input); }
      catch (error) { throw problem(error.message); }
      await clearPreview();
      const changedSchedule = settings.autoEnabled !== state.settings.autoEnabled || settings.intervalHours !== state.settings.intervalHours;
      const nextRunAt = !settings.autoEnabled ? null : changedSchedule || state.nextRunAt === null ? now() + settings.intervalHours * Core.HOUR_MS : state.nextRunAt;
      await persist({...state, settings, nextRunAt});
      await restoreAlarm();
      return status();
    }

    async function makePreview() {
      const entries = await scan();
      const createdAt = now();
      const selected = candidates(entries, createdAt);
      selected.sort((a, b) => a.cookie.domain.localeCompare(b.cookie.domain) || a.cookie.name.localeCompare(b.cookie.name) || a.cookie.path.localeCompare(b.cookie.path));
      const preview = {
        token: randomToken(), createdAt, expiresAt: createdAt + PREVIEW_LIFETIME,
        maxAgeDays: state.settings.maxAgeDays, settingsSignature: JSON.stringify(state.settings),
        total: selected.length, rows: selected.map(entry => ({...previewRow(entry, createdAt), key: entry.key, fingerprint: entry.record.fingerprint}))
      };
      try { await chrome.storage.session.set({[PREVIEW_KEY]: preview}); }
      catch (_) { throw problem("Impossibile salvare il riepilogo. Nessun cookie è stato cancellato."); }
      return {...preview, settingsSignature: undefined, rows: preview.rows.map(({key, fingerprint, ...row}) => row)};
    }

    async function removeCandidates(selected, entries, result = {deleted: 0, skipped: 0, failed: 0}) {
      const current = new Map(entries.map(entry => [entry.key, entry]));
      for (const item of selected) {
        const entry = current.get(item.key);
        const record = state.records[item.key];
        const effectiveRecord = record && {...record, firstSeenAt: firstSeen(item.key, record, now())};
        if (!entry || !record || record.fingerprint !== item.fingerprint || record.firstSeenAt !== item.firstSeenAt || !Core.eligibility(effectiveRecord, entry.cookie, state.settings, now())) {
          result.skipped++;
          continue;
        }
        const details = Core.removalDetails(entry.cookie);
        if (!details) { result.skipped++; continue; }
        const before = epochs.get(item.key)?.version || 0;
        let actual;
        try { actual = await chrome.cookies.get(details); }
        catch (_) { result.failed++; continue; }
        if (!actual || Core.cookieIdentity(actual) !== item.key || await hash(Core.fingerprintInput(actual)) !== item.fingerprint) {
          result.skipped++;
          continue;
        }
        await requirePermissions();
        if ((epochs.get(item.key)?.version || 0) !== before || !Core.eligibility({...record, firstSeenAt: firstSeen(item.key, record, now())}, actual, state.settings, now())) {
          result.skipped++;
          continue;
        }
        let removed;
        try { removed = await chrome.cookies.remove(details); }
        catch (_) { result.failed++; continue; }
        if (!removed) { result.skipped++; continue; }
        // A non-null response means a deletion already happened, even if a
        // following validation or persistence step must stop the batch.
        result.deleted++;
        if (!Core.removalResultMatches(removed, actual, details)) {
          throw problem("Chrome ha segnalato un cookie diverso da quello atteso. Pulizia interrotta; aggiorna il riepilogo.");
        }
        const records = {...state.records};
        delete records[item.key];
        // A failed checkpoint stops the loop before another cookie is removed.
        await persist({...state, records});
      }
      return result;
    }

    async function deletePreview(message) {
      await requirePermissions();
      const preview = await sessionGet();
      if (!preview || typeof message.token !== "string" || message.token !== preview.token || now() >= preview.expiresAt || JSON.stringify(state.settings) !== preview.settingsSignature) {
        throw problem("Il riepilogo è scaduto o le impostazioni sono cambiate. Genera un nuovo riepilogo.");
      }
      if (!Array.isArray(message.ids) || !message.ids.length || message.ids.some(id => typeof id !== "string")) throw problem("Seleziona almeno un cookie dal riepilogo.");
      const byId = new Map(preview.rows.map(row => [row.id, row]));
      const ids = [...new Set(message.ids)];
      if (ids.some(id => !byId.has(id))) throw problem("La selezione non appartiene al riepilogo. Aggiorna l’elenco e riprova.");
      const selected = ids.map(id => byId.get(id));
      const entries = await scan();
      // Consume the preview before side effects, so retries cannot replay it.
      await clearPreview();
      const result = {deleted: 0, skipped: 0, failed: 0};
      try {
        await removeCandidates(selected, entries, result);
        await persist({...state, lastRun: {at: now(), mode: "manual", ...result}});
      }
      catch (error) {
        let warning = explain(error);
        try {
          await persist({...state, lastRun: {at: now(), mode: "manual", ...result, error: warning}});
        } catch (saveError) {
          if (explain(saveError) !== warning) warning += " " + explain(saveError);
        }
        throw problem(warning + (result.deleted ? " Cookie già cancellati: " + result.deleted + "." : ""));
      }
      return result;
    }

    async function runAutomatic() {
      await load();
      if (!state.settings.autoEnabled || state.nextRunAt === null || state.nextRunAt > now()) {
        await restoreAlarm();
        return;
      }
      // A transient platform-detection failure leaves the overdue timestamp
      // intact, so a later wake can retry instead of silently losing the run.
      await getPlatform();
      let result = {deleted: 0, skipped: 0, failed: 0};
      let warning = null;
      try {
        const entries = await scan();
        const selected = candidates(entries, now()).map(entry => ({key: entry.key, ...entry.record}));
        await removeCandidates(selected, entries, result);
      } catch (error) {
        warning = explain(error);
        lastError = warning;
      }
      // Schedule once per completed attempt; opening the popup never postpones it.
      const nextRunAt = now() + state.settings.intervalHours * Core.HOUR_MS;
      const lastRun = {at: now(), mode: "auto", ...result};
      if (warning) lastRun.error = warning;
      await persist({...state, nextRunAt, lastRun});
      await restoreAlarm();
    }

    async function runDueAutomatic() {
      if (state.settings.autoEnabled && state.nextRunAt !== null && state.nextRunAt <= now()) {
        await runAutomatic();
      }
    }

    function noteChange(change) {
      const cookie = change.cookie;
      if (!cookie || privateStore(cookie.storeId)) return;
      const key = Core.cookieIdentity(cookie);
      const at = now();
      const previous = epochs.get(key);
      const epoch = {...previous, version: (previous?.version || 0) + 1};
      if (change.removed && change.cause !== "overwrite") {
        epoch.freshSince = at;
        epoch.deleted = true;
        epoch.continuityAt = null;
      } else if (change.removed && change.cause === "overwrite") {
        epoch.continuityAt = state?.records[key]?.firstSeenAt ?? previous?.continuityAt;
      } else if (!change.removed) {
        if (previous?.deleted || (state && !state.records[key] && !previous?.overwrite)) epoch.freshSince = at;
        epoch.deleted = false;
      }
      epoch.overwrite = change.removed && change.cause === "overwrite";
      epochs.set(key, epoch);
      backgroundTask(async () => {
        await load();
        if (epochs.get(key)?.version !== epoch.version) return;
        if (change.removed && change.cause === "overwrite") return;
        const records = {...state.records};
        if (change.removed) delete records[key];
        else {
          const previousRecord = records[key];
          const [id, fingerprint] = await Promise.all([previousRecord ? previousRecord.id : hash(key), hash(Core.fingerprintInput(cookie))]);
          if (epochs.get(key)?.version !== epoch.version) return;
          records[key] = {id, fingerprint, firstSeenAt: firstSeen(key, previousRecord, at)};
        }
        await persist({...state, records});
        // Cookie activity also wakes the event background after mobile sleep.
        // Run only after applying the change, and never in an overwrite gap.
        await runDueAutomatic();
      });
    }

    function trusted(sender) {
      if (!sender || sender.id !== chrome.runtime.id || sender.tab?.incognito) return false;
      const url = sender.url;
      return typeof url === "string" && ["dashboard.html", "popup.html"].some(page => url.split(/[?#]/, 1)[0] === chrome.runtime.getURL(page));
    }

    function request(message, sender) {
      if (!trusted(sender)) return Promise.resolve({ok: false, error: "Richiesta non autorizzata."});
      return enqueue(async () => {
        try {
          await load();
          if (!message || typeof message.type !== "string") throw problem("Richiesta non valida.");
          let data;
          switch (message.type) {
            case "GET_STATUS": data = await status(); break;
            case "SAVE_SETTINGS": data = await saveSettings(message.settings); break;
            case "PREVIEW": data = await makePreview(); break;
            case "DELETE_PREVIEW": data = await deletePreview(message); break;
            default: throw problem("Operazione non riconosciuta.");
          }
          return {ok: true, data};
        } catch (error) {
          lastError = explain(error);
          return {ok: false, error: lastError};
        }
      });
    }

    async function initialize() {
      await load();
      if (state.settings.autoEnabled && state.nextRunAt === null) {
        await persist({...state, nextRunAt: now() + state.settings.intervalHours * Core.HOUR_MS});
      } else if (!state.settings.autoEnabled && state.nextRunAt !== null) {
        await persist({...state, nextRunAt: null});
      }
      await restoreAlarm();
      if (state.settings.autoEnabled && state.nextRunAt <= now()) await runAutomatic();
      else if (await hasPermissions()) await scan();
    }

    // Chrome MV3 requires all event listeners to be registered synchronously.
    // Callback bridge supports Chrome versions before Promise message listeners.
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      request(message, sender).then(sendResponse, () => sendResponse({ok: false, error: "Operazione interrotta."}));
      return true;
    });
    chrome.cookies.onChanged.addListener(noteChange);
    chrome.alarms.onAlarm.addListener(alarm => {
      if (alarm.name === ALARM_NAME) backgroundTask(runAutomatic);
    });
    chrome.runtime.onStartup.addListener(() => backgroundTask(initialize));
    chrome.runtime.onInstalled.addListener(() => backgroundTask(initialize));
    chrome.permissions.onAdded.addListener(() => backgroundTask(initialize));
    chrome.permissions.onRemoved.addListener(() => backgroundTask(async () => { await clearPreview(); }));
    const ready = backgroundTask(initialize);
    return {ready, settled: () => queue, request};
  }

  return {createApp, STATE_KEY, PREVIEW_KEY, ALARM_NAME};
});
