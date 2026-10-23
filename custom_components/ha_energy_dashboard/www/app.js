// Energy Dashboard v2.1 — Home Assistant Integration
// Auth via localStorage tokens + WebSocket for history/statistics

class EnergyDashboard {
  constructor() {
    this.config = window.DASHBOARD_CONFIG || {};
    this.token = null;
    this.ws = null;
    this.wsId = 1;
    this.wsPending = {};
    this.chart = null;
    this.currentPeriod = 'today';
    this.currentTab = 'dashboard';
    this.currentChartUnit = 'kwh';
    this.chartConsumption = [];
    this.chartProduction = [];
    this.chartHeatpump = [];
    this.powerData = {};
    this.energyData = {};
    this._entityCache = null;
    this._entityCacheTime = 0;
    this._refreshTimers = [];
    this._lastVisible = Date.now();
    this._customRange = null;
    this.heatpumpData = {};
    this.init();
  }

  // ── Wärmepumpe Entitäten ────────────────────────────────────
  _wpEntities = {
    power:            'sensor.daikin_heizung_leistung',
    electricTotal:    'sensor.warmepumpe_elektrische_energie_gesamt',
    electricDaily:    'sensor.warmepumpe_elektrische_energie_taglich',
    electricMonthly:  'sensor.warmepumpe_elektrische_energie_monatlich',
    electricYearly:   'sensor.warmepumpe_elektrische_energie_jahrlich',
    heatingDaily:     'sensor.warmepumpe_elektrische_energie_heizen_taglich',
    heatingTotal:     'sensor.warmepumpe_elektrische_energie_heizen_gesamt',
    dhwDaily:         'sensor.warmepumpe_elektrische_energie_dhw_taglich',
    dhwTotal:         'sensor.warmepumpe_elektrische_energie_dhw_gesamt',
    thermalDaily:     'sensor.warmepumpe_thermische_energie_taglich',
    thermalTotal:     'sensor.warmepumpe_thermische_energie_gesamt',
    heaterDaily:      'sensor.wp_heizstab_energie_taglich',
    heaterTotal:      'sensor.wp_heizstab_energie_gesamt',
  };

  // ── Auth ──────────────────────────────────────────────────────

  async init() {
    await this.authenticate();
    if (!this.token) {
      console.error('Dashboard: No valid authentication. Set accessToken in config.js');
      return;
    }
    this.setupEventListeners();
    await this.connectWebSocket();
    await this.loadSettings();
    this.populateSettingsForm();
    await this.loadCurrentPower();
    await this.switchPeriod('today');
    this.startAutoRefresh();
  }

  async authenticate() {
    this._clientId = location.origin + '/';

    // 1. Config token (Long-Lived Access Token) — most reliable for panel_iframe
    if (this.config.accessToken) {
      this.token = this.config.accessToken;
      return;
    }

    // 1b. Anmeldung des HA-Frontends im
    // Elternfenster mitbenutzen (Panel-iframe, gleiche Herkunft). Funktioniert
    // auch in der Companion-App, deren externe Anmeldung kein hassTokens im
    // localStorage ablegt – dort scheiterte der OAuth-Weg an „invalid redirect uri“.
    const hass = this._parentHass();
    if (hass?.auth?.data?.access_token) {
      this._useParentAuth = true;
      if (hass.auth.expired) {
        try { await hass.auth.refreshAccessToken(); } catch (e) { /* ignore */ }
      }
      this.token = hass.auth.data.access_token;
      if (await this._testAuth()) return;
      this._useParentAuth = false;
      this.token = null;
    }

    // 2. Try localStorage tokens from HA frontend (desktop browser)
    const sources = ['hassTokens', 'dashboardTokens'];
    for (const key of sources) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const t = JSON.parse(raw);
          if (t.access_token && typeof t.access_token === 'string') {
            this.token = t.access_token;
            this._refreshToken = t.refresh_token;
            if (t.clientId) this._clientId = t.clientId;
            break;
          }
        }
      } catch (e) { /* ignore */ }
    }

    // 3. Check for OAuth callback (?code=...)
    if (!this.token) {
      const params = new URLSearchParams(location.search);
      const authCode = params.get('code');
      if (authCode) {
        await this._exchangeCode(authCode);
        history.replaceState(null, '', location.pathname);
      }
    }

    // 4. Verify token works
    if (this.token) {
      const valid = await this._testAuth();
      if (valid) return;
      // Token expired — try refresh
      if (this._refreshToken) {
        const refreshed = await this.refreshAccessToken();
        if (refreshed) return;
      }
      this.token = null;
    }

    // 5. No valid auth — try OAuth flow (works on desktop, may not work in companion app)
    this._startOAuthFlow();
  }

  // hass-Objekt des HA-Frontends (Elternfenster), sonst null
  _parentHass() {
    try {
      if (window.parent === window) return null;
      return window.parent.document.querySelector('home-assistant')?.hass || null;
    } catch (e) { return null; }
  }

  async _testAuth() {
    if (!this.token) return false;
    try {
      const res = await fetch('/api/', {
        headers: { 'Authorization': `Bearer ${this.token}` },
      });
      return res.ok;
    } catch (e) { return false; }
  }

  _startOAuthFlow() {
    const redirectUri = location.origin + location.pathname;
    const url = `/auth/authorize?client_id=${encodeURIComponent(this._clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    location.href = url;
  }

  async _exchangeCode(code) {
    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: this._clientId,
      });
      const res = await fetch('/auth/token', { method: 'POST', body });
      if (!res.ok) return;
      const data = await res.json();
      this.token = data.access_token;
      this._refreshToken = data.refresh_token;
      try {
        localStorage.setItem('dashboardTokens', JSON.stringify({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        }));
      } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
  }

  async refreshAccessToken() {
    // bei Frontend-Anmeldung erneuert HA (bzw. die App) das Token
    if (this._useParentAuth) {
      try {
        const hass = this._parentHass();
        await hass.auth.refreshAccessToken();
        this.token = hass.auth.data.access_token;
        return true;
      } catch (e) { return false; }
    }
    if (!this._refreshToken) return false;
    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this._clientId,
        refresh_token: this._refreshToken,
      });
      const res = await fetch('/auth/token', { method: 'POST', body });
      if (!res.ok) return false;
      const data = await res.json();
      this.token = data.access_token;
      if (data.refresh_token) this._refreshToken = data.refresh_token;
      try {
        localStorage.setItem('dashboardTokens', JSON.stringify({
          access_token: data.access_token,
          refresh_token: this._refreshToken,
        }));
      } catch (e) { /* ignore */ }
      return true;
    } catch (e) { return false; }
  }

  // ── REST API ──────────────────────────────────────────────────

  async fetchAPI(path, options = {}) {
    // immer das aktuelle Token des Frontends verwenden
    if (this._useParentAuth) {
      const t = this._parentHass()?.auth?.data?.access_token;
      if (t) this.token = t;
    }
    const headers = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    headers['Content-Type'] = 'application/json';

    const fetchOpts = { headers, ...options };
    let res = await fetch(path, fetchOpts);
    if (res.status === 401) {
      const ok = await this.refreshAccessToken();
      if (ok) {
        headers['Authorization'] = `Bearer ${this.token}`;
        res = await fetch(path, { ...fetchOpts, headers });
      }
      if (res.status === 401) {
        localStorage.removeItem('dashboardTokens');
        this._startOAuthFlow();
        throw new Error('Re-authenticating...');
      }
    }
    if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
    return res.json();
  }

  // Ein Eintrag darf mehrere Entitäten enthalten
  // ("sensor.a,sensor.b,-sensor.c"), die addiert bzw. mit "-" abgezogen werden –
  // z. B. Erzeugung = MPPT1 + MPPT2, Verbrauch = Erzeugung + Bezug + Entladung
  // − Einspeisung − Ladung.
  _splitIds(entityId) {
    return String(entityId || '').split(',').map(s => s.trim()).filter(Boolean);
  }

  _signedIds(entityId) {
    return this._splitIds(entityId).map(s => s.startsWith('-')
      ? { id: s.slice(1).trim(), sign: -1 } : { id: s, sign: 1 });
  }

  async getState(entityId) {
    const parts = this._signedIds(entityId);
    if (parts.length > 1 || parts[0]?.sign === -1) {
      const values = await Promise.all(parts.map(p => this.getState(p.id)));
      // getState liefert 0 bei unavailable – dann keine Teilsumme
      return values.every(v => v > 0)
        ? values.reduce((acc, v, i) => acc + parts[i].sign * v, 0) : 0;
    }
    try {
      const data = await this.fetchAPI(`/api/states/${entityId}`);
      return parseFloat(data.state) || 0;
    } catch (e) {
      console.warn(`State fetch failed: ${entityId}`, e.message);
      return 0;
    }
  }

  // Statistics ("change"/"sum") are unitless numbers — this dashboard always
  // treats them as kWh. If a sensor actually reports Wh/MWh (common on
  // instances we didn't set up ourselves), normalize so totals stay sane.
  async getUnitScale(entityId) {
    if (!entityId) return 1;
    entityId = this._signedIds(entityId)[0]?.id;  // mehrere Entitäten: gleiche Einheit angenommen
    if (!entityId) return 1;
    if (!this._unitScaleCache) this._unitScaleCache = {};
    if (this._unitScaleCache[entityId] !== undefined) return this._unitScaleCache[entityId];
    let scale = 1;
    try {
      const data = await this.fetchAPI(`/api/states/${entityId}`);
      const unit = (data.attributes?.unit_of_measurement || '').toLowerCase();
      if (unit === 'wh') scale = 0.001;
      else if (unit === 'mwh') scale = 1000;
    } catch (e) { /* unknown unit, assume kWh */ }
    this._unitScaleCache[entityId] = scale;
    return scale;
  }

  async getStates(entityIds) {
    const results = {};
    const promises = entityIds.filter(Boolean).map(async id => {
      results[id] = await this.getState(id);
    });
    await Promise.all(promises);
    return results;
  }

  // ── WebSocket ─────────────────────────────────────────────────

  connectWebSocket() {
    return new Promise((resolve) => {
      // Close stale socket first
      if (this.ws) {
        try { this.ws.onclose = null; this.ws.close(); } catch (_) {}
        this.ws = null;
      }
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };

      try {
        this.ws = new WebSocket(`${proto}//${location.host}/api/websocket`);
      } catch (e) {
        console.warn('WS create failed:', e.message);
        done();
        return;
      }

      this.ws.onopen = () => {};
      this.ws.onerror = () => { done(); };
      this.ws.onclose = () => {
        done();
        // Only auto-reconnect if page is visible
        if (document.visibilityState === 'visible') {
          setTimeout(() => this.connectWebSocket(), 5000);
        }
      };
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'auth_required') {
          if (!this.token) { console.error('WS: no token'); this.ws.close(); done(); return; }
          this.ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
        } else if (msg.type === 'auth_ok') {
          done();
        } else if (msg.type === 'auth_invalid') {
          console.error('WebSocket auth failed');
          done();
        } else if (msg.type === 'result' && this.wsPending[msg.id]) {
          const { resolve: res } = this.wsPending[msg.id];
          delete this.wsPending[msg.id];
          res(msg.success ? msg.result : null);
        }
      };
      setTimeout(done, 5000);
    });
  }

  wsCommand(cmd) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }
      const id = this.wsId++;
      cmd.id = id;
      this.wsPending[id] = { resolve, reject };
      this.ws.send(JSON.stringify(cmd));
      setTimeout(() => {
        if (this.wsPending[id]) {
          delete this.wsPending[id];
          resolve(null);
        }
      }, 15000);
    });
  }

  // ── Statistics API ────────────────────────────────────────────

  async getStatistics(entityId, startTime, endTime, period = 'hour') {
    const parts = this._signedIds(entityId);
    if (parts.length > 1 || parts[0]?.sign === -1) {
      // Zeilen mit gleichem Start vorzeichenrichtig addieren; nur Zeitpunkte,
      // die alle Entitäten haben
      const lists = await Promise.all(parts.map(p => this.getStatistics(p.id, startTime, endTime, period)));
      const add = (a, b, sign) => (a == null || b == null) ? null : a + sign * b;
      const keys = ['change', 'sum', 'mean', 'state'];
      const merged = new Map(lists[0].map(s => {
        const m = { start: s.start, end: s.end, _n: 1 };
        for (const k of keys) m[k] = s[k] == null ? null : parts[0].sign * s[k];
        return [s.start, m];
      }));
      lists.slice(1).forEach((list, i) => {
        const sign = parts[i + 1].sign;
        for (const s of list) {
          const m = merged.get(s.start);
          if (!m) continue;
          for (const k of keys) m[k] = add(m[k], s[k], sign);
          m._n++;
        }
      });
      return [...merged.values()].filter(s => s._n === parts.length);
    }
    try {
      const result = await this.wsCommand({
        type: 'recorder/statistics_during_period',
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        statistic_ids: [entityId],
        period: period,
        types: ['change', 'sum', 'mean', 'state'],
      });
      return (result && result[entityId]) ? result[entityId] : [];
    } catch (e) {
      console.warn('Statistics fetch failed:', e.message);
      return [];
    }
  }

  // ── Data Loading ──────────────────────────────────────────────

  async loadCurrentPower() {
    const p = this.config.entities?.power;
    if (!p) return;

    const ids = Object.values(p).filter(Boolean);
    const states = await this.getStates(ids);

    this.powerData = {
      consumption:       Math.abs(states[p.consumption] || 0),
      production:        Math.abs(states[p.production] || 0),
      grid_import:       Math.abs(states[p.grid_import] || 0),
      grid_export:       Math.abs(states[p.grid_export] || 0),
      battery_charge:    Math.abs(states[p.battery_charge] || 0),
      battery_discharge: Math.abs(states[p.battery_discharge] || 0),
    };

    if (this.config.entities?.battery_soc) {
      this.powerData.battery_soc = await this.getState(this.config.entities.battery_soc);
    }

    // Wärmepumpe Echtzeit-Leistung
    if (this.config.heatpumpEnabled ?? true) {
      try {
        this.powerData.heatpump = Math.abs(await this.getState(this._wpEntities.power) || 0);
      } catch (e) { this.powerData.heatpump = 0; }
    } else {
      this.powerData.heatpump = 0;
    }

    this.updateEnergyFlow();
  }

  // Period suffix mapping (fixed!)
  periodToSuffix(period) {
    const map = {
      yesterday: 'daily', today: 'daily',
      this_week: 'weekly', this_month: 'monthly', this_year: 'yearly',
    };
    return map[period] || null;
  }

  async loadPeriodData(period) {
    const energy = this.config.entities?.energy;
    const cost = this.config.entities?.cost;
    if (!energy) return;

    const suffix = this.periodToSuffix(period);

    // "yesterday" and all "last_*" periods: always use history
    // "this_*" periods: use aggregate sensors
    if (suffix && period !== 'yesterday') {
      // Current periods — use aggregate sensors directly
      const ids = [];
      const mapping = {};

      for (const [key, sensors] of Object.entries(energy)) {
        const id = sensors[suffix];
        if (id) { ids.push(id); mapping[id] = key; }
      }
      if (cost?.[suffix]) { ids.push(cost[suffix]); mapping[cost[suffix]] = '__cost'; }
      if (cost?.rate) { ids.push(cost.rate); mapping[cost.rate] = '__rate'; }
      if (cost?.compensation) { ids.push(cost.compensation); mapping[cost.compensation] = '__compensation'; }

      const states = await this.getStates(ids);
      this.energyData = {};
      for (const [id, value] of Object.entries(states)) {
        if (mapping[id]) this.energyData[mapping[id]] = value;
      }

      // ohne Aggregat-Sensor aus dem Gesamtzähler
      // rechnen (aktueller Stand minus Stand zu Periodenbeginn)
      const cum = this.config.entities?.cumulative || {};
      const { start } = this.getTimeBounds(period);
      await Promise.all(Object.entries(cum).map(async ([key, entityId]) => {
        if (!entityId || energy[key]?.[suffix] || key === 'consumption_detail') return;
        const delta = await this.counterDelta(entityId, start);
        if (delta != null) this.energyData[key] = delta;
      }));
    } else {
      // Past periods or yesterday — use statistics API
      await this.loadPeriodFromHistory(period);
    }

    // Wärmepumpe Energiedaten laden
    if (this.config.heatpumpEnabled ?? true) {
      await this.loadHeatpumpPeriodData(period);
    } else {
      this.heatpumpData = {};
    }

    this.calculateDerivedMetrics();

    // Dynamic rate calculation (if rateEntity is configured)
    if (this.config.rateEntity) {
      const { start, end } = this.getTimeBounds(period);
      const [rateMap, consumption15] = await Promise.all([
        this.loadDynamicRateHistory(start, end),
        this.loadConsumption15min(start, end),
      ]);
      if (rateMap && consumption15) {
        this.energyData.__dynamicCosts = this.calculateDynamicCosts(consumption15, rateMap);
      } else {
        this.energyData.__dynamicCosts = null;
      }
    } else {
      this.energyData.__dynamicCosts = null;
    }

    this.updateStatCards();
    this.updateFlowStats();
    this.updateKeyMetrics();
    // Gas/Wasser des vorigen Zeitraums verwerfen, bis neu geladen
    this._gasInv = undefined;
    this._waterInv = undefined;
    this.updateInvoiceTab();
    this.updateHeatpumpTab();
    this.updateGasTab();
    this.updateWaterTab();
  }

  // Energie aus Gesamtzählern als Differenz der
  // Zählerstände (Langzeitstatistik "state"), nicht als Summe der "change"-Werte –
  // die Statistik hat Sprünge (z. B. 14.09.2026: ganzer Zählerstand als change).

  // Zählerstand zum Zeitpunkt t = letzter Stand der Stunde vor t.
  // Fehlt sie (Statistik-Lücke oder Beginn nach t), erster Stand bis `limit`.
  async counterStateAt(entityId, t, limit) {
    const rows = await this.getStatistics(entityId, new Date(t.getTime() - 3600000), t, 'hour');
    const hit = rows.filter(s => s.state != null).pop();
    if (hit) return hit.state;
    if (!limit || limit <= t) return null;
    const days = await this.getStatistics(entityId, t, limit, 'day');
    const day = days.find(s => s.state != null);
    if (!day) return null;
    const dayStart = new Date(day.start);
    const hours = await this.getStatistics(entityId, dayStart, new Date(dayStart.getTime() + 86400000), 'hour');
    const first = hours.find(s => s.state != null);
    return first ? first.state : day.state;
  }

  // Einstellung „Statistik gültig ab“: Zählerstände davor werden ignoriert
  // (z. B. wenn die HA-Statistik anfangs stillstand und dann nachsprang).
  get _counterValidFrom() {
    const d = this.config.statsValidFrom ? new Date(this.config.statsValidFrom) : null;
    return d && !isNaN(d) ? d : new Date(0);
  }

  // Laufender Zeitraum: aktueller Zählerstand minus Stand bei `start`
  async counterDelta(entityId, start) {
    if (start < this._counterValidFrom) start = this._counterValidFrom;
    const now = new Date();
    const [base, live, scale] = await Promise.all([
      this.counterStateAt(entityId, start, now),
      this.getState(entityId),
      this.getUnitScale(entityId),
    ]);
    if (!(live > 0) || base == null) return null;  // getState liefert 0 bei unavailable
    return Math.max(0, live - base) * scale;
  }

  // Abgeschlossener Zeitraum: Stand bei `end` minus Stand bei `start`
  async counterRange(entityId, start, end) {
    if (start < this._counterValidFrom) start = this._counterValidFrom;
    if (end <= start) return null;
    const [base, scale] = await Promise.all([
      this.counterStateAt(entityId, start, end),
      this.getUnitScale(entityId),
    ]);
    if (base == null) return null;
    let last = await this.counterStateAt(entityId, end);
    if (last == null) {
      // Lücke am Ende: letzter vorhandener Tagesstand im Zeitraum
      const days = await this.getStatistics(entityId, start, end, 'day');
      const row = days.filter(s => s.state != null).pop();
      last = row ? row.state : null;
    }
    if (last == null) return null;
    return Math.max(0, last - base) * scale;
  }

  async loadPeriodFromHistory(period) {
    const { start, end } = this.getTimeBounds(period);
    const cum = this.config.entities?.cumulative;
    const energy = this.config.entities?.energy;
    const cost = this.config.entities?.cost;
    this.energyData = {};

    // Use cumulative sensors — sum up 'change' values per period
    const spanDays = (end - start) / 86400000;
    const statPeriod = spanDays > 180 ? 'month'
                     : spanDays > 7 ? 'day' : 'hour';
    if (cum) {
      // Differenz der Zählerstände statt Summe der
      // change-Werte (statPeriod wird dafür nicht mehr gebraucht)
      const promises = Object.entries(cum).map(async ([key, entityId]) => {
        if (!entityId || key === 'consumption_detail') return;  // nur fürs Diagramm
        const total = await this.counterRange(entityId, start, end);
        if (total > 0) {
          this.energyData[key] = total;
        }
      });
      await Promise.all(promises);
    }

    // Also try to get battery data from daily sensors history
    // (nur ohne Gesamtzähler – das Maximum des
    // Tageszählers ergibt bei Woche/Monat nur den stärksten Tag)
    if (!cum?.battery_charge && energy?.battery_charge?.daily) {
      const [stats, scale] = await Promise.all([
        this.getStatistics(energy.battery_charge.daily, start, end, 'hour'),
        this.getUnitScale(energy.battery_charge.daily),
      ]);
      if (stats.length > 0) {
        const maxVal = Math.max(...stats.map(s => s.state ?? s.mean ?? 0)) * scale;
        if (maxVal > 0) this.energyData.battery_charge = maxVal;
      }
    }
    if (!cum?.battery_discharge && energy?.battery_discharge?.daily) {
      const [stats, scale] = await Promise.all([
        this.getStatistics(energy.battery_discharge.daily, start, end, 'hour'),
        this.getUnitScale(energy.battery_discharge.daily),
      ]);
      if (stats.length > 0) {
        const maxVal = Math.max(...stats.map(s => s.state ?? s.mean ?? 0)) * scale;
        if (maxVal > 0) this.energyData.battery_discharge = maxVal;
      }
    }

    // Cost
    if (cost?.rate) {
      const rate = await this.getState(cost.rate);
      const compensation = cost.compensation ? await this.getState(cost.compensation) : 0;
      this.energyData.__rate = rate;
      this.energyData.__compensation = compensation;
      this.energyData.__cost = (this.energyData.grid_import || 0) * rate;
    }
  }

  async loadHeatpumpPeriodData(period) {
    const wp = this._wpEntities;

    // "Heute" — Daily-Sensoren direkt lesen (genau + schnell)
    if (period === 'today') {
      const ids = [
        wp.electricDaily, wp.heatingDaily, wp.dhwDaily,
        wp.thermalDaily, wp.heaterDaily,
      ];
      const states = await this.getStates(ids);
      this.heatpumpData = {
        electric:  states[wp.electricDaily] || 0,
        heating:   states[wp.heatingDaily] || 0,
        dhw:       states[wp.dhwDaily] || 0,
        thermal:   states[wp.thermalDaily] || 0,
        heater:    states[wp.heaterDaily] || 0,
      };
    } else {
      // Past periods — use statistics with cumulative sensor
      const { start, end } = this.getTimeBounds(period);
      const spanDays = (end - start) / 86400000;
      const statPeriod = spanDays > 180 ? 'month' : spanDays > 7 ? 'day' : 'hour';

      const [elecStats, thermalStats, heaterTotal, heatingStats, dhwStats, heatingScale, dhwScale] = await Promise.all([
        this.getStatistics(wp.electricTotal, start, end, statPeriod),
        this.getStatistics(wp.thermalTotal, start, end, statPeriod),
        this.counterRange(wp.heaterTotal, start, end),  // Differenz der Zählerstände statt change-Summe — robust gegen Statistik-Sprünge
        this.getStatistics(wp.heatingTotal, start, end, statPeriod),
        this.getStatistics(wp.dhwTotal, start, end, statPeriod),
        this.getUnitScale(wp.heatingTotal),
        this.getUnitScale(wp.dhwTotal),
      ]);

      const sum = (stats) => stats.reduce((acc, s) => acc + Math.max(0, s.change ?? 0), 0);
      this.heatpumpData = {
        electric: sum(elecStats),
        thermal:  sum(thermalStats),
        heater:   heaterTotal || 0,
        heating:  sum(heatingStats) * heatingScale,
        dhw:      sum(dhwStats) * dhwScale,
      };
    }

    // COP berechnen
    this.heatpumpData.cop = this.heatpumpData.electric > 0
      ? this.heatpumpData.thermal / this.heatpumpData.electric
      : 0;
  }

  calculateDerivedMetrics() {
    const d = this.energyData;
    const production = d.production || 0;
    const consumption = d.consumption || 0;
    const exported = d.grid_export || 0;
    const imported = d.grid_import || 0;

    // Eigenverbrauch = Verbrauch − Netzbezug
    // (PV direkt + Batterie). Original „Erzeugung − Einspeisung“ zählte die
    // Batterieladung und Wechselrichterverluste mit (größer als der Verbrauch).
    d.self_consumed = consumption > 0
      ? Math.max(0, consumption - imported)
      : Math.max(0, production - exported);
    d.self_sufficiency = consumption > 0
      ? Math.min(100, Math.max(0, ((consumption - imported) / consumption) * 100))
      : 0;

    if (!d.__cost && d.__rate) {
      d.__cost = imported * d.__rate;
    }
    d.savings = d.self_consumed * this.getRate(d);  // vorher nur Sensor (__rate)
  }

  // Preisquelle. Ein in den Einstellungen
  // eingetragener Sensor (Kosten-Sensoren → rate / compensation) hat Vorrang,
  // sofern er einen Wert liefert; sonst gelten die Tarife aus den Einstellungen.
  getRate(d = this.energyData) {
    if (this.config.entities?.cost?.rate && d?.__rate > 0) return d.__rate;
    return this.config.electricityRate || 0;
  }

  getCompensation(d = this.energyData) {
    if (this.config.entities?.cost?.compensation && d?.__compensation > 0) return d.__compensation;
    return this.config.feedInRate || 0;
  }

  // ── Chart (Chart.js + chartjs-plugin-zoom) ──────────────────

  // Reference line plugin
  referenceLinePlugin = {
    id: 'referenceLine',
    afterDraw: (chart, args, options) => {
      const val = options.value;
      if (!val || val <= 0) return;
      const yScale = chart.scales.y;
      if (!yScale) return;
      const yPixel = yScale.getPixelForValue(val);
      const { ctx, chartArea } = chart;
      ctx.save();
      ctx.setLineDash([8, 4]);
      ctx.strokeStyle = options.color ?? '#d29922';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(chartArea.left, yPixel);
      ctx.lineTo(chartArea.right, yPixel);
      ctx.stroke();
      ctx.setLineDash([]);
      const label = options.label ?? `Reference ${val} kW`;
      ctx.fillStyle = options.color ?? '#d29922';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, chartArea.right - 4, yPixel - 4);
      ctx.restore();
    },
  };

  async loadChartData(period) {
    const { start, end } = this.getTimeBounds(period);
    const chartPeriod = this.getChartAggregation(period);
    const cum = this.config.entities?.cumulative;
    if (!cum) return;

    const hpEnabled = this.config.heatpumpEnabled ?? true;
    // einen Zeitschritt früher laden – dessen
    // Zählerstand ist der Ausgangswert für die Differenz (statsToDeltaData)
    const fetchStart = new Date(start);
    if (chartPeriod === 'hour') fetchStart.setHours(fetchStart.getHours() - 1);
    else if (chartPeriod === 'day') fetchStart.setDate(fetchStart.getDate() - 1);
    else fetchStart.setMonth(fetchStart.getMonth() - 1);
    const [consData, productionStats, wpStats, prodScale] = await Promise.all([
      this.consumptionStats(fetchStart, end, chartPeriod),
      cum.production ? this.getStatistics(cum.production, fetchStart, end, chartPeriod) : [],
      hpEnabled ? this.getStatistics(this._wpEntities.electricTotal, start, end, chartPeriod) : [],
      this.getUnitScale(cum.production),
    ]);

    this.chartConsumption = this.statsToDeltaData(consData.rows, consData.scale, start);
    this.chartProduction = this.statsToDeltaData(productionStats, prodScale, start);
    this.chartHeatpump = this.statsToChartData(wpStats);

    // PV-Prognose für „Heute“ (Einstellung „PV-Prognose“)
    try {
      this.chartForecast = await this.loadForecast(period);
    } catch (e) {
      console.warn('Forecast load failed:', e.message);
      this.chartForecast = null;
    }


    // Clear cached kW data (lazy-loaded on toggle)
    this.chartConsumptionKw = null;
    this.chartProductionKw = null;
    this.currentChartUnit = 'kwh';

    document.querySelectorAll('.toggle-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.unit === 'kwh');
    });
    const resetBtn = document.getElementById('reset-zoom-btn');
    if (resetBtn) resetBtn.style.display = 'none';

    this.renderChart();
  }

  // ── Zoom-abhängige Auflösung ────
  // kWh-Ansicht, alle Zeiträume: Beim Hineinzoomen werden die Balken feiner –
  // Monat → Tag → Stunde → 30/15/10/5 min, je nach sichtbarem Zeitraum.
  // Unter einem Tag als kWh je Stunde (= mittlere kW), damit die Höhe beim
  // Zoomen vergleichbar bleibt und zur Prognose (15-min-kW) passt; Tagesbalken
  // in kWh je Tag. Energie als Differenz der Zählerstände (siehe statsToDeltaData).
  // Unter 1 h aus der 5-min-Statistik (HA hält sie 10 Tage), sonst aus der
  // Stunden- bzw. Tagesstatistik.
  _fineSteps = [
    [1.5 * 3600000, 5], [3 * 3600000, 10], [6 * 3600000, 15], [12 * 3600000, 30],
    [3 * 86400000, 60], [62 * 86400000, 1440],
  ];

  _baseMinutes() {
    return { hour: 60, day: 1440 }[this.getChartAggregation(this.currentPeriod)] ?? 43200;
  }

  // Beginn des Balkens, in dem t liegt (Tage und Stunden in Ortszeit)
  _bucketStart(t, minutes) {
    const d = new Date(t);
    if (minutes >= 1440) d.setHours(0, 0, 0, 0);
    else if (minutes >= 60) d.setMinutes(0, 0, 0);
    else d.setTime(Math.floor(t / (minutes * 60000)) * minutes * 60000);
    return d;
  }

  async loadFineStats(from, to, minutes) {
    const statPeriod = minutes < 60 ? '5minute' : minutes < 1440 ? 'hour' : 'day';
    if (statPeriod === '5minute' && Date.now() - from.getTime() > 10 * 86400000) return null;
    const fetchStart = new Date(from);  // ein Schritt früher: Ausgangswert für die Differenz
    if (statPeriod === 'day') fetchStart.setDate(fetchStart.getDate() - 1);
    else fetchStart.setTime(fetchStart.getTime() - (statPeriod === 'hour' ? 3600000 : 300000));
    const cum = this.config.entities?.cumulative || {};
    const [consData, prod, prodScale] = await Promise.all([
      this.consumptionStats(fetchStart, to, statPeriod),
      cum.production ? this.getStatistics(cum.production, fetchStart, to, statPeriod) : [],
      this.getUnitScale(cum.production),
    ]);
    const cons = consData.rows, consScale = consData.scale;
    if (!cons.length && !prod.length) return null;
    return { from, to, cons, prod, consScale, prodScale };
  }

  // Verbrauch für Balken von 1 h und kürzer aus
  // einem direkt messenden Zähler (Einstellung „Verbrauch fein“, z. B.
  // sensor.pv_load_summary). Die Formel AC-Energie + Bezug − Einspeisung stimmt
  // über Tage auf < 1 %, verschiebt aber Energie zwischen Stunden, weil
  // Wechselrichter- und Smart-Meter-Zähler zeitversetzt zählen (07.10.2026
  // 10–11 Uhr: −7 Wh statt ~0,6 kWh). Fehlen dem feinen Zähler Werte (Lücken),
  // gilt die Formel.
  async consumptionStats(start, end, statPeriod) {
    const cum = this.config.entities?.cumulative || {};
    const detail = cum.consumption_detail;
    if (detail && (statPeriod === 'hour' || statPeriod === '5minute')) {
      const [rows, scale] = await Promise.all([
        this.getStatistics(detail, start, end, statPeriod),
        this.getUnitScale(detail),
      ]);
      const stepMs = statPeriod === 'hour' ? 3600000 : 300000;
      const expected = Math.max(1, Math.floor((Math.min(end.getTime(), Date.now()) - start.getTime()) / stepMs));
      if (rows.filter(s => s.state != null).length >= expected * 0.9) return { rows, scale };
    }
    if (!cum.consumption) return { rows: [], scale: 1 };
    const [rows, scale] = await Promise.all([
      this.getStatistics(cum.consumption, start, end, statPeriod),
      this.getUnitScale(cum.consumption),
    ]);
    return { rows, scale };
  }

  fineSeries(stats, scale, minutes, from) {
    const ms = minutes * 60000;
    const buckets = new Map();
    let prev = null;
    for (const s of stats) {
      const t = new Date(s.start).getTime();
      // Differenz der Zählerstände, ungekappt: erst je Balken kappen –
      // zusammengesetzte Zähler (a + b − c) zählen zeitversetzt
      const delta = (s.state != null && prev != null) ? s.state - prev : null;
      if (s.state != null) prev = s.state;
      if (t < from.getTime() || delta == null) continue;
      const k = minutes >= 60 ? t : Math.floor(t / ms) * ms;  // Stunden-/Tageszeilen sind schon ein Balken
      buckets.set(k, (buckets.get(k) || 0) + delta * scale);
    }
    const factor = minutes < 1440 ? 60 / minutes : 1;  // kWh/h bzw. kWh/Tag
    return [...buckets.entries()].sort((a, b) => a[0] - b[0])
      .map(([x, kwh]) => ({ x: minutes >= 60 ? x : x + ms / 2, y: Math.max(0, kwh) * factor }));
  }

  async refineChartForZoom(chart) {
    if (!chart || chart !== this.chart || this.currentChartUnit !== 'kwh') return;
    const token = (this._fineToken = (this._fineToken || 0) + 1);
    const xMin = chart.scales.x.min, xMax = chart.scales.x.max, span = xMax - xMin;
    const base = this._baseMinutes();
    const step = this._fineSteps.find(([maxSpan]) => span <= maxSpan);
    let minutes = step && step[1] < base ? step[1] : null;
    if (minutes && chart._fine?.minutes === minutes
        && chart._fine.from.getTime() <= xMin && chart._fine.to.getTime() >= xMax) return;
    if (!minutes && !chart._fine) return;

    let fine = null;
    if (minutes) {
      // Sichtbaren Bereich plus eine Breite zu jeder Seite (glattes Verschieben),
      // begrenzt auf den Zeitraum
      const { start, end } = this.getTimeBounds(this.currentPeriod);
      const lo = Math.max(start.getTime(), xMin - span), hi = Math.min(end.getTime(), xMax + span);
      try {
        fine = await this.loadFineStats(this._bucketStart(lo, minutes), new Date(hi), minutes);
        if (!fine && minutes < 60 && base > 60) {  // ältere Tage: keine 5-min-Statistik mehr
          minutes = 60;
          fine = await this.loadFineStats(this._bucketStart(lo, 60), new Date(hi), 60);
        }
      } catch (e) { fine = null; }
      if (token !== this._fineToken || chart !== this.chart) return;  // inzwischen weitergezoomt
    }
    const useFine = !!(minutes && fine);
    // Diagramm neu aufbauen statt Datensätze auszutauschen: Chart.js zeichnete
    // beim Austausch Reste der Tagesbalken mit alter Breite weiter
    this._chartFine = useFine ? {
      minutes, from: fine.from, to: fine.to,
      unitShort: minutes >= 1440 ? this.t('kWh/Tag') : 'kWh/h',
      unit: minutes >= 1440 ? this.t('kWh/Tag') : `kWh/h, ${minutes >= 60 ? '1 h' : minutes + ' min'}`,
      cons: this.fineSeries(fine.cons, fine.consScale, minutes, fine.from),
      prod: this.fineSeries(fine.prod, fine.prodScale, minutes, fine.from),
    } : null;
    this.renderChart({ min: xMin, max: xMax });
    const resetBtn = document.getElementById('reset-zoom-btn');
    if (resetBtn) resetBtn.style.display = '';
  }

  // Energie je Zeitschritt als Differenz der
  // Zählerstände. "change" hat Sprünge, wenn HA die Summen neu aufsetzt
  // (z. B. Statistik-Import 07.10.2026 10:00: +46.864 kWh in 5 min).
  // Zeilen vor `from` dienen nur als Ausgangswert.
  statsToDeltaData(stats, scale = 1, from = null) {
    const fromMs = from ? from.getTime() : -Infinity;
    const out = [];
    let prev = null;
    for (const s of stats) {
      const x = new Date(s.start).getTime();
      const delta = (s.state != null && prev != null) ? s.state - prev : (s.change ?? 0);
      if (s.state != null) prev = s.state;
      if (x >= fromMs) out.push({ x, y: Math.max(0, delta) * scale });
    }
    return out;
  }

  statsToChartData(stats, scale = 1) {
    return stats.map(s => ({
      x: new Date(s.start).getTime(),
      y: Math.max(0, s.change ?? s.mean ?? 0) * scale,
    }));
  }

  async getHistory(entityId, startTime, endTime) {
    try {
      const start = startTime.toISOString();
      const end = endTime.toISOString();
      const data = await this.fetchAPI(
        `/api/history/period/${start}?filter_entity_id=${entityId}&end_time=${end}&minimal_response&no_attributes`
      );
      return (data && data[0]) ? data[0] : [];
    } catch (e) {
      console.warn('History fetch failed:', entityId, e.message);
      return [];
    }
  }

  // ── Dynamic Rate Calculation ─────────────────────────────────

  // Stichtag: ab hier gilt dynamischer Tarif
  _dynamicRateStart = new Date('2026-02-15T00:00:00+01:00');

  async loadDynamicRateHistory(start, end) {
    const rateEntity = this.config.rateEntity;
    if (!rateEntity) return null;
    // Zeitraum komplett vor Stichtag → kein dynamischer Tarif
    if (end <= this._dynamicRateStart) return null;

    const fetchStart = start < this._dynamicRateStart ? this._dynamicRateStart : start;
    const [history, rateScale] = await Promise.all([
      this.getHistory(rateEntity, fetchStart, end),
      this.priceScale(rateEntity),  // Sensor in ct/kWh → EUR/kWh
    ]);
    if (!history.length) return null;

    // State-Änderungen in sortierte Liste umwandeln
    const changes = [];
    for (const s of history) {
      const ts = s.lu ? s.lu * 1000 : new Date(s.last_changed || s.last_updated).getTime();
      const val = parseFloat(s.s ?? s.state);
      changes.push({ ts, rate: isNaN(val) ? null : val * rateScale });
    }
    changes.sort((a, b) => a.ts - b.ts);

    // Zukünftige Preise aus Entity-Attribut rates[] laden
    let futureRates = [];
    try {
      const entityData = await this.fetchAPI(`/api/states/${rateEntity}`);
      const rates = entityData?.attributes?.rates;
      if (Array.isArray(rates)) {
        futureRates = rates;
      }
    } catch (e) {
      console.warn('Failed to fetch future rates:', e.message);
    }

    // 15-Min-Raster aufbauen: für jedes 15-Min-Intervall den gültigen Preis
    const rateMap = new Map();
    const interval = 15 * 60 * 1000;
    const gridStart = Math.floor(fetchStart.getTime() / interval) * interval;

    // Grid bis Ende des Tages erweitern wenn Zukunfts-Preise verfügbar
    const endOfDay = new Date(start);
    endOfDay.setDate(endOfDay.getDate() + 1);
    endOfDay.setHours(0, 0, 0, 0);
    const gridEnd = futureRates.length > 0
      ? Math.max(Math.ceil(end.getTime() / interval) * interval, endOfDay.getTime())
      : Math.ceil(end.getTime() / interval) * interval;

    for (let t = gridStart; t < gridEnd; t += interval) {
      // Finde den letzten bekannten Preis vor/bei diesem Zeitpunkt
      let rate = null;
      for (let i = changes.length - 1; i >= 0; i--) {
        if (changes[i].ts <= t + interval) {
          rate = changes[i].rate;
          break;
        }
      }
      rateMap.set(t, rate);
    }

    // Zukünftige Preise aus rates[] ins Raster einfügen (überschreibt ggf.)
    for (const r of futureRates) {
      const ts = Math.floor(new Date(r.start).getTime() / interval) * interval;
      if (ts >= gridStart && ts < gridEnd) {
        rateMap.set(ts, r.value_inc_vat);
      }
    }

    return rateMap;
  }

  async loadConsumption15min(start, end) {
    const cum = this.config.entities?.cumulative;
    if (!cum?.grid_import) return null;

    const stats = await this.getStatistics(cum.grid_import, start, end, '5minute');
    if (!stats.length) return null;

    // 3 × 5-Min-Buckets zu 15-Min-Buckets summieren
    // Max 5 kWh pro 5-Min-Intervall als Ausreißer-Filter (≙ 60 kW Dauerlast)
    const MAX_PER_5MIN = 5;
    const interval = 15 * 60 * 1000;
    const buckets = new Map();
    for (const s of stats) {
      const change = Math.max(0, s.change ?? 0);
      if (change > MAX_PER_5MIN) continue;  // Sensor-Reset / Ausreißer
      const ts = new Date(s.start).getTime();
      const bucket = Math.floor(ts / interval) * interval;
      buckets.set(bucket, (buckets.get(bucket) || 0) + change);
    }
    return buckets;
  }

  calculateDynamicCosts(consumption15min, rateMap) {
    let totalCost = 0;
    let totalKwh = 0;
    let missingSlots = 0;
    const data = [];

    for (const [ts, kwh] of consumption15min) {
      const rate = rateMap.get(ts) ?? null;
      if (rate === null) {
        missingSlots++;
        data.push({ x: ts, consumption: kwh, rate: null, cost: null });
      } else {
        const cost = kwh * rate;
        totalCost += cost;
        totalKwh += kwh;
        data.push({ x: ts, consumption: kwh, rate, cost });
      }
    }

    // Auch Preis-Datenpunkte ohne Verbrauch für die Linie erfassen
    for (const [ts, rate] of rateMap) {
      if (!consumption15min.has(ts) && rate !== null) {
        data.push({ x: ts, consumption: 0, rate, cost: 0 });
      }
    }
    data.sort((a, b) => a.x - b.x);

    const avgRate = totalKwh > 0 ? totalCost / totalKwh : 0;
    return { totalCost, avgRate, totalKwh, missingSlots, data };
  }

  async loadPowerChartData() {
    const pwr = this.config.entities?.power;
    if (!pwr?.consumption || !pwr?.production) return;
    const { start, end } = this.getTimeBounds(this.currentPeriod);

    // Short periods: use History API (raw state data, fine-grained)
    // Long periods: use Statistics API (mean values, available long-term)
    const useHistory = ['today', 'yesterday', 'this_week', 'last_week'].includes(this.currentPeriod);

    this._kwDailyPeak = false;
    if (useHistory) {
      const [consHistory, prodHistory] = await Promise.all([
        this.getHistory(pwr.consumption, start, end),
        this.getHistory(pwr.production, start, end),
      ]);
      this.chartConsumptionKw = this.historyToChartData(consHistory, this.currentPeriod);
      this.chartProductionKw = this.historyToChartData(prodHistory, this.currentPeriod);
    } else {
      // Power sensors are template sensors without state_class, so no mean statistics.
      // Workaround: use cumulative kWh sensors and derive average kW from change values.
      // change_kWh per hour = average kW, change_kWh per day = average kW / 24
      // Stundenenergie (kWh je h = mittlere kW) als
      // Differenz der Zählerstände mit Wh→kWh – vorher "change" ohne Umrechnung
      // (Fronius-Zähler in Wh → 1000-fach) und mit den Sprüngen der Statistik.
      // Verbrauch über consumptionStats (direkt messender Zähler, sonst Formel).
      // Über 14 Tage je Tag die höchste Stundenleistung (Tagesspitze) statt des
      // Tagesmittels – passt zur Referenzlinie.
      const cum = this.config.entities?.cumulative;
      if (!cum?.consumption || !cum?.production) return;
      const days = (end - start) / 86400000;
      const fetchStart = new Date(start.getTime() - 3600000);  // Ausgangswert für die Differenz
      const [consData, prodStats, prodScale] = await Promise.all([
        this.consumptionStats(fetchStart, end, 'hour'),
        this.getStatistics(cum.production, fetchStart, end, 'hour'),
        this.getUnitScale(cum.production),
      ]);
      const consHourly = this.statsToDeltaData(consData.rows, consData.scale, start);
      const prodHourly = this.statsToDeltaData(prodStats, prodScale, start);
      this._kwDailyPeak = days > 14;
      this.chartConsumptionKw = this._kwDailyPeak ? this.dailyPeak(consHourly) : consHourly.filter(d => d.y > 0);
      this.chartProductionKw = this._kwDailyPeak ? this.dailyPeak(prodHourly) : prodHourly.filter(d => d.y > 0);
    }
  }

  // Höchster Wert je Kalendertag (Ortszeit), x = Tagesbeginn
  dailyPeak(points) {
    const days = new Map();
    for (const p of points) {
      const d = new Date(p.x);
      const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      if (!days.has(key) || p.y > days.get(key)) days.set(key, p.y);
    }
    return [...days.entries()].sort((a, b) => a[0] - b[0]).map(([x, y]) => ({ x, y }));
  }

  statsToKwChartData(stats, hoursPerBucket) {
    return stats
      .map(s => {
        const changeKwh = Math.max(0, s.change ?? 0);
        if (changeKwh <= 0) return null;
        let hours = hoursPerBucket;
        if (hoursPerBucket === 'month') {
          // Calculate actual hours in this month
          const d = new Date(s.start);
          const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
          hours = daysInMonth * 24;
        }
        return { x: new Date(s.start).getTime(), y: changeKwh / hours };
      })
      .filter(Boolean);
  }

  statsToDailyMaxKw(stats) {
    // Group hourly change values by day, take the maximum kW per day
    const days = new Map();
    for (const s of stats) {
      const changeKwh = Math.max(0, s.change ?? 0);
      if (changeKwh <= 0) continue;
      const kw = changeKwh; // 1 hour bucket: kWh/1h = kW
      const d = new Date(s.start);
      const dayKey = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      if (!days.has(dayKey) || kw > days.get(dayKey)) {
        days.set(dayKey, kw);
      }
    }
    const result = [];
    for (const [t, maxKw] of days) {
      result.push({ x: t, y: maxKw });
    }
    result.sort((a, b) => a.x - b.x);
    return result;
  }

  historyToChartData(history, period) {
    const raw = history
      .map(s => {
        const val = parseFloat(s.s ?? s.state);
        if (isNaN(val)) return null;
        return {
          x: new Date(s.lu ? s.lu * 1000 : s.last_updated || s.last_changed).getTime(),
          y: Math.max(0, val / 1000),
        };
      })
      .filter(Boolean);
    if (raw.length === 0) return [];

    // Bucket size depends on period — larger periods need larger buckets
    const bucketMinutes = {
      today: 5, yesterday: 5,
      this_week: 30, last_week: 30,
      this_month: 60, last_month: 60,
      this_year: 360, last_year: 360,
    };
    const bucketMs = (bucketMinutes[period] || 5) * 60 * 1000;
    const buckets = new Map();

    for (const pt of raw) {
      const key = Math.floor(pt.x / bucketMs) * bucketMs;
      if (!buckets.has(key)) {
        buckets.set(key, { sum: 0, count: 0 });
      }
      const b = buckets.get(key);
      b.sum += pt.y;
      b.count++;
    }

    const result = [];
    for (const [t, b] of buckets) {
      result.push({ x: t, y: b.sum / b.count });
    }
    result.sort((a, b) => a.x - b.x);
    return result;
  }

  downsample(data, threshold) {
    if (data.length <= threshold) return data;
    const step = (data.length - 2) / (threshold - 2);
    const result = [data[0]];
    for (let i = 1; i < threshold - 1; i++) {
      const start = Math.floor((i - 1) * step) + 1;
      const end = Math.min(Math.floor(i * step) + 1, data.length);
      let maxY = -Infinity, maxIdx = start;
      for (let j = start; j < end; j++) {
        if (data[j].y > maxY) { maxY = data[j].y; maxIdx = j; }
      }
      result.push(data[maxIdx]);
    }
    result.push(data[data.length - 1]);
    return result;
  }

  getChartAggregation(period) {
    if (['yesterday', 'today'].includes(period)) return 'hour';
    if (period === 'custom' && this._customRange) {
      const days = (this._customRange.end - this._customRange.start) / 86400000;
      if (days <= 2) return 'hour';
      if (days > 365) return 'month';
    }
    return 'day';
  }

  // ── PV-Prognose ──────────────────────────────────────────────
  // Einstellung „PV-Prognose“: Sensor mit Attribut „forecast“ (15-min-Werte mit
  // datetime, watts, p10, p90 ab heute 00:00), z. B. Helios Forecast.
  // Nur für den Zeitraum „Heute“.
  get _forecastEntity() {
    return this.config.entities?.forecast || '';
  }

  async loadForecast(period) {
    if (period !== 'today' || !this._forecastEntity) return null;
    const data = await this.fetchAPI(`/api/states/${this._forecastEntity}`);
    const list = data?.attributes?.forecast;
    if (!Array.isArray(list)) return null;

    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayEnd = dayStart + 86400000;
    const today = list
      .map(f => ({ t: new Date(f.datetime).getTime(), w: f.watts, p10: f.p10, p90: f.p90 }))
      .filter(f => f.t >= dayStart && f.t < dayEnd && f.w != null);
    if (!today.length) return null;

    // kW: 15-min-Leistung; kWh: Summe je Stunde (15 min = 0,25 h)
    const kw = today.map(f => ({ x: f.t, y: f.w / 1000 }));
    const hours = new Map();
    const hasBand = today.some(f => f.p10 != null && f.p90 != null);
    for (const f of today) {
      const h = new Date(f.t); h.setMinutes(0, 0, 0);
      const k = h.getTime();
      const e = hours.get(k) || { y: 0, p10: 0, p90: 0 };
      e.y += f.w * 0.25 / 1000;
      if (hasBand) { e.p10 += (f.p10 ?? f.w) * 0.25 / 1000; e.p90 += (f.p90 ?? f.w) * 0.25 / 1000; }
      hours.set(k, e);
    }
    const sorted = [...hours.entries()].sort((a, b) => a[0] - b[0]);
    return {
      kw,
      kwh: sorted.map(([x, e]) => ({ x, y: e.y })),
      kwBand: hasBand ? today.map(f => ({ x: f.t, lo: (f.p10 ?? f.w) / 1000, hi: (f.p90 ?? f.w) / 1000 })) : null,
      kwhBand: hasBand ? sorted.map(([x, e]) => ({ x, lo: e.p10, hi: e.p90 })) : null,
      dayEnd,
      totalKwh: sorted.reduce((s, [, e]) => s + e.y, 0),
    };
  }

  // `view` = sichtbarer Ausschnitt {min, max} nach
  // einem Zoom; dann gelten die feinen Balken aus this._chartFine. Ohne `view`
  // (neuer Zeitraum, Reset) wieder die Grundauflösung.
  renderChart(view = null) {
    const periodLabel = this.getPeriodLabel(this.currentPeriod);
    this.setEl('chart-period', periodLabel);

    const isKw = this.currentChartUnit === 'kw';
    const unitLabel = isKw ? 'kW' : 'kWh';
    if (!view) this._chartFine = null;
    const fine = isKw ? null : this._chartFine;
    const consumption = isKw ? (this.chartConsumptionKw || []) : (fine ? fine.cons : this.chartConsumption);
    const production = isKw ? (this.chartProductionKw || []) : (fine ? fine.prod : this.chartProduction);
    const barUnit = fine ? fine.unit : (isKw && this._kwDailyPeak ? this.t('kW, Tagesspitze') : unitLabel);
    const heatpump = isKw || fine ? [] : (this.chartHeatpump || []);
    const chartPeriod = this.getChartAggregation(this.currentPeriod);
    const timeUnitMap = { hour: 'hour', day: 'day', month: 'month' };
    const timeUnit = fine ? (fine.minutes < 60 ? 'minute' : fine.minutes < 1440 ? 'hour' : 'day')
                          : (timeUnitMap[chartPeriod] || 'day');
    const refKw = this.config.refLimit ?? 5;
    const { start: periodStart, end: periodEnd0 } = this.getTimeBounds(this.currentPeriod);

    // PV-Prognose: Linie, optional p10–p90-Band; Achse bis Mitternacht.
    // Bei Balken unter 1 h im 15-min-Raster als kW (= kWh/h).
    const fc = this.currentPeriod === 'today' ? this.chartForecast : null;
    const fcKw = isKw || !!(fine && fine.minutes < 60);
    const fcData = fc ? (fcKw ? fc.kw : fc.kwh) : [];
    const fcBand = fc ? (fcKw ? fc.kwBand : fc.kwhBand) : null;
    const periodEnd = fc ? new Date(fc.dayEnd) : periodEnd0;
    const forecastDatasets = fcData.length ? [
      ...(fcBand ? [
        { type: 'line', label: 'Prognose p10', data: fcBand.map(b => ({ x: b.x, y: b.lo })),
          borderWidth: 0, pointRadius: 0, fill: false, stack: 'fc-lo', order: 0 },
        { type: 'line', label: this.t('Prognose p10–p90'), data: fcBand.map(b => ({ x: b.x, y: b.hi })),
          borderWidth: 0, pointRadius: 0, fill: '-1', backgroundColor: 'rgba(227, 179, 65, 0.15)',
          stack: 'fc-hi', order: 0 },
      ] : []),
      { type: 'line', label: `${this.t('PV-Prognose')} (${fcKw && !isKw ? 'kWh/h' : unitLabel})`, data: fcData,
        _unit: fcKw && !isKw ? 'kWh/h' : undefined,
        borderColor: '#e3b341', backgroundColor: '#e3b341', borderWidth: 2, borderDash: [6, 4],
        pointRadius: 0, tension: 0.3, fill: false, stack: 'forecast', order: 0 },
    ] : [];

    // Highlight bars exceeding reference in kW mode
    const consBg = isKw
      ? consumption.map(d => d.y > refKw ? 'rgba(248, 81, 73, 1)' : 'rgba(248, 81, 73, 0.7)')
      : 'rgba(248, 81, 73, 0.55)';
    const consBorder = isKw
      ? consumption.map(d => d.y > refKw ? '#ff3b30' : '#f85149')
      : '#f85149';

    const config = {
      type: 'bar',
      data: {
        datasets: [
          {
            label: `${this.t('Verbrauch')} (${barUnit})`,
            data: consumption,
            _unit: fine ? fine.unitShort : undefined,
            backgroundColor: consBg,
            borderColor: consBorder,
            borderWidth: 1,
            borderRadius: isKw || (fine && fine.minutes < 60) ? 2 : 4,
            barPercentage: isKw ? 0.9 : 0.7,
            categoryPercentage: isKw ? 0.9 : 0.8,
            stack: 'main',
          },
          {
            label: `${this.t('Erzeugung')} (${barUnit})`,
            data: production,
            _unit: fine ? fine.unitShort : undefined,
            backgroundColor: isKw ? 'rgba(63, 185, 80, 0.7)' : 'rgba(63, 185, 80, 0.55)',
            borderColor: '#3fb950',
            borderWidth: 1,
            borderRadius: isKw ? 2 : 4,
            barPercentage: isKw ? 0.9 : 0.7,
            categoryPercentage: isKw ? 0.9 : 0.8,
            stack: 'production',
          },
          ...(!isKw && heatpump.length > 0 ? [{
            label: `${this.t('Wärmepumpe')} (${unitLabel})`,
            data: heatpump,
            backgroundColor: 'rgba(249, 115, 22, 0.55)',
            borderColor: '#f97316',
            borderWidth: 1,
            borderRadius: 4,
            barPercentage: 0.7,
            categoryPercentage: 0.8,
            stack: 'heatpump',
          }] : []),
          ...forecastDatasets,
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#8b949e',
              usePointStyle: true,
              pointStyle: 'rectRounded',
              padding: 16,
              font: { size: 12 },
              generateLabels: (chart) => {
                const labels = Chart.defaults.plugins.legend.labels.generateLabels(chart)
                  .filter(l => l.text !== 'Prognose p10');  // Hilfslinie des Prognose-Bands
                if (isKw) {
                  labels.push({
                    text: `${this.t('Referenz-Limit')} (${refKw} kW)`,
                    fillStyle: 'transparent',
                    strokeStyle: '#d29922',
                    lineWidth: 2,
                    lineDash: [6, 3],
                    pointStyle: 'line',
                    hidden: false,
                  });
                }
                return labels;
              },
            },
          },
          tooltip: {
            backgroundColor: 'rgba(13, 17, 23, 0.95)',
            titleColor: '#e6edf3',
            bodyColor: '#b1bac4',
            borderColor: '#30363d',
            borderWidth: 1,
            padding: 12,
            cornerRadius: 8,
            filter: (item) => item.dataset.label !== 'Prognose p10',
            callbacks: {
              label: (ctx) => {
                const v = (ctx.parsed.y ?? 0).toFixed(2);
                return `${ctx.dataset.label}: ${v} ${ctx.dataset._unit || unitLabel}`;
              },
            },
          },
          referenceLine: isKw
            ? { value: refKw, color: '#d29922', label: `${this.t('Referenz-Limit')} ${refKw} kW` }
            : { value: 0 },
          zoom: {
            limits: {
              x: { min: periodStart.getTime(), max: periodEnd.getTime(), minRange: 60 * 60 * 1000 },
            },
            pan: { enabled: true, mode: 'x',
              onPanComplete: ({ chart }) => this.refineChartForZoom(chart) },
            zoom: {
              wheel: { enabled: true, speed: 0.08 },
              pinch: { enabled: true },
              drag: { enabled: false },
              mode: 'x',
              onZoomComplete: ({ chart }) => {
                const resetBtn = document.getElementById('reset-zoom-btn');
                if (resetBtn) resetBtn.style.display = '';
                this.refineChartForZoom(chart);
              },
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            time: {
              unit: timeUnit,
              tooltipFormat: 'dd.MM.yyyy HH:mm',
              displayFormats: {
                minute: 'HH:mm', day: this.axisDay, month: this.axisMonth,
                hour: view && view.max - view.min > 86400000 ? 'dd.MM. HH:mm' : 'HH:mm',
              },
            },
            min: view ? view.min : periodStart.getTime(),
            max: view ? view.max : periodEnd.getTime(),
            ticks: { color: '#8b949e', maxTicksLimit: 14, font: { size: 10 }, maxRotation: 45 },
            grid: { color: 'rgba(48, 54, 61, 0.3)' },
            offset: true,
            stacked: true,
          },
          y: {
            beginAtZero: true,
            stacked: true,
            suggestedMax: isKw ? refKw * 1.2 : undefined,
            ticks: {
              color: '#8b949e',
              font: { size: 10 },
              callback: (v) => `${v} ${unitLabel}`,
            },
            grid: { color: 'rgba(48, 54, 61, 0.3)' },
          },
        },
      },
      plugins: [this.referenceLinePlugin],
    };

    if (this.chart) {
      this.chart.destroy();
    }
    const canvas = document.getElementById('energy-chart');
    if (canvas) {
      this.chart = new Chart(canvas, config);
      this.chart._fine = fine ? { minutes: fine.minutes, from: fine.from, to: fine.to } : null;
    }
  }

  // ── Time Bounds ───────────────────────────────────────────────

  getTimeBounds(period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start, end;

    switch (period) {
      case 'yesterday':
        start = new Date(today); start.setDate(start.getDate() - 1);
        end = new Date(today);
        break;
      case 'today':
        start = new Date(today);
        end = now;
        break;
      case 'this_week': {
        start = new Date(today);
        const dow = start.getDay() || 7;
        start.setDate(start.getDate() - dow + 1);
        end = now;
        break;
      }
      case 'last_week': {
        start = new Date(today);
        const dow2 = start.getDay() || 7;
        start.setDate(start.getDate() - dow2 - 6);
        end = new Date(start); end.setDate(end.getDate() + 7);
        break;
      }
      case 'this_month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = now;
        break;
      case 'last_month':
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'this_year':
        start = new Date(now.getFullYear(), 0, 1);
        end = now;
        break;
      case 'last_year':
        start = new Date(now.getFullYear() - 1, 0, 1);
        end = new Date(now.getFullYear(), 0, 1);
        break;
      case 'custom':
        if (this._customRange) {
          start = this._customRange.start;
          end = this._customRange.end;
        } else {
          start = new Date(today); start.setDate(start.getDate() - 7);
          end = now;
        }
        break;
      default:
        start = new Date(today); start.setDate(start.getDate() - 1);
        end = new Date(today);
    }
    return { start, end };
  }

  // ── UI Updates ────────────────────────────────────────────────

  updateStatCards() {
    const d = this.energyData;
    const fields = [
      ['consumption-value', d.consumption],
      ['production-value', d.production],
      ['imported-value', d.grid_import],
      ['exported-value', d.grid_export],
      ['self-consumed-value', d.self_consumed],
      ['heatpump-value', this.heatpumpData.electric],
    ];
    for (const [id, val] of fields) {
      const { value, unit } = this.formatEnergy(val || 0);
      this.setEl(id, value);
      const el = document.getElementById(id);
      if (el?.nextElementSibling?.classList.contains('stat-unit')) {
        el.nextElementSibling.textContent = unit;
      }
    }
    // WP COP sub-line
    const cop = this.heatpumpData.cop || 0;
    this.setEl('heatpump-cop', cop > 0 ? `COP ${cop.toFixed(1)}` : '');
  }

  updateFlowStats() {
    const d = this.energyData;
    const flowFields = [
      ['market-in', d.grid_import],
      ['market-out', d.grid_export],
      ['battery-charged', d.battery_charge],
      ['battery-discharged', d.battery_discharge],
    ];
    for (const [id, val] of flowFields) {
      const { value, unit } = this.formatEnergy(val || 0);
      this.setEl(id, value);
      const el = document.getElementById(id);
      if (el?.nextElementSibling?.classList.contains('flow-stat-unit')) {
        el.nextElementSibling.textContent = unit;
      }
    }
  }

  updateKeyMetrics() {
    const d = this.energyData;
    this.setEl('self-sufficiency', (d.self_sufficiency || 0).toFixed(1));
    const sc = this.formatEnergy(d.self_consumed || 0);
    this.setEl('self-consumed-metric', sc.value + ' ' + sc.unit);

    this.setEl('battery-soc', (this.powerData.battery_soc || 0).toFixed(0));
    const socBar = document.getElementById('battery-soc-bar');
    if (socBar) socBar.style.width = Math.min(100, this.powerData.battery_soc || 0) + '%';

    const ssBar = document.getElementById('self-sufficiency-bar');
    if (ssBar) ssBar.style.width = Math.min(100, d.self_sufficiency || 0) + '%';

    // Cost: use dynamic costs if available, otherwise fixed rate
    const monthlyFee = this.config.baseFee || 0;
    const { start: ps, end: pe } = this.getTimeBounds(this.currentPeriod);
    const days = Math.max(1, (pe - ps) / 86400000);
    const proratedFee = monthlyFee * (days / 30);
    let totalCost;
    if (d.__dynamicCosts) {
      totalCost = d.__dynamicCosts.totalCost + proratedFee;
    } else {
      const rate = this.getRate(d);
      totalCost = (d.grid_import || 0) * rate + proratedFee;
    }
    this.setEl('energy-cost', totalCost.toFixed(2));
    this.setEl('energy-savings', (d.savings || 0).toFixed(2));
  }

  updateHeatpumpTab() {
    if (!(this.config.heatpumpEnabled ?? true)) return;
    const hp = this.heatpumpData;
    this.setEl('wp-period-label', this.getPeriodLabel(this.currentPeriod));

    const fmt = (v) => { const f = this.formatEnergy(v || 0); return f.value; };
    this.setEl('wp-electric', fmt(hp.electric));
    this.setEl('wp-thermal', fmt(hp.thermal));
    this.setEl('wp-cop', hp.cop > 0 ? hp.cop.toFixed(1) : '—');
    this.setEl('wp-heater', fmt(hp.heater));

    // Breakdown bars
    const total = (hp.heating || 0) + (hp.dhw || 0);
    const heatingPct = total > 0 ? ((hp.heating || 0) / total * 100) : 0;
    const dhwPct = total > 0 ? ((hp.dhw || 0) / total * 100) : 0;
    const barH = document.getElementById('wp-bar-heating');
    const barD = document.getElementById('wp-bar-dhw');
    if (barH) barH.style.width = heatingPct + '%';
    if (barD) barD.style.width = dhwPct + '%';

    const fmtKwh = (v) => { const f = this.formatEnergy(v || 0); return f.value + ' ' + f.unit; };
    this.setEl('wp-heating-value', total > 0 ? `${fmtKwh(hp.heating)} (${heatingPct.toFixed(0)}%)` : '—');
    this.setEl('wp-dhw-value', total > 0 ? `${fmtKwh(hp.dhw)} (${dhwPct.toFixed(0)}%)` : '—');

    this.renderHeatpumpChart();
  }

  async renderHeatpumpChart() {
    const { start, end } = this.getTimeBounds(this.currentPeriod);
    const chartPeriod = this.getChartAggregation(this.currentPeriod);
    const wp = this._wpEntities;

    const [heatingStats, dhwStats, heatingScale, dhwScale] = await Promise.all([
      this.getStatistics(wp.heatingTotal, start, end, chartPeriod),
      this.getStatistics(wp.dhwTotal, start, end, chartPeriod),
      this.getUnitScale(wp.heatingTotal),
      this.getUnitScale(wp.dhwTotal),
    ]);
    const heatingData = this.statsToChartData(heatingStats, heatingScale);
    const dhwData = this.statsToChartData(dhwStats, dhwScale);

    const timeUnitMap = { hour: 'hour', day: 'day', month: 'month' };
    const timeUnit = timeUnitMap[chartPeriod] || 'day';

    if (this._wpChart) this._wpChart.destroy();
    const canvas = document.getElementById('wp-chart');
    if (!canvas) return;

    this._wpChart = new Chart(canvas, {
      type: 'bar',
      data: {
        datasets: [
          {
            label: this.t('Heizen (kWh)'),
            data: heatingData,
            backgroundColor: 'rgba(249, 115, 22, 0.65)',
            borderColor: '#f97316',
            borderWidth: 1,
            borderRadius: 0,
            barPercentage: 0.7,
            categoryPercentage: 0.8,
            stack: 'wp',
          },
          {
            label: this.t('Warmwasser (kWh)'),
            data: dhwData,
            backgroundColor: 'rgba(59, 130, 246, 0.65)',
            borderColor: '#3b82f6',
            borderWidth: 1,
            borderRadius: 4,
            barPercentage: 0.7,
            categoryPercentage: 0.8,
            stack: 'wp',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#8b949e', usePointStyle: true, pointStyle: 'rectRounded', padding: 16, font: { size: 12 } } },
          tooltip: {
            backgroundColor: 'rgba(13, 17, 23, 0.95)',
            titleColor: '#e6edf3', bodyColor: '#b1bac4',
            borderColor: '#30363d', borderWidth: 1, padding: 12, cornerRadius: 8,
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${(ctx.parsed.y ?? 0).toFixed(2)} kWh`,
              footer: (items) => {
                const sum = items.reduce((s, i) => s + (i.parsed.y ?? 0), 0);
                return this.t('Gesamt: {v} kWh', { v: this.num(sum.toFixed(2)) });
              },
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: timeUnit, tooltipFormat: 'dd.MM.yyyy HH:mm', displayFormats: { hour: 'HH:mm', day: this.axisDay, month: this.axisMonth } },
            min: start.getTime(), max: end.getTime(),
            ticks: { color: '#8b949e', maxTicksLimit: 14, font: { size: 10 }, maxRotation: 45 },
            grid: { color: 'rgba(48, 54, 61, 0.3)' },
            offset: true,
            stacked: true,
          },
          y: {
            beginAtZero: true,
            stacked: true,
            ticks: { color: '#8b949e', font: { size: 10 }, callback: (v) => `${v} kWh` },
            grid: { color: 'rgba(48, 54, 61, 0.3)' },
          },
        },
      },
    });
  }

  // ── Gas & Wasser ──────────────────────────────────────────────
  // Zähler in m³ aus den Einstellungen (Gas/Wasser). Preise, Brennwert und
  // Zustandszahl kommen aus den Tarifen (this._tariffs, siehe loadTarife).
  get _gasEntities() {
    const g = this.config.entities?.gas || {};
    return { meter: g.meter || '', outdoor: g.outdoor || '' };
  }

  get _waterEntities() {
    return { meter: this.config.entities?.water?.meter || '' };
  }

  // Reiter nur, wenn eingeschaltet und ein Zähler eingetragen ist
  isGasEnabled()   { return (this.config.gasEnabled ?? true) && !!this._gasEntities.meter; }
  isWaterEnabled() { return (this.config.waterEnabled ?? true) && !!this._waterEntities.meter; }

  // Verbrauch eines Zählers im aktuellen Zeitraum, in Zählereinheiten.
  // Summe und Balken aus der Differenz der Zählerstände: Die Statistik-„change“
  // ist bei Lesefehlern mit Rücksprung unbrauchbar (zählt als Zähler-Reset).
  async loadMeterSeries(entityId) {
    const period = this.currentPeriod;
    const { start, end } = this.getTimeBounds(period);
    const agg = ['this_year', 'last_year'].includes(period) ? 'month' : this.getChartAggregation(period);
    // Einen Bucket vor dem Start mitholen: dessen Zählerstand ist der Ausgangswert
    const fetchStart = new Date(start);
    if (agg === 'hour') fetchStart.setHours(fetchStart.getHours() - 1);
    else if (agg === 'day') fetchStart.setDate(fetchStart.getDate() - 1);
    else fetchStart.setMonth(fetchStart.getMonth() - 1);

    const [stats, live] = await Promise.all([
      this.getStatistics(entityId, fetchStart, end, agg),
      this.getState(entityId),
    ]);
    const startMs = start.getTime();
    const ts = (s) => new Date(s.start).getTime();
    const rows = stats.filter(s => s.state != null);
    const before = rows.filter(s => ts(s) < startMs);
    const inside = rows.filter(s => ts(s) >= startMs);

    const base = before.length ? before[before.length - 1].state
               : (inside.length ? inside[0].state : null);
    let prev = base;
    const bars = [];
    for (const s of inside) {
      bars.push({ x: ts(s), y: prev != null ? Math.max(0, s.state - prev) : 0 });
      prev = s.state;
    }

    // Laufender Zeitraum: Live-Zählerstand, angefangener Bucket als eigener Balken
    const isRunning = end.getTime() >= Date.now() - 60000;
    let last = inside.length ? inside[inside.length - 1].state : base;
    if (isRunning && live > 0) {
      const now = new Date();
      const bucket = agg === 'hour' ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours())
                   : agg === 'day' ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
                   : new Date(now.getFullYear(), now.getMonth(), 1);
      if (!bars.length || bars[bars.length - 1].x < bucket.getTime()) {
        bars.push({ x: bucket.getTime(), y: last != null ? Math.max(0, live - last) : 0 });
      }
      last = live;
    }

    const total = base != null && last != null ? Math.max(0, last - base) : 0;
    const days = Math.max(0, (end - start) / 86400000);
    return { start, end, agg, bars, total, days };
  }

  // Kostenseite: Gas- und Wasserzeilen und Gesamtsumme. Wird von der
  // Stromberechnung (updateInvoiceTab) und nach Gas/Wasser aufgerufen.
  // undefined = wird noch geladen, null = ausgeschaltet.
  updateInvoiceExtras() {
    const eur = (v) => v.toFixed(2) + ' €';
    const g = this._gasInv;
    const w = this._waterInv;

    if (g) {
      this.setEl('inv-gas-total', eur(g.total));
      this.setEl('inv-gas-qty', `${g.m3.toFixed(2)} m³ = ${g.kwh.toFixed(1)} kWh`);
      this.setEl('inv-gas-rate', `${g.preisCt.toFixed(2)} ct/kWh`);
      this.setEl('inv-gas-cost', eur(g.arbeit));
      this.setEl('inv-gas-days', this.fmtDays(g.days));
      this.setEl('inv-gas-monthly', `${g.grundMonat.toFixed(2)} €/Monat`);
      this.setEl('inv-gas-base', eur(g.grund));
    }
    if (w) {
      this.setEl('inv-water-total', eur(w.total));
      this.setEl('inv-water-qty', `${w.m3.toFixed(3)} m³`);
      this.setEl('inv-water-rate', `${w.preis.toFixed(3)} €/m³`);
      this.setEl('inv-water-cost', eur(w.frischArbeit));
      this.setEl('inv-waste-qty', `${w.m3.toFixed(3)} m³`);
      this.setEl('inv-waste-rate', `${w.abwPreis.toFixed(3)} €/m³`);
      this.setEl('inv-waste-cost', eur(w.abwArbeit));
      this.setEl('inv-water-days', this.fmtDays(w.days));
      this.setEl('inv-water-monthly', `${w.grundMonat.toFixed(2)} €/Monat`);
      this.setEl('inv-water-base', eur(w.grund));
    }

    const strom = this._invStromToPay;
    const loading = strom === undefined || g === undefined || w === undefined;
    const total = (strom || 0) + (g ? g.total : 0) + (w ? w.total : 0);
    for (const id of ['inv-net-balance', 'inv-grand-total']) {
      this.setEl(id, loading ? '…' : eur(total));
      const el = document.getElementById(id);
      if (el) el.style.color = loading ? '' : (total <= 0 ? 'var(--accent-green)' : 'var(--accent-red)');
    }
  }

  // „1 Tag“ / „n Tage“
  fmtDays(days) {
    const n = Math.round(days);
    return n === 1 ? this.t('1 Tag') : `${n} ${this.t('Tage')}`;
  }

  // Anteiliger Grundpreis für den Zeitraum (Monat = 365,25 / 12 Tage)
  proratedMonthly(perMonth, days) {
    return perMonth * days / (365.25 / 12);
  }

  async updateGasTab() {
    if (!this.isGasEnabled()) { this._gasInv = null; this.updateInvoiceExtras(); return; }
    try {
      const g = this._gasEntities;
      const t = this._tariffs || {};
      this.setEl('gas-period-label', this.getPeriodLabel(this.currentPeriod));

      const series = await this.loadMeterSeries(g.meter);
      const brennwert = t.gas_brennwert || 0;
      const zustandszahl = t.gas_zustandszahl || 0;
      const preisCt = t.gas_arbeitspreis || 0;
      const grundMonat = t.gas_grundpreis || 0;
      const { start, end, agg, days } = series;
      const kwhPerM3 = brennwert * zustandszahl;
      const m3 = series.total;
      const kwh = m3 * kwhPerM3;
      const arbeit = kwh * preisCt / 100;
      const grund = this.proratedMonthly(grundMonat, days);
      const cost = arbeit + grund;
      this._gasInv = { m3, kwh, preisCt, grundMonat, arbeit, grund, days, total: cost };
      this.updateInvoiceExtras();

      this.setEl('gas-m3', m3.toFixed(2));
      this.setEl('gas-kwh', kwh.toFixed(kwh >= 100 ? 1 : 2));
      this.setEl('gas-cost', cost.toFixed(2));
      this.setEl('gas-avg', (kwh / Math.max(1, days)).toFixed(2));
      this.setEl('gas-note',
        this.t('Umrechnung {f} kWh/m³ (Brennwert × Zustandszahl) · Arbeitspreis {p} ct/kWh · Grundpreis {g} €/Monat anteilig · gerechnet mit den aktuellen Preisen, auch für vergangene Zeiträume.',
          { f: this.num(kwhPerM3.toFixed(4)), p: this.num(preisCt), g: this.num(grundMonat) }));

      const tempStats = g.outdoor ? await this.getStatistics(g.outdoor, start, end, agg) : [];
      const temps = tempStats
        .filter(s => s.mean != null)
        .map(s => ({ x: new Date(s.start).getTime(), y: s.mean }));
      this.renderMeterChart({
        canvasId: 'gas-chart', chartKey: '_gasChart',
        label: this.t('Gas'), unit: 'kWh', digits: 2,
        color: '245, 158, 11', border: '#f59e0b',
        bars: series.bars.map(b => ({ x: b.x, y: b.y * kwhPerM3 })),
        temps, start, end, agg,
      });
    } catch (e) {
      console.warn('Gas tab update failed:', e.message);
      this._gasInv = null; this.updateInvoiceExtras();
    }
  }

  async updateWaterTab() {
    if (!this.isWaterEnabled()) { this._waterInv = null; this.updateInvoiceExtras(); return; }
    try {
      const w = this._waterEntities;
      const t = this._tariffs || {};
      this.setEl('water-period-label', this.getPeriodLabel(this.currentPeriod));

      const series = await this.loadMeterSeries(w.meter);
      const preis = t.wasser_preis || 0;
      const grund = t.wasser_grundpreis || 0;
      const abwPreis = t.abwasser_preis || 0;
      const abwGrund = t.abwasser_grundpreis || 0;
      const { start, end, agg, days } = series;
      const m3 = series.total;
      const frisch = m3 * preis + this.proratedMonthly(grund, days);
      const abwasser = m3 * abwPreis + this.proratedMonthly(abwGrund, days);
      this._waterInv = {
        m3, preis, abwPreis, days,
        grundMonat: grund + abwGrund,
        frischArbeit: m3 * preis,
        abwArbeit: m3 * abwPreis,
        grund: this.proratedMonthly(grund + abwGrund, days),
        total: frisch + abwasser,
      };
      this.updateInvoiceExtras();

      this.setEl('water-m3', m3.toFixed(3));
      this.setEl('water-fresh-cost', frisch.toFixed(2));
      this.setEl('water-waste-cost', abwasser.toFixed(2));
      this.setEl('water-cost', (frisch + abwasser).toFixed(2));
      this.setEl('water-avg', Math.round(m3 * 1000 / Math.max(1, days)).toString());
      this.setEl('water-note',
        this.t('Frischwasser {p} €/m³ + Grundpreis {g} €/Monat · Abwasser {a} €/m³ (nach Frischwasser-m³)',
          { p: this.num(preis), g: this.num(grund), a: this.num(abwPreis) }) +
        (abwGrund > 0 ? this.t(' + Grundpreis {g} €/Monat', { g: this.num(abwGrund) }) : '') +
        this.t(' · Grundpreise anteilig · gerechnet mit den aktuellen Preisen.'));

      this.renderMeterChart({
        canvasId: 'water-chart', chartKey: '_waterChart',
        label: this.t('Wasser'), unit: 'l', digits: 0,
        color: '56, 189, 248', border: '#38bdf8',
        bars: series.bars.map(b => ({ x: b.x, y: b.y * 1000 })),
        temps: null, start, end, agg,
      });
    } catch (e) {
      console.warn('Water tab update failed:', e.message);
      this._waterInv = null; this.updateInvoiceExtras();
    }
  }

  // Balkendiagramm für Zählerverbrauch, optional mit Außentemperatur-Linie
  renderMeterChart({ canvasId, chartKey, label, unit, digits, color, border, bars, temps, start, end, agg }) {
    if (this[chartKey]) this[chartKey].destroy();
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const timeUnit = { hour: 'hour', day: 'day', month: 'month' }[agg] || 'day';

    const datasets = [{
      type: 'bar',
      label: `${label} (${unit})`,
      data: bars,
      yAxisID: 'y',
      backgroundColor: `rgba(${color}, 0.65)`,
      borderColor: border,
      borderWidth: 1,
      borderRadius: 4,
      barPercentage: 0.7,
      categoryPercentage: 0.8,
      order: 2,
    }];
    const scales = {
      x: {
        type: 'time',
        time: { unit: timeUnit, tooltipFormat: 'dd.MM.yyyy HH:mm', displayFormats: { hour: 'HH:mm', day: this.axisDay, month: this.axisMonth } },
        min: start.getTime(), max: end.getTime(),
        ticks: { color: '#8b949e', maxTicksLimit: 14, font: { size: 10 }, maxRotation: 45 },
        grid: { color: 'rgba(48, 54, 61, 0.3)' },
        offset: true,
      },
      y: {
        beginAtZero: true,
        position: 'left',
        ticks: { color: '#8b949e', font: { size: 10 }, callback: (v) => `${v} ${unit}` },
        grid: { color: 'rgba(48, 54, 61, 0.3)' },
      },
    };
    if (temps) {
      datasets.push({
        type: 'line',
        label: this.t('Außentemperatur (°C)'),
        data: temps,
        yAxisID: 'yTemp',
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.15)',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
        order: 1,
      });
      scales.yTemp = {
        position: 'right',
        ticks: { color: '#3b82f6', font: { size: 10 }, callback: (v) => `${v} °C` },
        grid: { drawOnChartArea: false },
      };
    }

    this[chartKey] = new Chart(canvas, {
      type: 'bar',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#8b949e', usePointStyle: true, pointStyle: 'rectRounded', padding: 16, font: { size: 12 } } },
          tooltip: {
            backgroundColor: 'rgba(13, 17, 23, 0.95)',
            titleColor: '#e6edf3', bodyColor: '#b1bac4',
            borderColor: '#30363d', borderWidth: 1, padding: 12, cornerRadius: 8,
            callbacks: {
              label: (ctx) => ctx.dataset.yAxisID === 'yTemp'
                ? `${ctx.dataset.label}: ${(ctx.parsed.y ?? 0).toFixed(1)} °C`
                : `${ctx.dataset.label}: ${(ctx.parsed.y ?? 0).toFixed(digits)} ${unit}`,
            },
          },
        },
        scales,
      },
    });
  }

  // ── Tarife ───────────────────────────────────────────────────
  // Feste Preise aus den Einstellungen (config.tariffs). Für dynamische Preise
  // gibt es je ein optionales Sensor-Feld: Strom (rateEntity), Einspeisung
  // (feedInEntity) und Gas (gasRateEntity); deren aktueller Wert ersetzt den
  // festen Preis. Dieselben Werte nutzen die Kostensensoren der Integration.
  _tariffKeys = [
    'strom_arbeitspreis', 'strom_grundpreis',                     // ct/kWh, €/Monat
    'pv_anlagenleistung', 'einspeisung_leistungsgrenze',          // kWp
    'einspeisung_verguetung_bis_grenze', 'einspeisung_verguetung_ueber_grenze',  // ct/kWh
    'gas_arbeitspreis', 'gas_grundpreis',                         // ct/kWh, €/Monat
    'gas_brennwert', 'gas_zustandszahl',                          // kWh/m³, Faktor
    'wasser_preis', 'wasser_grundpreis',                          // €/m³, €/Monat
    'abwasser_preis', 'abwasser_grundpreis',                      // €/m³, €/Monat
  ];

  // Ohne gespeicherte Tarife: Werte der bisherigen Felder Strompreis,
  // Grundgebühr und Einspeisevergütung übernehmen
  _legacyTariffs() {
    return {
      strom_arbeitspreis: Math.round((this.config.electricityRate ?? 0.30) * 10000) / 100,
      strom_grundpreis: this.config.baseFee ?? 0,
      einspeisung_verguetung_bis_grenze: Math.round((this.config.feedInRate ?? 0.08) * 10000) / 100,
    };
  }

  // Faktor auf EUR je Einheit: Sensoren in ct/kWh liefern Cent
  async priceScale(entityId) {
    try {
      const data = await this.fetchAPI(`/api/states/${entityId}`);
      return String(data?.attributes?.unit_of_measurement || '').toLowerCase().includes('ct') ? 0.01 : 1;
    } catch (e) {
      return 1;
    }
  }

  // Aktueller Preis eines dynamischen Sensors in EUR je Einheit, sonst null
  async dynamicPriceEur(entityId) {
    if (!entityId) return null;
    const [value, scale] = await Promise.all([this.getState(entityId), this.priceScale(entityId)]);
    return value > 0 ? value * scale : null;
  }

  async loadTarife() {
    const stored = this.config.tariffs || this._legacyTariffs();
    const t = {};
    for (const k of this._tariffKeys) t[k] = Number(stored[k]) || 0;
    this._tariffs = t;
    this.applyTariffs(t);

    // Dynamische Preise ersetzen die festen (Strom: siehe loadSettings/rateEntity)
    const [feedIn, gas] = await Promise.all([
      this.dynamicPriceEur(this.config.feedInEntity),
      this.dynamicPriceEur(this.config.gasRateEntity),
    ]);
    if (feedIn != null) this.config.feedInRate = feedIn;
    if (gas != null) t.gas_arbeitspreis = gas * 100;  // Gas-Tab rechnet in ct/kWh
  }

  // Strompreis, Grundgebühr und Einspeisevergütung für Kennzahlen und Kostenseite
  applyTariffs(t) {
    if (t.strom_arbeitspreis > 0) this.config.electricityRate = t.strom_arbeitspreis / 100;
    this.config.baseFee = t.strom_grundpreis || 0;
    // EEG-Mischpreis nach Leistung: bis zur Schwelle der höhere Satz, darüber der niedrigere
    const anlage = t.pv_anlagenleistung || 0;
    const grenze = t.einspeisung_leistungsgrenze || 0;
    this.config.feedInRate = anlage > 0 && anlage > grenze
      ? (grenze * t.einspeisung_verguetung_bis_grenze + (anlage - grenze) * t.einspeisung_verguetung_ueber_grenze) / anlage / 100
      : (t.einspeisung_verguetung_bis_grenze || 0) / 100;
  }

  populateTarifFields() {
    const stored = this.config.tariffs || this._legacyTariffs();
    for (const el of document.querySelectorAll('[data-tarif]')) {
      el.value = stored[el.dataset.tarif] ?? '';
    }
  }

  // Liest die festen Preise aus dem Formular
  readTarifFields() {
    const tariffs = { ...(this.config.tariffs || this._legacyTariffs()) };
    for (const el of document.querySelectorAll('[data-tarif]')) {
      const v = parseFloat(el.value);
      if (!isNaN(v)) tariffs[el.dataset.tarif] = v;
    }
    return tariffs;
  }

  updateInvoiceTab() {
    const d = this.energyData;
    const dc = d.__dynamicCosts;
    const currentRate = this.getRate(d);
    const fixedRate = this.config.fixedElectricityRate || currentRate;
    const rate = dc ? dc.avgRate : currentRate;
    const compensation = this.getCompensation(d);
    const imported = d.grid_import || 0;
    const exported = d.grid_export || 0;
    const consumption = d.consumption || 0;
    const selfConsumed = d.self_consumed || 0;

    // Netzbezug-Kosten: dynamische Kosten + Fixpreis-Fallback für Slots ohne Preis
    let importCost;
    let effectiveRate;
    if (dc) {
      const missingKwh = Math.max(0, imported - dc.totalKwh);
      importCost = dc.totalCost + missingKwh * fixedRate;
      effectiveRate = imported > 0 ? importCost / imported : dc.avgRate;
    } else {
      importCost = imported * fixedRate;
      effectiveRate = fixedRate;
    }
    const feedInRevenue = exported * compensation;
    const selfSavings = selfConsumed * effectiveRate;

    // Grundgebühr proration based on period length
    const monthlyBaseFee = this.config.baseFee || 0;
    const { start, end } = this.getTimeBounds(this.currentPeriod);
    const periodDays = Math.max(1, (end - start) / 86400000);
    const proratedBaseFee = monthlyBaseFee * (periodDays / 30);

    const toPay = importCost + proratedBaseFee - feedInRevenue;
    const solarTotal = selfSavings + feedInRevenue;

    const eur = (v) => v.toFixed(2) + ' €';
    const kwh = (v) => this.formatEnergy(v).value + ' ' + this.formatEnergy(v).unit;

    // Period label
    this.setEl('invoice-period-label', this.getPeriodLabel(this.currentPeriod));

    // Metric badges
    const fmtBadge = (v) => { const f = this.formatEnergy(v); return f.value + ' ' + f.unit; };
    this.setEl('inv-badge-consumption', fmtBadge(consumption));
    this.setEl('inv-badge-production', fmtBadge(d.production || 0));
    this.setEl('inv-badge-exported', fmtBadge(exported));
    this.setEl('inv-badge-imported', fmtBadge(imported));

    // Summary cards
    this.setEl('inv-total-cost', eur(importCost + proratedBaseFee));
    this.setEl('inv-total-revenue', eur(feedInRevenue));
    this.setEl('inv-total-savings', eur(selfSavings));
    this.setEl('inv-net-balance', eur(toPay));

    // Color net balance
    const netEl = document.getElementById('inv-net-balance');
    if (netEl) {
      netEl.style.color = toPay <= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    }

    // Detail table
    this.setEl('inv-consumption-kwh', kwh(consumption));
    this.setEl('inv-import-kwh', kwh(imported));
    if (dc) {
      this.setEl('inv-import-rate', 'Ø ' + (effectiveRate * 100).toFixed(2) + ' ct/kWh');
    } else {
      this.setEl('inv-import-rate', (fixedRate * 100).toFixed(2) + ' ct/kWh');
    }
    this.setEl('inv-import-cost', eur(importCost));

    // Dynamic rate warning
    const warnEl = document.getElementById('inv-dynamic-warn');
    if (warnEl) {
      if (dc && dc.missingSlots > 0) {
        const missingKwh = Math.max(0, imported - dc.totalKwh);
        warnEl.textContent = `${dc.missingSlots} ${this.t('Intervalle ohne dyn. Preis')} (${this.num(missingKwh.toFixed(1))} ${this.t('kWh mit Fixpreis')} ${this.num((fixedRate * 100).toFixed(2))} ct/kWh ${this.t('berechnet')})`;
        warnEl.style.display = '';
      } else {
        warnEl.style.display = 'none';
      }
    }

    // Grundgebühr row
    this.setEl('inv-base-fee-monthly', this.num(monthlyBaseFee.toFixed(2)) + ' ' + this.t('€/Monat'));
    this.setEl('inv-base-fee-days', this.fmtDays(periodDays));
    this.setEl('inv-base-fee-cost', eur(proratedBaseFee));
    const baseFeeRow = document.getElementById('inv-base-fee-row');
    if (baseFeeRow) baseFeeRow.style.display = monthlyBaseFee > 0 ? '' : 'none';

    this.setEl('inv-export-kwh', kwh(exported));
    this.setEl('inv-export-rate', compensation.toFixed(4) + ' €/kWh');
    this.setEl('inv-export-revenue', '−' + eur(feedInRevenue));

    this.setEl('inv-self-kwh', kwh(selfConsumed));
    this.setEl('inv-self-rate', 'Ø ' + (effectiveRate * 100).toFixed(2) + ' ct/kWh');
    this.setEl('inv-self-savings', '−' + eur(selfSavings));

    this.setEl('inv-net-total', eur(toPay));
    const netTotalEl = document.getElementById('inv-net-total');
    if (netTotalEl) {
      netTotalEl.style.color = toPay <= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    }
    // Gesamtsumme inkl. Gas und Wasser (inv-net-balance wird dort überschrieben)
    this._invStromToPay = toPay;
    this.updateInvoiceExtras();

    // Wärmepumpe info rows
    const hp = this.heatpumpData || {};
    const wpElectric = hp.electric || 0;
    const wpHeating = hp.heating || 0;
    const wpDhw = hp.dhw || 0;
    const wpHeater = hp.heater || 0;
    const wpVisible = wpElectric > 0;
    const wpSection = document.getElementById('inv-wp-section');
    const wpRow = document.getElementById('inv-wp-row');
    if (wpSection) wpSection.style.display = wpVisible ? '' : 'none';
    if (wpRow) wpRow.style.display = wpVisible ? '' : 'none';
    if (wpVisible) {
      this.setEl('inv-wp-kwh', kwh(wpElectric));
      this.setEl('inv-wp-rate', 'Ø ' + (effectiveRate * 100).toFixed(2) + ' ct/kWh');
      this.setEl('inv-wp-cost', eur(wpElectric * effectiveRate));
      this.setEl('inv-wp-heating-kwh', kwh(wpHeating));
      this.setEl('inv-wp-heating-cost', eur(wpHeating * effectiveRate));
      this.setEl('inv-wp-dhw-kwh', kwh(wpDhw));
      this.setEl('inv-wp-dhw-cost', eur(wpDhw * effectiveRate));
      this.setEl('inv-wp-heater-kwh', kwh(wpHeater));
      this.setEl('inv-wp-heater-cost', eur(wpHeater * effectiveRate));
    }

    // Solar value card
    this.setEl('inv-solar-savings', eur(selfSavings));
    this.setEl('inv-solar-feed-in', eur(feedInRevenue));
    this.setEl('inv-solar-total', eur(solarTotal));

    // Rate chart
    this.renderRateChart(dc);
  }

  // Color function for rate: green (cheap) → yellow → red (expensive)
  _rateToColor(rate, minRate, maxRate, alpha = 1) {
    const range = maxRate - minRate || 0.01;
    const t = Math.max(0, Math.min(1, (rate - minRate) / range));
    let r, g, b;
    if (t <= 0.5) {
      const t2 = t * 2;
      r = Math.round(16 + t2 * (251 - 16));
      g = Math.round(185 + t2 * (191 - 185));
      b = Math.round(129 - t2 * 129);
    } else {
      const t2 = (t - 0.5) * 2;
      r = Math.round(251 - t2 * (251 - 239));
      g = Math.round(191 - t2 * (191 - 68));
      b = Math.round(0 + t2 * 68);
    }
    return alpha === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
  }

  renderRateChart(dc) {
    const canvas = document.getElementById('rate-chart');
    const section = document.querySelector('.invoice-chart-section');
    if (!canvas || !section) return;

    if (this._rateChart) { this._rateChart.destroy(); this._rateChart = null; }

    if (!dc || !dc.data || dc.data.length === 0) {
      section.style.display = 'none';
      return;
    }
    section.style.display = '';

    const consumptionData = dc.data.map(d => ({ x: d.x, y: d.consumption }));
    const validRates = dc.data.filter(d => d.rate !== null).map(d => d.rate);
    const minRate = Math.min(...validRates);
    const maxRate = Math.max(...validRates);

    const rateData = dc.data
      .filter(d => d.rate !== null)
      .map(d => ({ x: d.x, y: d.rate * 100 }));

    // Per-point colors for rate line segments
    const ratePointColors = dc.data
      .filter(d => d.rate !== null)
      .map(d => this._rateToColor(d.rate, minRate, maxRate));
    const rateFillColors = dc.data
      .filter(d => d.rate !== null)
      .map(d => this._rateToColor(d.rate, minRate, maxRate, 0.15));

    const { start, end } = this.getTimeBounds(this.currentPeriod);
    const startMs = start.getTime();
    // Extend x-axis to end of day if future rate data exists
    const lastRateTs = rateData.length > 0 ? rateData[rateData.length - 1].x : 0;
    const endOfDay = new Date(start);
    endOfDay.setDate(endOfDay.getDate() + 1);
    endOfDay.setHours(0, 0, 0, 0);
    const endMs = lastRateTs > end.getTime() ? endOfDay.getTime() : end.getTime();

    const nowMs = Date.now();
    const nowLabel = this.t('Jetzt');  // vor dem Plugin aufgelöst — afterDraw läuft mit this = Plugin-Objekt, nicht die Dashboard-Instanz
    const nowLinePlugin = {
      id: 'nowLine',
      afterDraw(chart) {
        if (nowMs < startMs || nowMs > endMs) return;
        const xScale = chart.scales.x;
        const x = xScale.getPixelForValue(nowMs);
        const { top, bottom } = chart.chartArea;
        const ctx = chart.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        // Label
        ctx.setLineDash([]);
        ctx.font = '10px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.textAlign = 'center';
        ctx.fillText(nowLabel, x, top - 4);
        ctx.restore();
      },
    };

    this._rateChart = new Chart(canvas, {
      type: 'bar',
      data: {
        datasets: [
          {
            label: this.t('Verbrauch (kWh)'),
            data: consumptionData,
            backgroundColor: 'rgba(248, 81, 73, 0.7)',
            borderColor: '#f85149',
            borderWidth: 1,
            borderRadius: 2,
            barPercentage: 0.85,
            categoryPercentage: 0.9,
            yAxisID: 'y',
            order: 2,
          },
          {
            label: this.t('Strompreis (ct/kWh)'),
            data: rateData,
            type: 'line',
            segment: {
              borderColor: (ctx) => {
                const i = ctx.p1DataIndex;
                return ratePointColors[i] || '#fbbf24';
              },
              backgroundColor: (ctx) => {
                const i = ctx.p1DataIndex;
                return rateFillColors[i] || 'rgba(251,191,36,0.15)';
              },
            },
            borderColor: ratePointColors,
            pointBackgroundColor: ratePointColors,
            borderWidth: 2,
            pointRadius: 0,
            pointHitRadius: 8,
            fill: true,
            tension: 0.3,
            spanGaps: false,
            yAxisID: 'y1',
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { color: '#8b92a7', font: { size: 11 }, boxWidth: 12, padding: 15 },
          },
          tooltip: {
            backgroundColor: '#1a1f2e',
            titleColor: '#fff',
            bodyColor: '#8b92a7',
            borderColor: '#2a3342',
            borderWidth: 1,
            callbacks: {
              title: (items) => {
                if (!items.length) return '';
                const d = new Date(items[0].parsed.x);
                return d.toLocaleString(this.locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
              },
              label: (item) => {
                if (item.dataset.yAxisID === 'y1') return ` ${this.t('Preis:')} ${this.num(item.parsed.y.toFixed(2))} ct/kWh`;
                return ` ${this.t('Verbrauch:')} ${this.num(item.parsed.y.toFixed(4))} kWh`;
              },
            },
          },
          zoom: {
            limits: {
              x: { min: startMs, max: endMs },
            },
            pan: { enabled: true, mode: 'x' },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: 'x',
              onZoomComplete: () => {
                const btn = document.getElementById('reset-zoom-rate-btn');
                if (btn) btn.style.display = '';
              },
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: 'hour', tooltipFormat: 'dd.MM.yyyy HH:mm', displayFormats: { hour: 'HH:mm', day: this.axisDay } },
            min: startMs,
            max: endMs,
            grid: { color: 'rgba(42,51,66,0.5)' },
            ticks: { color: '#8b92a7', font: { size: 10 }, maxRotation: 0 },
          },
          y: {
            beginAtZero: true,
            position: 'left',
            title: { display: true, text: 'kWh', color: '#8b92a7', font: { size: 11 } },
            grid: { color: 'rgba(42,51,66,0.3)' },
            ticks: { color: '#f85149', font: { size: 10 } },
          },
          y1: {
            beginAtZero: false,
            position: 'right',
            title: { display: true, text: 'ct/kWh', color: '#8b92a7', font: { size: 11 } },
            grid: { drawOnChartArea: false },
            ticks: { color: '#8b92a7', font: { size: 10 } },
          },
        },
      },
      plugins: [nowLinePlugin],
    });
  }

  renderHourlyGrid() {
    const grid = document.getElementById('inv-hourly-grid');
    const dc = this.energyData.__dynamicCosts;
    if (!grid || !dc || !dc.data.length) {
      if (grid) grid.innerHTML = '<div style="color:var(--text-secondary);font-size:0.8rem;padding:0.5rem">' + this.t('Keine dynamischen Preisdaten verfügbar') + '</div>';
      return;
    }

    // Aggregate 15-min data to hourly
    const hourly = new Map();
    for (const d of dc.data) {
      const h = Math.floor(d.x / 3600000) * 3600000;
      if (!hourly.has(h)) hourly.set(h, { kwh: 0, cost: 0, rates: [], hasMissing: false });
      const entry = hourly.get(h);
      entry.kwh += d.consumption;
      if (d.rate !== null) {
        entry.cost += d.cost;
        entry.rates.push(d.rate);
      } else {
        entry.hasMissing = true;
      }
    }

    // Find min/max rate for color scale
    const allRates = [];
    for (const [, v] of hourly) {
      if (v.rates.length) allRates.push(...v.rates);
    }
    const minRate = Math.min(...allRates);
    const maxRate = Math.max(...allRates);
    const rateRange = maxRate - minRate || 0.01;

    const rateColor = (rate) => this._rateToColor(rate, minRate, maxRate);

    const sorted = [...hourly.entries()].sort((a, b) => a[0] - b[0]);
    let html = '';
    for (const [ts, v] of sorted) {
      const d = new Date(ts);
      const time = d.toLocaleTimeString(this.locale, { hour: '2-digit', minute: '2-digit' });
      const avgRate = v.rates.length ? v.rates.reduce((a, b) => a + b, 0) / v.rates.length : null;
      const bg = avgRate !== null
        ? rateColor(avgRate).replace('rgb', 'rgba').replace(')', ',0.15)')
        : 'rgba(100,100,100,0.1)';
      const priceColor = avgRate !== null ? rateColor(avgRate) : 'var(--text-secondary)';
      const priceText = avgRate !== null ? (avgRate * 100).toFixed(1) + ' ct' : '—';
      const kwhText = v.kwh >= 1 ? v.kwh.toFixed(2) + ' kWh' : (v.kwh * 1000).toFixed(0) + ' Wh';

      html += `<div class="inv-hourly-cell" style="background:${bg}">
        <div class="inv-h-time">${time}</div>
        <div class="inv-h-kwh">${kwhText}</div>
        <div class="inv-h-price" style="color:${priceColor}">${priceText}</div>
      </div>`;
    }
    grid.innerHTML = html;
  }

  updateEnergyFlow() {
    const p = this.powerData;
    const fmt = (v) => v >= 1000 ? (v / 1000).toFixed(1) + ' kW' : Math.round(v) + ' W';

    this.setEl('flow-solar-value', fmt(p.production || 0));
    this.setEl('flow-house-value', fmt(p.consumption || 0));
    this.setEl('flow-grid-value', fmt(
      (p.grid_import || 0) > (p.grid_export || 0) ? p.grid_import : p.grid_export
    ));
    this.setEl('flow-battery-value', fmt(
      (p.battery_charge || 0) > (p.battery_discharge || 0) ? p.battery_charge : p.battery_discharge
    ));
    this.setEl('flow-battery-soc', (p.battery_soc || 0).toFixed(0) + '%');

    const gridLabel = document.getElementById('flow-grid-label');
    if (gridLabel) gridLabel.textContent = (p.grid_export || 0) > 10 ? this.t('EXPORT') : this.t('IMPORT');

    const batLabel = document.getElementById('flow-battery-label');
    if (batLabel) batLabel.textContent = (p.battery_charge || 0) > 10 ? this.t('LADEN') : this.t('ENTLADEN');

    // Wärmepumpe
    this.setEl('flow-wp-value', fmt(p.heatpump || 0));

    this.updateFlowAnimations();
  }

  updateFlowAnimations() {
    const p = this.powerData;
    this.toggleFlow('flow-solar-house', p.production > 10);
    this.toggleFlow('flow-grid-house', p.grid_import > 10);
    this.toggleFlow('flow-house-grid', p.grid_export > 10);
    this.toggleFlow('flow-solar-battery', p.battery_charge > 10 && p.production > 10);
    this.toggleFlow('flow-battery-house', p.battery_discharge > 10);
    this.toggleFlow('flow-house-wp', p.heatpump > 10);
  }

  toggleFlow(id, active) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.toggle('flow-active', active);
      el.classList.toggle('flow-inactive', !active);
    }
  }

  // ── Event Listeners ───────────────────────────────────────────

  setupEventListeners() {
    // Expandable invoice rows
    document.getElementById('inv-import-row')?.addEventListener('click', () => {
      const row = document.getElementById('inv-import-row');
      const detail = document.getElementById('inv-import-detail');
      if (!row || !detail) return;
      const open = row.classList.toggle('open');
      detail.style.display = open ? '' : 'none';
      if (open) this.renderHourlyGrid();
    });

    document.getElementById('inv-wp-row')?.addEventListener('click', () => {
      const row = document.getElementById('inv-wp-row');
      const detail = document.getElementById('inv-wp-detail');
      if (!row || !detail) return;
      const open = row.classList.toggle('open');
      detail.style.display = open ? '' : 'none';
    });

    const popup = document.getElementById('custom-range-popup');
    const allCustomBtns = document.querySelectorAll('[data-period="custom"]');

    document.querySelectorAll('.time-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const period = e.target.dataset.period;
        if (period === 'custom') {
          // Toggle popup, position below clicked button
          popup.classList.toggle('open');
          if (popup.classList.contains('open')) {
            const rect = e.target.getBoundingClientRect();
            popup.style.top = (rect.bottom + window.scrollY + 4) + 'px';
            popup.style.left = Math.max(8, rect.right - popup.offsetWidth) + 'px';
            const today = new Date().toISOString().slice(0, 10);
            const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
            const startInput = document.getElementById('custom-range-start');
            const endInput = document.getElementById('custom-range-end');
            if (!startInput.value) startInput.value = weekAgo;
            if (!endInput.value) endInput.value = today;
          }
          return;
        }
        popup.classList.remove('open');
        // Sync active state across all time-btn sets
        document.querySelectorAll('.time-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.period === period);
        });
        // Reset custom button text
        allCustomBtns.forEach(b => b.textContent = this.t('Custom'));
        this.switchPeriod(period);
      });
    });

    // Custom range apply
    document.getElementById('custom-range-apply')?.addEventListener('click', () => {
      const startVal = document.getElementById('custom-range-start').value;
      const endVal = document.getElementById('custom-range-end').value;
      if (!startVal || !endVal) return;
      const start = new Date(startVal + 'T00:00:00');
      const end = new Date(endVal + 'T23:59:59');
      if (start >= end) return;
      this._customRange = { start, end };
      popup.classList.remove('open');
      document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
      // Show date range on all custom buttons
      const fmt = (d) => d.toLocaleDateString(this.locale, { day: '2-digit', month: '2-digit' });
      const label = `${fmt(start)} – ${fmt(end)}`;
      allCustomBtns.forEach(b => { b.classList.add('active'); b.textContent = label; });
      this.switchPeriod('custom');
    });

    // Close popup on outside click
    document.addEventListener('click', (e) => {
      const isCustomBtn = e.target.dataset?.period === 'custom';
      if (!popup.contains(e.target) && !isCustomBtn) {
        popup.classList.remove('open');
      }
    });

    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const tab = e.currentTarget.dataset.tab;
        this.currentTab = tab;
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        e.currentTarget.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(tc => {
          tc.style.display = tc.dataset.tab === tab ? '' : 'none';
        });
        // Pause flow animations when not on dashboard (saves energy on Safari/iOS)
        const flowDiagram = document.querySelector('.flow-diagram');
        if (flowDiagram) {
          flowDiagram.classList.toggle('flow-paused', tab !== 'dashboard');
        }
      });
    });

    // kWh / kW toggle
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.currentChartUnit = e.target.dataset.unit;
        if (this.currentChartUnit === 'kw' && !this.chartConsumptionKw) {
          this.setEl('chart-period', this.t('Lade Leistungsdaten…'));
          await this.loadPowerChartData();
        }
        this.renderChart();
      });
    });

    // Settings tab
    this.initSettingsTab();

    // Reset Zoom button (Dashboard chart)
    const resetBtn = document.getElementById('reset-zoom-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        // neu aufbauen (ganzer Zeitraum, Grundauflösung) –
        // resetZoom() ginge nach einem Neuaufbau nur bis zum gezoomten Ausschnitt zurück
        if (this.chart) this.renderChart();
        resetBtn.style.display = 'none';
      });
    }

    // Reset Zoom button (Kosten/Rate chart)
    const resetRateBtn = document.getElementById('reset-zoom-rate-btn');
    if (resetRateBtn) {
      resetRateBtn.addEventListener('click', () => {
        if (this._rateChart) this._rateChart.resetZoom();
        resetRateBtn.style.display = 'none';
      });
    }
  }

  async switchPeriod(period) {
    this.currentPeriod = period;
    document.querySelectorAll('.stat-value span[id]').forEach(el => el.classList.add('loading-pulse'));

    await Promise.all([
      this.loadPeriodData(period),
      this.loadChartData(period),
    ]);

    document.querySelectorAll('.loading-pulse').forEach(el => el.classList.remove('loading-pulse'));
  }

  // ── Auto Refresh ──────────────────────────────────────────────

  startAutoRefresh() {
    // Clear any existing timers (prevent stacking)
    this._refreshTimers.forEach(id => clearInterval(id));
    this._refreshTimers = [];

    const interval = this.config.ui?.refreshInterval || 30000;
    this._refreshTimers.push(
      setInterval(() => {
        if (document.visibilityState === 'visible') this.loadCurrentPower();
      }, interval),
      setInterval(() => {
        if (document.visibilityState === 'visible') this.loadPeriodData(this.currentPeriod);
      }, 300000),
    );

    // Safari freezes/kills backgrounded pages (especially iframes).
    // visibilitychange may not fire inside iframes.
    // Heartbeat: runs every 10s. If >120s elapsed since last tick, page was frozen → reload.
    this._heartbeat = Date.now();
    this._refreshTimers.push(
      setInterval(() => {
        const now = Date.now();
        const gap = now - this._heartbeat;
        this._heartbeat = now;
        if (gap > 120000) {
          console.log('Page was frozen for ' + Math.round(gap / 1000) + 's, reloading...');
          location.reload();
        }
      }, 10000)
    );

    // Also try visibilitychange + pageshow as backup
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        document.body.classList.add('page-hidden');
      } else {
        document.body.classList.remove('page-hidden');
      }
    });
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) location.reload();
    });
  }

  // ── Helpers ───────────────────────────────────────────────────

  setEl(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = this.num(value);
  }

  // ── Sprache (i18n.js, Einstellung „Sprache“) ─────────────────
  t(text, vars) {
    return window.I18N ? window.I18N.t(text, vars) : text;
  }

  // Zahl als Text im Format der Sprache (Dezimalkomma bei Deutsch)
  num(value) {
    return window.I18N ? window.I18N.num(value) : String(value);
  }

  get locale() {
    return window.I18N ? window.I18N.locale() : 'de-DE';
  }

  // Achsenbeschriftung der Diagramme (date-fns): Deutsch numerisch, Englisch mit Monatsnamen
  get axisDay() {
    return this.locale === 'de-DE' ? 'dd.MM.' : 'dd MMM';
  }

  get axisMonth() {
    return this.locale === 'de-DE' ? 'MM.yyyy' : 'MMM yyyy';
  }

  formatNumber(v) {
    if (v == null || isNaN(v)) return '0.00';
    return v.toFixed(v >= 100 ? 1 : 2);
  }

  // Format energy value with automatic kWh/MWh unit
  formatEnergy(v) {
    if (v == null || isNaN(v) || v === 0) return { value: '0.00', unit: 'kWh' };
    if (Math.abs(v) >= 1000) {
      const mwh = v / 1000;
      return { value: mwh.toFixed(2), unit: 'MWh' };
    }
    return { value: v.toFixed(v >= 100 ? 1 : 2), unit: 'kWh' };
  }

  // ── Settings ──────────────────────────────────────────────────
  // Persisted server-side as one JSON blob via the integration's own
  // /api/ha_energy_dashboard/settings endpoint (custom_components/.../__init__.py).
  // No HA helpers required — avoids input_text's 255-char cap and any
  // per-instance helper setup.
  _settingsUrl = '/api/ha_energy_dashboard/settings';

  // Field mapping: form ID → config path
  _powerFields = [
    ['set-power-consumption', 'consumption'],
    ['set-power-production', 'production'],
    ['set-power-grid-import', 'grid_import'],
    ['set-power-grid-export', 'grid_export'],
    ['set-power-battery-charge', 'battery_charge'],
    ['set-power-battery-discharge', 'battery_discharge'],
  ];
  _otherFields = [
    ['set-cum-consumption', 'cum_consumption'],
    ['set-cum-consumption-detail', 'cum_consumption_detail'],
    ['set-cum-production', 'cum_production'],
    ['set-cum-grid-import', 'cum_grid_import'],
    ['set-cum-grid-export', 'cum_grid_export'],
    ['set-cum-battery-charge', 'cum_battery_charge'],
    ['set-cum-battery-discharge', 'cum_battery_discharge'],
    ['set-battery-soc', 'battery_soc'],
  ];
  // Field mapping: form ID → [category, period] into config.entities.energy
  _energyFields = [
    ['set-energy-consumption-daily', 'consumption', 'daily'],
    ['set-energy-consumption-weekly', 'consumption', 'weekly'],
    ['set-energy-consumption-monthly', 'consumption', 'monthly'],
    ['set-energy-consumption-yearly', 'consumption', 'yearly'],
    ['set-energy-production-daily', 'production', 'daily'],
    ['set-energy-production-weekly', 'production', 'weekly'],
    ['set-energy-production-monthly', 'production', 'monthly'],
    ['set-energy-production-yearly', 'production', 'yearly'],
    ['set-energy-grid-import-daily', 'grid_import', 'daily'],
    ['set-energy-grid-import-weekly', 'grid_import', 'weekly'],
    ['set-energy-grid-import-monthly', 'grid_import', 'monthly'],
    ['set-energy-grid-import-yearly', 'grid_import', 'yearly'],
    ['set-energy-grid-export-daily', 'grid_export', 'daily'],
    ['set-energy-grid-export-weekly', 'grid_export', 'weekly'],
    ['set-energy-grid-export-monthly', 'grid_export', 'monthly'],
    ['set-energy-grid-export-yearly', 'grid_export', 'yearly'],
    ['set-energy-battery-charge-daily', 'battery_charge', 'daily'],
    ['set-energy-battery-charge-weekly', 'battery_charge', 'weekly'],
    ['set-energy-battery-charge-monthly', 'battery_charge', 'monthly'],
    ['set-energy-battery-charge-yearly', 'battery_charge', 'yearly'],
    ['set-energy-battery-discharge-daily', 'battery_discharge', 'daily'],
    ['set-energy-battery-discharge-weekly', 'battery_discharge', 'weekly'],
    ['set-energy-battery-discharge-monthly', 'battery_discharge', 'monthly'],
    ['set-energy-battery-discharge-yearly', 'battery_discharge', 'yearly'],
  ];
  // Field mapping: form ID → key into config.entities.cost
  _costFields = [
    ['set-cost-daily', 'daily'],
    ['set-cost-weekly', 'weekly'],
    ['set-cost-monthly', 'monthly'],
    ['set-cost-yearly', 'yearly'],
    ['set-cost-rate', 'rate'],
    ['set-cost-compensation', 'compensation'],
  ];

  async loadSettings() {
    try {
      const saved = await this.fetchAPI(this._settingsUrl);
      const s = (saved && typeof saved === 'object') ? saved : {};

      if (!this.config.entities) this.config.entities = {};

      if (s.entities?.power) {
        this.config.entities.power = { ...(this.config.entities.power || {}), ...s.entities.power };
      }
      if (s.entities?.cumulative) {
        this.config.entities.cumulative = { ...(this.config.entities.cumulative || {}), ...s.entities.cumulative };
      }
      if (s.entities?.battery_soc) {
        this.config.entities.battery_soc = s.entities.battery_soc;
      }
      if (s.entities?.energy) {
        if (!this.config.entities.energy) this.config.entities.energy = {};
        for (const [cat, periods] of Object.entries(s.entities.energy)) {
          this.config.entities.energy[cat] = { ...(this.config.entities.energy[cat] || {}), ...periods };
        }
      }
      if (s.entities?.cost) {
        this.config.entities.cost = { ...(this.config.entities.cost || {}), ...s.entities.cost };
      }
      // Gas-/Wasserzähler, Außentemperatur, PV-Prognose
      if (s.entities?.gas) this.config.entities.gas = { ...(this.config.entities.gas || {}), ...s.entities.gas };
      if (s.entities?.water) this.config.entities.water = { ...(this.config.entities.water || {}), ...s.entities.water };
      if (Object.prototype.hasOwnProperty.call(s.entities || {}, 'forecast')) this.config.entities.forecast = s.entities.forecast;
      if (Object.prototype.hasOwnProperty.call(s, 'statsValidFrom')) this.config.statsValidFrom = s.statsValidFrom;
      // Feste Preise (Tarife)
      if (s.tariffs && typeof s.tariffs === 'object') this.config.tariffs = s.tariffs;
      // Dynamische Preis-Sensoren für Einspeisung und Gas (Strom: rateEntity weiter unten)
      for (const key of ['feedInEntity', 'gasRateEntity']) {
        if (Object.prototype.hasOwnProperty.call(s, key)) this.config[key] = s[key] || '';
      }

      // Numbers
      if (typeof s.refLimit === 'number' && s.refLimit > 0) this.config.refLimit = s.refLimit;
      if (typeof s.electricityRate === 'number' && s.electricityRate > 0) this.config.electricityRate = s.electricityRate;
      if (typeof s.feedInRate === 'number' && s.feedInRate >= 0) this.config.feedInRate = s.feedInRate;
      if (typeof s.baseFee === 'number' && s.baseFee >= 0) this.config.baseFee = s.baseFee;

      // Anzeige
      if (typeof s.ui?.refreshInterval === 'number' && s.ui.refreshInterval > 0) {
        if (!this.config.ui) this.config.ui = {};
        this.config.ui.refreshInterval = s.ui.refreshInterval;
      }
      // Darstellung: Logo-Farbe, Untertitel, erster Reiter, Reihenfolge der Kacheln
      for (const key of ['logoColor', 'logoSubtitle', 'logoLink', 'statOrder', 'hiddenStats', 'language']) {
        if (typeof s.ui?.[key] === 'string') {
          if (!this.config.ui) this.config.ui = {};
          this.config.ui[key] = s.ui[key];
        }
      }
      // Sprache der Oberfläche (i18n.js)
      if (window.I18N) window.I18N.lang = this.config.ui?.language === 'en' ? 'en' : 'de';

      // Wärmepumpe an/aus (default: an, außer explizit ausgeschaltet)
      this.config.heatpumpEnabled = s.heatpumpEnabled !== false;
      // Gas/Wasser an/aus (default: an; Reiter erscheint nur mit eingetragenem Zähler)
      this.config.gasEnabled = s.gasEnabled !== false;
      this.config.waterEnabled = s.waterEnabled !== false;
      // Tarife (überschreiben electricityRate/feedInRate/baseFee)
      try { await this.loadTarife(); } catch (e) { console.warn('Tarife load failed:', e.message); }

      // Rate entity mode: only touch config.js's rateEntity if Settings was
      // actually saved at least once (storage key present) — otherwise an
      // empty/never-saved storage would silently wipe a config.js default.
      if (Object.prototype.hasOwnProperty.call(s, 'rateEntity')) {
        this.config.rateEntity = s.rateEntity || '';
      }
      if (this.config.rateEntity) {
        const entityRate = await this.dynamicPriceEur(this.config.rateEntity);  // ct/kWh → EUR
        if (entityRate != null) this.config.electricityRate = entityRate;
      }
    } catch (e) {
      console.warn('Settings load failed, using config.js defaults:', e.message);
      if (this.config.heatpumpEnabled === undefined) this.config.heatpumpEnabled = true;
      if (this.config.gasEnabled === undefined) this.config.gasEnabled = true;
      if (this.config.waterEnabled === undefined) this.config.waterEnabled = true;
    }
  }

  populateSettingsForm() {
    const p = this.config.entities?.power || {};
    const c = this.config.entities?.cumulative || {};
    const e = this.config.entities?.energy || {};
    const co = this.config.entities?.cost || {};

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el && val !== undefined && val !== null && val !== '') el.value = val;
    };

    // Power sensors
    setVal('set-power-consumption', p.consumption);
    setVal('set-power-production', p.production);
    setVal('set-power-grid-import', p.grid_import);
    setVal('set-power-grid-export', p.grid_export);
    setVal('set-power-battery-charge', p.battery_charge);
    setVal('set-power-battery-discharge', p.battery_discharge);

    // Cumulative + battery
    setVal('set-cum-consumption', c.consumption);
    setVal('set-cum-consumption-detail', c.consumption_detail);
    setVal('set-cum-production', c.production);
    setVal('set-cum-grid-import', c.grid_import);
    setVal('set-cum-grid-export', c.grid_export);
    setVal('set-cum-battery-charge', c.battery_charge);
    setVal('set-cum-battery-discharge', c.battery_discharge);
    setVal('set-battery-soc', this.config.entities?.battery_soc);

    // Energy-Aggregate (Tag/Woche/Monat/Jahr pro Kategorie)
    for (const [id, cat, period] of this._energyFields) {
      setVal(id, e[cat]?.[period]);
    }

    // Kosten-Sensoren
    setVal('set-cost-daily', co.daily);
    setVal('set-cost-weekly', co.weekly);
    setVal('set-cost-monthly', co.monthly);
    setVal('set-cost-yearly', co.yearly);
    setVal('set-cost-rate', co.rate);
    setVal('set-cost-compensation', co.compensation);

    // Wärmepumpe an/aus
    const hpToggle = document.getElementById('set-heatpump-enabled');
    if (hpToggle) hpToggle.checked = this.config.heatpumpEnabled ?? true;
    const gasToggle = document.getElementById('set-gas-enabled');
    if (gasToggle) gasToggle.checked = this.config.gasEnabled ?? true;
    const waterToggle = document.getElementById('set-water-enabled');
    if (waterToggle) waterToggle.checked = this.config.waterEnabled ?? true;
    this.applyHeatpumpVisibility();
    this.populateTarifFields();

    // Gas, Wasser, PV-Prognose, Statistik gültig ab
    setVal('set-gas-meter', this.config.entities?.gas?.meter);
    setVal('set-gas-outdoor', this.config.entities?.gas?.outdoor);
    setVal('set-water-meter', this.config.entities?.water?.meter);
    setVal('set-forecast-entity', this.config.entities?.forecast);
    setVal('set-stats-valid-from', this.config.statsValidFrom);

    // Numbers
    setVal('set-ref-limit', this.config.refLimit ?? 5);
    setVal('set-electricity-rate', this.config.electricityRate ?? 0.30);
    setVal('set-feed-in-rate', this.config.feedInRate ?? 0.08);
    setVal('set-base-fee', this.config.baseFee ?? 0);
    setVal('set-refresh-interval', (this.config.ui?.refreshInterval ?? 30000) / 1000);

    // Darstellung
    setVal('set-logo-color', this.config.ui?.logoColor);
    setVal('set-logo-subtitle', this.config.ui?.logoSubtitle);
    setVal('set-logo-link', this.config.ui?.logoLink);
    setVal('set-language', this.config.ui?.language || 'de');
    this.populateStatOrderList();
    setVal('set-rate-entity-dyn', this.config.rateEntity || '');
    setVal('set-feed-in-entity', this.config.feedInEntity || '');
    setVal('set-gas-rate-entity', this.config.gasRateEntity || '');

    // Rate mode
    const hasEntity = this.config.rateEntity && this.config.rateEntity !== '';
    const modeSelect = document.getElementById('set-rate-mode');
    if (modeSelect) modeSelect.value = hasEntity ? 'entity' : 'fixed';
    setVal('set-rate-entity', this.config.rateEntity || '');
    this._updateRateModeUI();
  }

  _updateRateModeUI() {
    const mode = document.getElementById('set-rate-mode')?.value || 'fixed';
    const fixedInput = document.getElementById('set-electricity-rate');
    const entityWrap = document.querySelector('.rate-entity-wrap');
    if (fixedInput) fixedInput.style.display = mode === 'fixed' ? '' : 'none';
    if (entityWrap) entityWrap.style.display = mode === 'entity' ? '' : 'none';
  }

  applyHeatpumpVisibility() {
    const enabled = this.config.heatpumpEnabled ?? true;
    document.querySelectorAll('[data-feature="heatpump"]').forEach(el => {
      el.style.display = enabled ? '' : 'none';
    });
    if (!enabled && this.currentTab === 'heatpump') {
      document.querySelector('.nav-item[data-tab="dashboard"]')?.click();
    }

    // Gas und Wasser: gleiche Logik, nur mit eingetragenem Zähler
    const gasEnabled = this.isGasEnabled();
    document.querySelectorAll('[data-feature="gas"]').forEach(el => {
      el.style.display = gasEnabled ? '' : 'none';
    });
    if (!gasEnabled && this.currentTab === 'gas') {
      document.querySelector('.nav-item[data-tab="dashboard"]')?.click();
    }

    const waterEnabled = this.isWaterEnabled();
    document.querySelectorAll('[data-feature="water"]').forEach(el => {
      el.style.display = waterEnabled ? '' : 'none';
    });
    if (!waterEnabled && this.currentTab === 'water') {
      document.querySelector('.nav-item[data-tab="dashboard"]')?.click();
    }

    this.applyUiSettings();
  }

  // Darstellung aus den Einstellungen: Logo-Farbe, Untertitel, Reihenfolge der
  // Kacheln (data-stat). Leere Werte = Standard. Der erste Reiter heißt „Strom“,
  // sobald Gas oder Wasser angezeigt wird, sonst „Dashboard“.
  applyUiSettings() {
    if (window.I18N) window.I18N.apply();  // Texte aus index.html in der gewählten Sprache
    const ui = this.config.ui || {};
    // Akzentfarbe für Logo und aktiven Reiter (wie die Panels Heizung und Beregnung)
    if (ui.logoColor) document.documentElement.style.setProperty('--nav-accent', ui.logoColor);
    else document.documentElement.style.removeProperty('--nav-accent');
    const sub = document.getElementById('logo-subtitle');
    if (sub) {
      const text = ui.logoSubtitle === '-' ? '' : (ui.logoSubtitle || 'Dashboard');
      sub.textContent = text;
      sub.style.display = text ? '' : 'none';
    }
    const logo = document.getElementById('energy-logo');
    if (logo) {
      const link = safeLogoLink(ui.logoLink);
      logo.classList.toggle('logo-link', !!link);
      logo.title = link ? link : '';
      logo.onclick = link ? () => openLogoLink(link) : null;
    }
    const mainLabel = document.getElementById('nav-main-label');
    if (mainLabel) mainLabel.textContent = (this.isGasEnabled() || this.isWaterEnabled()) ? this.t('Strom') : 'Dashboard';

    const grid = document.getElementById('stats-grid');
    if (grid) {
      const userHidden = (ui.hiddenStats || '').split(',').map(s => s.trim());
      this.mergeHeatpumpTile((this.config.heatpumpEnabled ?? true) && !userHidden.includes('heatpump'));
      for (const key of this.getStatOrder()) {
        const el = grid.querySelector(`[data-stat="${key}"]`);
        if (el) grid.appendChild(el);
      }
      const hidden = this.getHiddenStats();
      for (const el of grid.querySelectorAll('[data-stat]')) {
        el.classList.toggle('stat-hidden', hidden.includes(el.dataset.stat));
      }
    }
  }

  // Mit Wärmepumpe: Verbrauch und Wärmepumpe in einer horizontal geteilten Kachel.
  // Die Elemente der Wärmepumpen-Kachel (ids bleiben gleich) wandern in die
  // untere Hälfte der Verbrauchs-Kachel und zurück.
  mergeHeatpumpTile(merge) {
    const grid = document.getElementById('stats-grid');
    const cons = grid?.querySelector('[data-stat="consumption"]');
    const hp = grid?.querySelector('[data-stat="heatpump"]');
    if (!cons || !hp) return;
    let half = cons.querySelector('.stat-half-hp');
    if (merge && !half) {
      // Überschrift „Verbrauch“ über die ganze Kachel, darunter zwei Zeilen
      // „Gesamt“ und „Wärme“ (Strom der Wärmepumpe, im Gesamtverbrauch enthalten)
      const total = document.createElement('span');
      total.className = 'stat-rowlabel';
      total.textContent = this.t('Gesamt');
      cons.querySelector('.stat-value')?.before(total);
      half = document.createElement('div');
      half.className = 'stat-half-hp';
      [...hp.children].forEach(c => half.appendChild(c));
      const hpLabel = document.createElement('span');
      hpLabel.className = 'stat-rowlabel';
      hpLabel.textContent = this.t('Wärme');
      half.querySelector('.stat-value')?.before(hpLabel);
      cons.appendChild(half);
    } else if (!merge && half) {
      cons.querySelectorAll('.stat-rowlabel').forEach(el => el.remove());
      [...half.children].forEach(c => hp.appendChild(c));
      half.remove();
    }
    cons.classList.toggle('stat-card-split', merge);
    hp.classList.toggle('stat-merged', merge);
  }

  // Ausgeblendete Kacheln (config.ui.hiddenStats, kommagetrennte Schlüssel);
  // die Wärmepumpe ist ohne eigenen Schalter Teil der Verbrauchs-Kachel
  getHiddenStats() {
    const hidden = (this.config.ui?.hiddenStats || '').split(',').map(s => s.trim()).filter(Boolean);
    if (document.querySelector('[data-stat="heatpump"].stat-merged')) hidden.push('heatpump');
    return hidden;
  }

  // Reihenfolge der Kacheln als Liste von data-stat-Schlüsseln. config.ui.statOrder
  // ist kommagetrennt und darf Schlüssel oder angezeigte Namen enthalten
  // (z. B. „Erzeugung, Einspeisung“); nicht genannte folgen in Standardreihenfolge.
  getStatOrder() {
    const grid = document.getElementById('stats-grid');
    if (!grid) return [];
    if (!this._defaultStatOrder) {
      this._defaultStatOrder = [...grid.querySelectorAll('[data-stat]')].map(el => el.dataset.stat);
    }
    const byName = {};
    for (const el of grid.querySelectorAll('[data-stat]')) {
      byName[el.dataset.stat.toLowerCase()] = el.dataset.stat;
      const label = el.querySelector('.stat-label')?.textContent.trim().toLowerCase();
      if (label) byName[label] = el.dataset.stat;
    }
    const wanted = (this.config.ui?.statOrder || '').split(',')
      .map(s => byName[s.trim().toLowerCase()]).filter(Boolean);
    return [...new Set([...wanted, ...this._defaultStatOrder])];
  }

  // Liste in den Einstellungen (Anzeige → Kacheln): Haken = anzeigen, ▲/▼ = Reihenfolge
  populateStatOrderList() {
    const list = document.getElementById('set-stat-order');
    const grid = document.getElementById('stats-grid');
    if (!list || !grid) return;
    const label = (key) => {
      const text = grid.querySelector(`[data-stat="${key}"] .stat-label`)?.textContent.trim() || key;
      return text.charAt(0) + text.slice(1).toLowerCase();  // „ERZEUGUNG“ → „Erzeugung“
    };
    const hidden = (this.config.ui?.hiddenStats || '').split(',').map(s => s.trim());
    list.innerHTML = '';
    const keys = this.getStatOrder().filter(k => k !== 'heatpump');
    keys.splice(keys.indexOf('consumption') + 1, 0, 'heatpump');  // direkt unter Verbrauch
    for (const key of keys) {
      const li = document.createElement('li');
      li.dataset.stat = key;
      li.classList.toggle('is-hidden', hidden.includes(key));
      const checkbox = `<input type="checkbox" ${hidden.includes(key) ? '' : 'checked'} aria-label="${this.t('anzeigen')}">`;
      if (key === 'heatpump') {
        // Teil der Verbrauchs-Kachel: nur ein-/ausblenden, keine eigene Position
        li.classList.add('is-sub');
        li.innerHTML = checkbox + `<span>${this.t('Wärmepumpe')} <small>(${this.t('untere Hälfte der Verbrauchs-Kachel')})</small></span>`;
      } else {
        li.innerHTML = checkbox + `<span>${label(key)}</span>` +
          `<button type="button" data-move="-1" aria-label="${this.t('nach oben')}">▲</button>` +
          `<button type="button" data-move="1" aria-label="${this.t('nach unten')}">▼</button>`;
      }
      list.appendChild(li);
    }
    const refresh = () => {
      // Die Wärmepumpe bleibt beim Verschieben direkt unter dem Verbrauch
      const hp = list.querySelector('li[data-stat="heatpump"]');
      const cons = list.querySelector('li[data-stat="consumption"]');
      if (hp && cons) cons.after(hp);
      const items = [...list.querySelectorAll('li:not(.is-sub)')];
      items.forEach((li, i) => {
        li.querySelector('[data-move="-1"]').disabled = i === 0;
        li.querySelector('[data-move="1"]').disabled = i === items.length - 1;
      });
      for (const li of list.children) li.classList.toggle('is-hidden', !li.querySelector('input').checked);
      // Wärmepumpe nur zeigen, solange „Wärmepumpe-Tab anzeigen“ eingeschaltet ist
      const hpToggle = document.getElementById('set-heatpump-enabled');
      if (hp) hp.style.display = (hpToggle ? hpToggle.checked : (this.config.heatpumpEnabled ?? true)) ? '' : 'none';
    };
    const hpToggle = document.getElementById('set-heatpump-enabled');
    if (hpToggle && !hpToggle._statListWired) {
      hpToggle.addEventListener('change', () => this._refreshStatOrderList?.());
      hpToggle._statListWired = true;
    }
    this._refreshStatOrderList = refresh;
    if (!list._wired) {
      list.addEventListener('click', (e) => {
        if (e.target.matches('input[type="checkbox"]')) { refresh(); return; }
        const btn = e.target.closest('button[data-move]');
        if (!btn) return;
        const li = btn.closest('li');
        // Nachbarn ohne den Unterpunkt Wärmepumpe
        const sibling = (el, dir) => {
          let s = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
          while (s && s.classList.contains('is-sub')) s = dir < 0 ? s.previousElementSibling : s.nextElementSibling;
          return s;
        };
        const prev = sibling(li, -1), next = sibling(li, 1);
        if (btn.dataset.move === '-1' && prev) list.insertBefore(li, prev);
        if (btn.dataset.move === '1' && next) next.after(li);
        refresh();
      });
      list._wired = true;
    }
    refresh();
  }

  async saveSettings() {
    const btn = document.getElementById('settings-save-btn');
    const status = document.getElementById('settings-status');
    btn.disabled = true;
    status.textContent = this.t('Speichere...');
    status.className = 'settings-status';

    try {
      const getVal = (id) => (document.getElementById(id)?.value || '').trim();

      // Power sensors
      const powerObj = {};
      for (const [id, key] of this._powerFields) {
        const v = getVal(id);
        if (v) powerObj[key] = v;
      }

      // Cumulative sensors + battery SoC (_otherFields keys are 'cum_x' / 'battery_soc')
      const cumulativeObj = {};
      let batterySoc = '';
      for (const [id, key] of this._otherFields) {
        const v = getVal(id);
        if (!v) continue;
        if (key === 'battery_soc') batterySoc = v;
        else cumulativeObj[key.replace('cum_', '')] = v;
      }

      // Energy-Aggregate (nested: Kategorie → Zeitraum)
      const energyObj = {};
      for (const [id, cat, period] of this._energyFields) {
        const v = getVal(id);
        if (v) {
          if (!energyObj[cat]) energyObj[cat] = {};
          energyObj[cat][period] = v;
        }
      }

      // Kosten-Sensoren
      const costObj = {};
      for (const [id, key] of this._costFields) {
        const v = getVal(id);
        if (v) costObj[key] = v;
      }

      const heatpumpEnabled = document.getElementById('set-heatpump-enabled')?.checked ?? true;
      const gasEnabled = document.getElementById('set-gas-enabled')?.checked ?? true;
      const waterEnabled = document.getElementById('set-water-enabled')?.checked ?? true;

      // Feste Preise aus dem Formular. Strompreis, Grundgebühr und Einspeisevergütung
      // daraus ableiten und zusätzlich in den bisherigen Feldern speichern
      // (Rückfall für ältere Versionen).
      const tariffs = this.readTarifFields();
      this.config.tariffs = tariffs;
      this.applyTariffs({ ...Object.fromEntries(this._tariffKeys.map(k => [k, 0])), ...tariffs });

      await this.fetchAPI(this._settingsUrl, {
        method: 'POST',
        body: JSON.stringify({
          entities: {
            power: powerObj,
            cumulative: cumulativeObj,
            battery_soc: batterySoc,
            energy: energyObj,
            cost: costObj,
            gas: { meter: getVal('set-gas-meter'), outdoor: getVal('set-gas-outdoor') },
            water: { meter: getVal('set-water-meter') },
            forecast: getVal('set-forecast-entity'),
          },
          refLimit: parseFloat(getVal('set-ref-limit')) || 5,
          electricityRate: this.config.electricityRate,
          feedInRate: this.config.feedInRate,
          baseFee: this.config.baseFee,
          rateEntity: getVal('set-rate-entity-dyn'),
          tariffs,
          feedInEntity: getVal('set-feed-in-entity'),
          gasRateEntity: getVal('set-gas-rate-entity'),
          statsValidFrom: getVal('set-stats-valid-from'),
          heatpumpEnabled,
          gasEnabled,
          waterEnabled,
          ui: {
            refreshInterval: (parseFloat(getVal('set-refresh-interval')) || 30) * 1000,
            logoColor: getVal('set-logo-color'),
            logoSubtitle: getVal('set-logo-subtitle'),
            logoLink: getVal('set-logo-link'),
            language: getVal('set-language') || 'de',
            statOrder: [...document.querySelectorAll('#set-stat-order li')].map(li => li.dataset.stat).join(', '),
            hiddenStats: [...document.querySelectorAll('#set-stat-order li')].filter(li => !li.querySelector('input').checked).map(li => li.dataset.stat).join(', '),
          },
        }),
      });

      // Update local config
      const langBefore = window.I18N?.lang;
      await this.loadSettings();
      if (window.I18N && window.I18N.lang !== langBefore) { location.reload(); return; }  // neue Sprache: neu aufbauen
      this.applyHeatpumpVisibility();
      this.startAutoRefresh();
      status.textContent = this.t('Gespeichert!');
    } catch (e) {
      console.error('Save settings failed:', e);
      status.textContent = this.t('Fehler:') + ' ' + e.message;
      status.className = 'settings-status error';
    } finally {
      btn.disabled = false;
      setTimeout(() => { status.textContent = ''; }, 4000);
    }
  }

  // ── Entity Autocomplete ──────────────────────────────────────

  async fetchAllEntities() {
    const now = Date.now();
    if (this._entityCache && (now - this._entityCacheTime) < 300000) {
      return this._entityCache;
    }
    if (this._entityFetchPending) return this._entityFetchPending;
    this._entityFetchPending = (async () => {
      try {
        const all = await this.fetchAPI('/api/states');
        this._entityCache = all
          .filter(e => e.entity_id.startsWith('sensor.'))
          .map(e => ({
            id: e.entity_id,
            name: e.attributes?.friendly_name || '',
          }));
        this._entityCacheTime = Date.now();
        return this._entityCache;
      } catch (e) {
        return this._entityCache || [];
      } finally {
        this._entityFetchPending = null;
      }
    })();
    return this._entityFetchPending;
  }

  initSettingsTab() {
    document.getElementById('settings-save-btn')?.addEventListener('click', () => this.saveSettings());
    document.getElementById('set-rate-mode')?.addEventListener('change', () => this._updateRateModeUI());

    document.querySelectorAll('.entity-search').forEach(input => {
      const list = input.parentElement.querySelector('.autocomplete-list');
      let selectedIdx = -1;
      let debounceTimer = null;

      const showResults = async (query) => {
        const q = query.toLowerCase();
        if (q.length < 2) { list.classList.remove('open'); return; }
        const entities = await this.fetchAllEntities();
        const filtered = entities
          .filter(e => e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
          .slice(0, 8);

        list.innerHTML = '';
        selectedIdx = -1;
        if (filtered.length === 0) { list.classList.remove('open'); return; }

        for (const e of filtered) {
          const div = document.createElement('div');
          div.className = 'autocomplete-item';
          div.innerHTML = `<span class="ac-id">${e.id}</span><span class="ac-name">${e.name}</span>`;
          div.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            input.value = e.id;
            list.classList.remove('open');
          });
          list.appendChild(div);
        }
        list.classList.add('open');
      };

      input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => showResults(input.value), 300);
      });
      input.addEventListener('blur', () => {
        setTimeout(() => list.classList.remove('open'), 150);
      });
      input.addEventListener('keydown', (e) => {
        const items = list.querySelectorAll('.autocomplete-item');
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
          items.forEach((it, i) => it.classList.toggle('selected', i === selectedIdx));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          selectedIdx = Math.max(selectedIdx - 1, 0);
          items.forEach((it, i) => it.classList.toggle('selected', i === selectedIdx));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (selectedIdx >= 0 && items[selectedIdx]) {
            input.value = items[selectedIdx].querySelector('.ac-id').textContent;
            list.classList.remove('open');
          }
        } else if (e.key === 'Escape') {
          list.classList.remove('open');
        }
      });
    });
  }

  getPeriodLabel(period) {
    if (period === 'custom' && this._customRange) {
      const fmt = (d) => d.toLocaleDateString(this.locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
      return `${fmt(this._customRange.start)} – ${fmt(this._customRange.end)}`;
    }
    return {
      yesterday: 'Gestern', today: 'Heute',
      this_week: 'Diese Woche', last_week: 'Letzte Woche',
      this_month: 'Dieser Monat', last_month: 'Letzter Monat',
      this_year: 'Dieses Jahr', last_year: 'Letztes Jahr',
    }[period] || period;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.dashboard = new EnergyDashboard();
});

// Logo-Link: nur HA-Pfade (/…, nicht //…) oder http(s)-Adressen, sonst '' (kein Link)
function safeLogoLink(value) {
  const link = typeof value === 'string' ? value.trim() : '';
  return /^\/(?!\/)/.test(link) || /^https?:\/\//i.test(link) ? link : '';
}

// HA-Pfade im HA-Frontend (Elternfenster) ohne Neuladen öffnen, volle Adressen im ganzen Fenster
function openLogoLink(value) {
  const link = safeLogoLink(value);
  if (!link) return;
  try {
    const top = window.parent;
    if (link.startsWith('/') && top !== window) {
      top.history.pushState(null, '', link);
      top.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
    } else {
      window.top.location.href = link;
    }
  } catch (e) {
    window.top.location.href = link;
  }
}

