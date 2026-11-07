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
  const CONSENT_KEY = "macinacookieConsent";
  const CONSENT_VERSION = 1;
  const STATE_KEY = "macinacookieState";
  const PREVIEW_KEY = "macinacookiePreview";
  const ALARM_NAME = "macinacookie-cleanup";
  const ORIGINS = ["http://*/*", "https://*/*"];
  const PREVIEW_LIFETIME = 10 * 60 * 1000;

  function createApp(chrome, options = {}) {
    const now = options.now || (() => Date.now());
    const cryptoAPI = options.crypto || globalThis.crypto;
    const raw = chrome;
    let active = false;
    let autoAuthorized = false;
    let generation = 0;
    let operationEpoch = 0;
    let gateError = null;
    let gateRevision = 0;
    let revocationRevision = 0;
    let controls = Promise.resolve();
    let state = null;
    let queue = Promise.resolve();
    let lastError = null;
    let platform = null;
    // storage.session survives MV3 worker termination. A confirmation token
    // authorizes only the worker instance that actually created its preview.
    let livePreviewToken = null;
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
      const ticket = generation;
      const result = queue.then(() => {
        operationEpoch = ticket;
        return operation();
      });
      queue = result.catch(() => undefined);
      return result;
    }

    function backgroundTask(operation) {
      const result = enqueue(operation);
      result.catch(error => { lastError = explain(error); });
      return result;
    }

    function checkActive(ticket = operationEpoch) {
      if (!active || ticket !== generation) throw problem("Osservazione inattiva. Attivala dopo aver letto l’informativa.");
    }

    // Every sensitive API checks both before dispatch and after completion.
    // Already-dispatched Chrome API calls cannot be cancelled; their results
    // are discarded, and no subsequent read/write/removal may be dispatched.
    function guarded(owner, name) {
      return async (...args) => {
        const ticket = operationEpoch;
        checkActive(ticket);
        const result = await owner[name](...args);
        checkActive(ticket);
        return result;
      };
    }
    chrome = {...raw,
      storage: {...raw.storage,
        local: {...raw.storage.local, get: guarded(raw.storage.local, "get"), set: guarded(raw.storage.local, "set")},
        session: {...raw.storage.session, get: guarded(raw.storage.session, "get"), set: guarded(raw.storage.session, "set"), remove: guarded(raw.storage.session, "remove")}},
      cookies: {...raw.cookies, getAll: guarded(raw.cookies, "getAll"), get: guarded(raw.cookies, "get"), remove: guarded(raw.cookies, "remove")},
      permissions: {...raw.permissions, contains: guarded(raw.permissions, "contains")},
      runtime: {...raw.runtime, getPlatformInfo: guarded(raw.runtime, "getPlatformInfo")},
      alarms: {...raw.alarms, clear: guarded(raw.alarms, "clear"), create: guarded(raw.alarms, "create")}};

    function consentStatus() {
      return {active, version: CONSENT_VERSION, warning: gateError};
    }
    function inactiveStatus() {
      return {consent: consentStatus(), settings: {...Core.DEFAULT_SETTINGS, excludedDomains: []},
        stats: null, trackingSince: null, nextRunAt: null, lastRun: null,
        hasPermissions: false, platform: null, scanAvailable: false,
        warning: gateError || "Osservazione inattiva: nessun cookie viene letto."};
    }
    function control(operation) {
      const result = controls.then(operation);
      controls = result.catch(() => undefined);
      return result;
    }
    function deactivate() {
      livePreviewToken = null;
      active = false;
      autoAuthorized = false;
      generation++;
      state = null;
      platform = null;
      epochs.clear();
    }
    async function changeConsent(accept, version) {
      if (accept && version !== CONSENT_VERSION) throw problem("Rileggi l’informativa corrente prima di attivare.");
      if (accept && active) return consentStatus();
      if (!accept) deactivate(); // Synchronous, before the operation/control queues.
      const ticket = generation;
      const revokeTicket = revocationRevision;
      function checkGrant() {
        if (ticket !== generation || revokeTicket !== revocationRevision) throw problem("Attivazione annullata dalla disattivazione. Serve una nuova scelta esplicita.");
      }
      return control(async () => {
        await gateReady;
        if (accept) {
          await queue; // Drain cancelled operations before a new activation.
          checkGrant();
        }
        try {
          if (accept) {
            await raw.storage.session.remove(PREVIEW_KEY);
            checkGrant();
            await raw.alarms.clear(ALARM_NAME);
            checkGrant();
          }
          await raw.storage.local.set({[CONSENT_KEY]: {version: CONSENT_VERSION, accepted: accept, autoAuthorized: false}});
          if (!accept) {
            const cleanup = await Promise.allSettled([raw.storage.session.remove(PREVIEW_KEY), raw.alarms.clear(ALARM_NAME)]);
            if (cleanup.some(result => result.status === "rejected")) throw Error("cleanup");
          }
          if (accept) {
            checkGrant();
            generation++;
            active = true;
            autoAuthorized = false;
            state = null;
            backgroundTask(initialize);
          }
          gateError = null;
          return consentStatus();
        } catch (_) {
          if (accept && ticket === generation) deactivate();
          gateError = accept ? "Attivazione non riuscita. L’osservazione resta inattiva; riprova." :
            "Osservazione fermata in questa sessione. Disattivazione non salvata o pulizia temporanea non riuscita: riprova prima di riavviare Chrome.";
          throw problem(gateError);
        }
      });
    }

    function privateStore(id) {
      // Incognito access is prohibited by the manifest. Unknown stores fail closed.
      return typeof id !== "string" || id !== "0";
    }

    async function hash(text) {
      checkActive();
      const bytes = new TextEncoder().encode(text);
      const digest = await guarded(cryptoAPI.subtle, "digest")("SHA-256", bytes);
      checkActive();
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    }

    function cookieHash(cookie) {
      checkActive();
      return hash(Core.fingerprintInput(cookie));
    }

    function randomToken() {
      checkActive();
      if (cryptoAPI.randomUUID) return cryptoAPI.randomUUID();
      return Array.from(cryptoAPI.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, "0")).join("");
    }

    async function persist(next) {
      try { await chrome.storage.local.set({[STATE_KEY]: next}); }
      catch (_) { throw problem("Impossibile salvare i dati locali. La pulizia è stata interrotta: nessun altro cookie verrà cancellato."); }
      checkActive();
      state = next;
    }

    async function sessionGet() {
      try { const result = await chrome.storage.session.get(PREVIEW_KEY); checkActive(); return result[PREVIEW_KEY]; }
      catch (_) { throw problem("Impossibile leggere il riepilogo. Riapri Macinacookie e riprova."); }
    }

    async function clearPreview() {
      livePreviewToken = null; // Fail closed even if session cleanup fails.
      try { await chrome.storage.session.remove(PREVIEW_KEY); }
      catch (_) { throw problem("Impossibile aggiornare il riepilogo. La cancellazione non è stata avviata."); }
    }

    async function hasPermissions() {
      try { return await chrome.permissions.contains({origins: ORIGINS}); }
      catch (_) { throw problem("Impossibile verificare l’accesso ai cookie. Controlla i permessi di Macinacookie."); }
    }

    async function requirePermissions() {
      checkActive();
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
      checkActive();
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
      checkActive();
      if (state) return;
      let stored;
      try { const result = await chrome.storage.local.get(STATE_KEY); checkActive(); stored = result[STATE_KEY]; }
      catch (_) { throw problem("Impossibile leggere i dati locali. La pulizia è sospesa."); }
      // Only an absent key is a first install; corrupt values must not reset
      // the ledger or silently discard protected domains.
      if (stored === undefined) {
        await persist({version: 1, settings: Core.normalizeSettings(Core.DEFAULT_SETTINGS), records: {}, trackingSince: now(), nextRunAt: null, lastRun: null});
        return;
      }
      try {
        if (stored.version !== 1 || !stored.records || typeof stored.records !== "object" || Array.isArray(stored.records) || !Number.isFinite(stored.trackingSince)) throw new Error();
        const settings = Core.normalizeSettings(stored.settings);
        if (!autoAuthorized) settings.autoEnabled = false;
        const records = {};
        for (const [key, record] of Object.entries(stored.records)) {
          checkActive();
          const identity = JSON.parse(key);
          if (!Array.isArray(identity) || identity.length !== 6 || !record || !Number.isFinite(record.firstSeenAt) || record.firstSeenAt < 0 || typeof record.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(record.fingerprint) || typeof record.id !== "string" || !/^[a-f0-9]{64}$/.test(record.id)) throw new Error();
          if (!privateStore(identity[0])) {
            // Row selection is keyed by ID: never trust a persisted ID that
            // could alias another cookie in the preview.
            if (record.id !== await hash(key)) throw new Error();
            records[key] = {id: record.id, firstSeenAt: record.firstSeenAt, fingerprint: record.fingerprint};
          }
        }
        checkActive();
        state = {version: 1, settings, records, trackingSince: stored.trackingSince, nextRunAt: Number.isFinite(stored.nextRunAt) ? stored.nextRunAt : null, lastRun: stored.lastRun || null};
      } catch (_) {
        throw problem("I dati di Macinacookie non sono leggibili. La pulizia è sospesa per proteggere i cookie.");
      }
    }

    async function scan() {
      checkActive();
      await requirePermissions();
      await getPlatform();
      // Chrome has no Firefox containers. Omitting storeId selects the current
      // regular store (incognito is forbidden); {} includes all CHIPS partitions.
      const results = await Promise.allSettled([
        chrome.cookies.getAll({partitionKey: {}})
      ]);
      checkActive();
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
          const [id, fingerprint] = await Promise.all([previous ? previous.id : hash(key), cookieHash(cookie)]);
          return {key, cookie, record: {id, fingerprint, firstSeenAt: firstSeen(key, previous, observedAt)}};
        }));
        checkActive();
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
      checkActive();
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
      checkActive();
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
      checkActive();
      return {
        consent: consentStatus(), settings: state.settings, stats: entries === null ? null : Core.summarize(entries, state.settings, now()),
        trackingSince: state.trackingSince, nextRunAt: state.nextRunAt, lastRun: state.lastRun,
        hasPermissions: permitted, platform, scanAvailable: entries !== null, warning: warning || lastError
      };
    }

    async function restoreAlarm() {
      await chrome.alarms.clear(ALARM_NAME);
      checkActive();
      if (autoAuthorized && state.settings.autoEnabled && state.nextRunAt !== null) {
        await chrome.alarms.create(ALARM_NAME, {when: Math.max(state.nextRunAt, now() + 1000)});
      }
    }

    async function saveSettings(input) {
      let settings;
      try { settings = Core.normalizeSettings(input); }
      catch (error) { throw problem(error.message); }
      await control(async () => {
        checkActive();
        await chrome.storage.local.set({[CONSENT_KEY]: {version: CONSENT_VERSION, accepted: true, autoAuthorized: settings.autoEnabled}});
        checkActive();
        autoAuthorized = settings.autoEnabled;
      });
      await clearPreview();
      checkActive();
      const changedSchedule = settings.autoEnabled !== state.settings.autoEnabled || settings.intervalHours !== state.settings.intervalHours;
      const nextRunAt = !settings.autoEnabled ? null : changedSchedule || state.nextRunAt === null ? now() + settings.intervalHours * Core.HOUR_MS : state.nextRunAt;
      await persist({...state, settings, nextRunAt});
      await restoreAlarm();
      return status();
    }

    async function makePreview() {
      const entries = await scan();
      checkActive();
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
      checkActive();
      livePreviewToken = preview.token;
      return {...preview, settingsSignature: undefined, rows: preview.rows.map(({key, fingerprint, ...row}) => row)};
    }

    async function removeCandidates(selected, entries, result = {deleted: 0, skipped: 0, failed: 0}) {
      checkActive();
      const current = new Map(entries.map(entry => [entry.key, entry]));
      for (const item of selected) {
        checkActive();
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
        catch (_) { checkActive(); result.failed++; continue; }
        checkActive();
        if (!actual || Core.cookieIdentity(actual) !== item.key || await cookieHash(actual) !== item.fingerprint) {
          result.skipped++;
          continue;
        }
        await requirePermissions();
        checkActive();
        if ((epochs.get(item.key)?.version || 0) !== before || !Core.eligibility({...record, firstSeenAt: firstSeen(item.key, record, now())}, actual, state.settings, now())) {
          result.skipped++;
          continue;
        }
        let removed;
        try { removed = await chrome.cookies.remove(details); }
        catch (_) { checkActive(); result.failed++; continue; }
        checkActive();
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
      if (typeof message.token !== "string" || message.token !== livePreviewToken) {
        throw problem("Il riepilogo è scaduto. Genera un nuovo riepilogo.");
      }
      await requirePermissions();
      const preview = await sessionGet();
      checkActive();
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
      checkActive();
      if (!autoAuthorized || !state.settings.autoEnabled || state.nextRunAt === null || state.nextRunAt > now()) {
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
        checkActive();
        const selected = candidates(entries, now()).map(entry => ({key: entry.key, ...entry.record}));
        await removeCandidates(selected, entries, result);
      } catch (error) {
        warning = explain(error);
        lastError = warning;
      }
      checkActive();
      // Schedule once per completed attempt; opening the popup never postpones it.
      const nextRunAt = now() + state.settings.intervalHours * Core.HOUR_MS;
      const lastRun = {at: now(), mode: "auto", ...result};
      if (warning) lastRun.error = warning;
      await persist({...state, nextRunAt, lastRun});
      await restoreAlarm();
    }

    async function runDueAutomatic() {
      checkActive();
      if (autoAuthorized && state.settings.autoEnabled && state.nextRunAt !== null && state.nextRunAt <= now()) {
        await runAutomatic();
      }
    }

    function noteChange(change) {
      if (!active) return; // Do not even inspect the event payload without opt-in.
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
        checkActive();
        if (epochs.get(key)?.version !== epoch.version) return;
        if (change.removed && change.cause === "overwrite") return;
        const records = {...state.records};
        if (change.removed) delete records[key];
        else {
          const previousRecord = records[key];
          const [id, fingerprint] = await Promise.all([previousRecord ? previousRecord.id : hash(key), cookieHash(cookie)]);
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
      if (message?.type === "GET_CONSENT") {
        // Control-plane status must remain available even if a scan is pending.
        return gateReady.then(() => ({ok: true, data: consentStatus()}));
      }
      if (message?.type === "GRANT_CONSENT" || message?.type === "REVOKE_CONSENT") {
        if (sender.url.split(/[?#]/, 1)[0] !== chrome.runtime.getURL("dashboard.html")) return Promise.resolve({ok: false, error: "Apri l’informativa nel pannello."});
        return changeConsent(message.type === "GRANT_CONSENT", message.version)
          .then(data => ({ok: true, data}), error => ({ok: false, error: explain(error)}));
      }
      return enqueue(async () => {
        try {
          await gateReady;
          if (message?.type === "GET_STATUS" && !active) return {ok: true, data: inactiveStatus()};
          checkActive();
          await load();
          checkActive();
          if (!message || typeof message.type !== "string") throw problem("Richiesta non valida.");
          let data;
          switch (message.type) {
            case "GET_STATUS": data = await status(); break;
            case "SAVE_SETTINGS": data = await saveSettings(message.settings); break;
            case "PREVIEW": data = await makePreview(); break;
            case "DELETE_PREVIEW": data = await deletePreview(message); break;
            default: throw problem("Operazione non riconosciuta.");
          }
          checkActive();
          return {ok: true, data};
        } catch (error) {
          lastError = explain(error);
          return {ok: false, error: lastError};
        }
      });
    }

    async function initialize() {
      await gateReady;
      if (!active) return;
      checkActive();
      await load();
      checkActive();
      if (state.settings.autoEnabled && state.nextRunAt === null) {
        await persist({...state, nextRunAt: now() + state.settings.intervalHours * Core.HOUR_MS});
      } else if (!state.settings.autoEnabled && state.nextRunAt !== null) {
        await persist({...state, nextRunAt: null});
      }
      await restoreAlarm();
      checkActive();
      if (state.settings.autoEnabled && state.nextRunAt <= now()) await runAutomatic();
      else if (await hasPermissions()) await scan();
    }

    function validProof(proof) {
      return Boolean(proof && typeof proof === "object" && !Array.isArray(proof) &&
        Object.keys(proof).sort().join(",") === "accepted,autoAuthorized,version" &&
        proof.version === CONSENT_VERSION && typeof proof.accepted === "boolean" &&
        typeof proof.autoAuthorized === "boolean" && (proof.accepted || !proof.autoAuthorized));
    }
    raw.storage.onChanged?.addListener((changes, area) => {
      if (area !== "local" || !Object.hasOwn(changes, CONSENT_KEY)) return;
      gateRevision++;
      const proof = changes[CONSENT_KEY].newValue;
      // Revocation is authoritative even while a grant is still inactive.
      // Positive events from our own accepted=true write are NOT revocations.
      if (!validProof(proof) || !proof.accepted) revocationRevision++;
      if (active && (!validProof(proof) || !proof.accepted)) {
        deactivate();
        // Cleanup only: never inspect or delete the durable ledger.
        Promise.allSettled([raw.storage.session.remove(PREVIEW_KEY), raw.alarms.clear(ALARM_NAME)]);
      } else if (active && !proof.autoAuthorized) {
        autoAuthorized = false;
      }
      // A storage event can revoke/constrain, never grant consent or auto-cleanup.
    });
    const initialRevision = gateRevision;
    const gateTicket = generation;
    const gateReady = (async () => {
      try {
        const proof = (await raw.storage.local.get(CONSENT_KEY))[CONSENT_KEY];
        if (generation !== gateTicket || gateRevision !== initialRevision) return;
        const valid = validProof(proof);
        active = Boolean(valid && proof.accepted);
        autoAuthorized = Boolean(active && proof.autoAuthorized);
      } catch (_) {
        gateError = "Impossibile leggere l’attivazione. Nessun cookie viene letto; riprova.";
      }
    })();

    // Chrome MV3 requires all event listeners to be registered synchronously.
    // Callback bridge supports Chrome versions before Promise message listeners.
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      request(message, sender).then(sendResponse, () => sendResponse({ok: false, error: "Operazione interrotta."}));
      return true;
    });
    chrome.cookies.onChanged.addListener(noteChange);
    chrome.alarms.onAlarm.addListener(alarm => {
      if (active && autoAuthorized && alarm.name === ALARM_NAME) backgroundTask(runAutomatic);
    });
    chrome.runtime.onStartup.addListener(() => backgroundTask(initialize));
    chrome.runtime.onInstalled.addListener(() => backgroundTask(initialize));
    chrome.permissions.onAdded.addListener(() => backgroundTask(initialize));
    chrome.permissions.onRemoved.addListener(() => { if (active) backgroundTask(async () => { await clearPreview(); }); });
    const ready = backgroundTask(initialize);
    return {ready, settled: () => queue, request};
  }

  return {createApp, STATE_KEY, PREVIEW_KEY, ALARM_NAME, CONSENT_KEY, CONSENT_VERSION};
});
