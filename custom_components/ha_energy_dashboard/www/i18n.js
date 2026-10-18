// Übersetzungen des Dashboards (Einstellung „Sprache“ unter Anzeige).
//
// Schlüssel ist der Text, wie er in index.html oder app.js steht; der Wert
// enthält die Übersetzung je Sprache. Fehlt eine Sprache, bleibt der Text wie
// im Quelltext. Texte in index.html werden beim Laden ersetzt (Textknoten sowie
// placeholder, title, aria-label), Texte aus app.js laufen über t('…').
// Platzhalter in geschweiften Klammern: t('Gesamt: {v} kWh', { v: 3 }).
// Neue Texte: Eintrag ergänzen, sonst erscheinen sie in jeder Sprache wie im Quelltext.

window.I18N_TEXTS = {
  // ── Kopf, Reiter, Zeiträume ──
  'Home-Assistant-Menü': { en: 'Home Assistant menu' },
  'Strom': { en: 'Electricity' },
  'Wasser': { en: 'Water' },
  'Wärmepumpe': { en: 'Heat pump' },
  'Kosten': { en: 'Costs' },
  'Sensors': { de: 'Sensoren' },
  'Einstellungen': { en: 'Settings' },
  'Von': { en: 'From' },
  'Bis': { en: 'To' },
  'Anwenden': { en: 'Apply' },
  'Heute': { en: 'Today' },
  'Gestern': { en: 'Yesterday' },
  'Diese Woche': { en: 'This week' },
  'Letzte Woche': { en: 'Last week' },
  'Dieser Monat': { en: 'This month' },
  'Letzter Monat': { en: 'Last month' },
  'Dieses Jahr': { en: 'This year' },
  'Letztes Jahr': { en: 'Last year' },
  'Custom': { de: 'Zeitraum' },

  // ── Kacheln, Energiefluss, Kennzahlen ──
  'VERBRAUCH': { en: 'CONSUMPTION' },
  'ERZEUGUNG': { en: 'PRODUCTION' },
  'NETZBEZUG': { en: 'GRID IMPORT' },
  'EINSPEISUNG': { en: 'FEED-IN' },
  'EIGENVERBRAUCH': { en: 'SELF-CONSUMPTION' },
  'WÄRMEPUMPE': { en: 'HEAT PUMP' },
  'Energiefluss': { en: 'Energy flow' },
  'NETZ': { en: 'GRID' },
  'HAUS': { en: 'HOME' },
  'BATTERIE': { en: 'BATTERY' },
  'BATTERIE GELADEN': { en: 'BATTERY CHARGED' },
  'BATTERIE ENTLADEN': { en: 'BATTERY DISCHARGED' },
  'EXPORT': { de: 'EINSPEISUNG', en: 'EXPORT' },
  'IMPORT': { de: 'BEZUG', en: 'IMPORT' },
  'LADEN': { en: 'CHARGING' },
  'ENTLADEN': { en: 'DISCHARGING' },
  'Kennzahlen': { en: 'Key figures' },
  'Autarkiegrad': { en: 'Self-sufficiency' },
  'Eigenverbrauch': { en: 'Self-consumption' },
  'Batterie SoC': { en: 'Battery SoC' },
  'Stromkosten': { en: 'Electricity costs' },
  'Ersparnis': { en: 'Savings' },

  // ── Energieprofil ──
  'Energieprofil —': { en: 'Energy profile —' },
  '↩ Reset Zoom': { de: '↩ Zoom zurücksetzen' },
  'Scroll to zoom · Drag to pan · Key metrics update with visible range': {
    de: 'Scrollen zum Zoomen · Ziehen zum Verschieben · Kennzahlen folgen dem sichtbaren Bereich',
  },
  'Verbrauch': { en: 'Consumption' },
  'Erzeugung': { en: 'Production' },
  'PV-Prognose': { en: 'PV forecast' },
  'Prognose p10–p90': { en: 'Forecast p10–p90' },
  'Referenz-Limit': { en: 'Reference limit' },
  'kW, Tagesspitze': { en: 'kW, daily peak' },
  'kWh/Tag': { en: 'kWh/day' },
  'Lade Leistungsdaten…': { en: 'Loading power data…' },
  'Tag': { en: 'Day' },
  'Tage': { en: 'days' },
  '1 Tag': { en: '1 day' },

  // ── Sensoren-Reiter ──
  'Sensor-Übersicht': { en: 'Sensor overview' },
  'Kommt in einem zukünftigen Update.': { en: 'Coming in a future update.' },

  // ── Kosten ──
  'Kostenschaetzung —': { de: 'Kostenschätzung —', en: 'Cost estimate —' },
  'Einspeisung': { en: 'Feed-in' },
  'Netzbezug': { en: 'Grid import' },
  'Eigenverbrauch-Ersparnis': { en: 'Self-consumption savings' },
  'Gaskosten': { en: 'Gas costs' },
  'Wasserkosten': { en: 'Water costs' },
  'Zu zahlen gesamt': { en: 'Total to pay' },
  'Position': { en: 'Item' },
  'Menge': { en: 'Quantity' },
  'Tarif': { en: 'Rate' },
  'Betrag': { en: 'Amount' },
  'Gesamtverbrauch': { en: 'Total consumption' },
  'Grundgebuehr (anteilig)': { de: 'Grundgebühr (anteilig)', en: 'Base fee (pro rata)' },
  'Einspeisevergütung': { en: 'Feed-in tariff' },
  'Einspeisung ins Netz': { en: 'Feed-in to grid' },
  'Vermiedener Netzbezug': { en: 'Avoided grid import' },
  'Wärmepumpe gesamt': { en: 'Heat pump total' },
  'Heizen': { en: 'Heating' },
  'Warmwasser': { en: 'Hot water' },
  'Heizstab': { en: 'Heating element' },
  'Zu zahlen Strom (Netzbezug + Grundgebühr − Einspeisung)': { en: 'Electricity to pay (grid import + base fee − feed-in)' },
  'Gasverbrauch': { en: 'Gas consumption' },
  'Grundpreis Gas (anteilig)': { en: 'Gas base fee (pro rata)' },
  'Frischwasser': { en: 'Fresh water' },
  'Abwasser': { en: 'Wastewater' },
  'Grundpreis Wasser/Abwasser (anteilig)': { en: 'Water/wastewater base fee (pro rata)' },
  'Zu zahlen gesamt (Strom + Gas + Wasser)': { en: 'Total to pay (electricity + gas + water)' },
  'Solar-Gesamtwert': { en: 'Total solar value' },
  'Gesamt-Solarwert': { en: 'Total solar value' },
  'Schätzung auf Basis der konfigurierten Tarife. Tatsächliche Abrechnung kann abweichen.': {
    en: 'Estimate based on the configured rates. Actual billing may differ.',
  },
  '€/Monat': { en: '€/month' },
  'Intervalle ohne dyn. Preis': { en: 'intervals without dynamic price' },
  'kWh mit Fixpreis': { en: 'kWh at fixed price' },
  'berechnet': { en: 'calculated' },
  'Jetzt': { en: 'Now' },
  'Strompreis (ct/kWh)': { en: 'Electricity price (ct/kWh)' },
  'Verbrauch (kWh)': { en: 'Consumption (kWh)' },
  'Preis:': { en: 'Price:' },
  'Verbrauch:': { en: 'Consumption:' },
  'Keine dynamischen Preisdaten verfügbar': { en: 'No dynamic price data available' },

  // ── Gas, Wasser, Wärmepumpe ──
  'Gas —': { en: 'Gas —' },
  'Energie': { en: 'Energy' },
  '€ inkl. Grundpreis': { en: '€ incl. base fee' },
  'Ø pro Tag': { en: 'Ø per day' },
  'Verbrauch und Außentemperatur': { en: 'Consumption and outdoor temperature' },
  'Wasser —': { en: 'Water —' },
  'Liter/Tag': { en: 'litres/day' },
  'Kosten gesamt': { en: 'Total costs' },
  'Wärmepumpe —': { en: 'Heat pump —' },
  'Elektrisch': { en: 'Electrical' },
  'Thermisch': { en: 'Thermal' },
  'Aufschlüsselung': { en: 'Breakdown' },
  'Elektrischer Verbrauch': { en: 'Electrical consumption' },
  'Heizen (kWh)': { en: 'Heating (kWh)' },
  'Warmwasser (kWh)': { en: 'Hot water (kWh)' },
  'Gesamt: {v} kWh': { en: 'Total: {v} kWh' },
  'Außentemperatur (°C)': { en: 'Outdoor temperature (°C)' },
  'Umrechnung {f} kWh/m³ (Brennwert × Zustandszahl) · Arbeitspreis {p} ct/kWh · Grundpreis {g} €/Monat anteilig · gerechnet mit den aktuellen Preisen, auch für vergangene Zeiträume.': {
    en: 'Conversion {f} kWh/m³ (calorific value × correction factor) · energy price {p} ct/kWh · base fee {g} €/month pro rata · calculated with current prices, also for past periods.',
  },
  'Frischwasser {p} €/m³ + Grundpreis {g} €/Monat · Abwasser {a} €/m³ (nach Frischwasser-m³)': {
    en: 'Fresh water {p} €/m³ + base fee {g} €/month · wastewater {a} €/m³ (based on fresh water m³)',
  },
  ' + Grundpreis {g} €/Monat': { en: ' + base fee {g} €/month' },
  ' · Grundpreise anteilig · gerechnet mit den aktuellen Preisen.': {
    en: ' · base fees pro rata · calculated with current prices.',
  },

  // ── Einstellungen ──
  'Sensoren und Parameter konfigurieren. Werte werden in Home Assistant gespeichert und gelten fuer alle Geraete.': {
    de: 'Sensoren und Parameter konfigurieren. Werte werden in Home Assistant gespeichert und gelten für alle Geräte.',
    en: 'Configure sensors and parameters. Values are stored in Home Assistant and apply to all devices.',
  },
  'Leistungs-Sensoren (W)': { en: 'Power sensors (W)' },
  'Live-Hausverbrauch in Watt': { en: 'Live home consumption in watts' },
  'Live-PV-Erzeugung in Watt': { en: 'Live PV production in watts' },
  'Aktuell aus dem Netz bezogene Leistung in Watt': { en: 'Power currently drawn from the grid in watts' },
  'Aktuell ins Netz eingespeiste Leistung in Watt': { en: 'Power currently fed into the grid in watts' },
  'Erweitert: Batterie': { en: 'Advanced: battery' },
  'Batterie laden': { en: 'Battery charging' },
  'Aktuelle Ladeleistung der Batterie in Watt': { en: 'Current battery charging power in watts' },
  'Batterie entladen': { en: 'Battery discharging' },
  'Aktuelle Entladeleistung der Batterie in Watt': { en: 'Current battery discharging power in watts' },
  'Kumulative Energie-Sensoren (kWh)': { en: 'Cumulative energy sensors (kWh)' },
  'Verbrauch kWh': { en: 'Consumption kWh' },
  'Zaehlerstand Gesamtverbrauch (steigend, state_class total)': {
    de: 'Zählerstand Gesamtverbrauch (steigend, state_class total)',
    en: 'Total consumption meter reading (increasing, state_class total)',
  },
  'Erzeugung kWh': { en: 'Production kWh' },
  'Zaehlerstand PV-Gesamterzeugung': { de: 'Zählerstand PV-Gesamterzeugung', en: 'Total PV production meter reading' },
  'Netzbezug kWh': { en: 'Grid import kWh' },
  'Zaehlerstand Gesamt-Netzbezug': { de: 'Zählerstand Gesamt-Netzbezug', en: 'Total grid import meter reading' },
  'Einspeisung kWh': { en: 'Feed-in kWh' },
  'Zaehlerstand Gesamt-Einspeisung': { de: 'Zählerstand Gesamt-Einspeisung', en: 'Total feed-in meter reading' },
  'Erweitert: Batterie und Verbrauch fein': { en: 'Advanced: battery and fine consumption' },
  'Batterie geladen kWh': { en: 'Battery charged kWh' },
  'Zaehlerstand Gesamt-Ladung': { de: 'Zählerstand Gesamt-Ladung', en: 'Total charged meter reading' },
  'Batterie entladen kWh': { en: 'Battery discharged kWh' },
  'Zaehlerstand Gesamt-Entladung': { de: 'Zählerstand Gesamt-Entladung', en: 'Total discharged meter reading' },
  'Ladezustand der Batterie in Prozent': { en: 'Battery state of charge in percent' },
  'Verbrauch fein kWh': { en: 'Fine consumption kWh' },
  'Optional: direkt messender Zaehler fuer Balken bis 1 h; bei Luecken gilt der Eintrag darueber': {
    de: 'Optional: direkt messender Zähler für Balken bis 1 h; bei Lücken gilt der Eintrag darüber',
    en: 'Optional: directly measuring meter for bars up to 1 h; where it has gaps, the entry above is used',
  },
  'Tarife': { en: 'Rates' },
  'Feste Preise für Kennzahlen, Kostenseite, Gas und Wasser. Daraus legt die Integration auch die Kostensensoren in HA an (Stromkosten, Gaskosten, Wasserkosten gesamt, Einspeisevergütung) – z. B. für das HA-Energie-Dashboard. Die Sensor-Felder sind nur für dynamische Preise nötig.': {
    en: 'Fixed prices for key figures, cost page, gas and water. The integration also creates the cost sensors in HA from them (electricity, gas and water costs total, feed-in tariff), e.g. for the HA energy dashboard. The sensor fields are only needed for dynamic prices.',
  },
  'Arbeitspreis (ct/kWh)': { en: 'Energy price (ct/kWh)' },
  'Grundpreis (€/Monat)': { en: 'Base fee (€/month)' },
  'Anlagenleistung (kWp)': { en: 'System size (kWp)' },
  '0 = nur Vergütung bis Schwelle': { en: '0 = only the rate up to the threshold' },
  'Schwelle (kWp)': { en: 'Threshold (kWp)' },
  'Bis hier gilt der höhere Satz, darüber der niedrigere (EEG, anteilig nach Leistung)': {
    en: 'Up to here the higher rate applies, above it the lower one (EEG, pro rata by capacity)',
  },
  'Vergütung bis Schwelle (ct/kWh)': { en: 'Rate up to threshold (ct/kWh)' },
  'Vergütung über Schwelle (ct/kWh)': { en: 'Rate above threshold (ct/kWh)' },
  'Brennwert (kWh/m³)': { en: 'Calorific value (kWh/m³)' },
  'Steht auf der Gasrechnung': { en: 'Shown on the gas bill' },
  'Zustandszahl': { en: 'Correction factor' },
  'Frischwasser (€/m³)': { en: 'Fresh water (€/m³)' },
  'Grundpreis Wasser (€/Monat)': { en: 'Water base fee (€/month)' },
  'Abwasser (€/m³)': { en: 'Wastewater (€/m³)' },
  'Nach Frischwasser-m³': { en: 'Based on fresh water m³' },
  'Grundpreis Abwasser (€/Monat)': { en: 'Wastewater base fee (€/month)' },
  'Erweitert: dynamische Preise': { en: 'Advanced: dynamic prices' },
  'Dynamischer Strompreis (optional)': { en: 'Dynamic electricity price (optional)' },
  'Sensor in EUR/kWh oder ct/kWh (z.B. Tibber); ersetzt den Arbeitspreis oben': {
    en: 'Sensor in EUR/kWh or ct/kWh (e.g. Tibber); replaces the energy price above',
  },
  'Dynamische Vergütung (optional)': { en: 'Dynamic feed-in tariff (optional)' },
  'Sensor in EUR/kWh oder ct/kWh (z.B. Direktvermarktung); ersetzt die Vergütung oben': {
    en: 'Sensor in EUR/kWh or ct/kWh (e.g. direct marketing); replaces the feed-in rate above',
  },
  'Dynamischer Gaspreis (optional)': { en: 'Dynamic gas price (optional)' },
  'Sensor in EUR/kWh oder ct/kWh; ersetzt den Arbeitspreis oben': {
    en: 'Sensor in EUR/kWh or ct/kWh; replaces the energy price above',
  },
  'Gas-Tab anzeigen': { en: 'Show gas tab' },
  'Nur mit eingetragenem Zähler; ausgeschaltet auch nicht in den Kosten': {
    en: 'Only with a meter configured; when off, not included in costs',
  },
  'Gaszähler (m³)': { en: 'Gas meter (m³)' },
  'Zählerstand in m³ (steigend, mit Statistik); kWh über Brennwert × Zustandszahl': {
    en: 'Meter reading in m³ (increasing, with statistics); kWh via calorific value × correction factor',
  },
  'Wasser-Tab anzeigen': { en: 'Show water tab' },
  'Wasserzähler (m³)': { en: 'Water meter (m³)' },
  'Zählerstand in m³ (steigend, mit Statistik); Abwasser nach Frischwasser-m³': {
    en: 'Meter reading in m³ (increasing, with statistics); wastewater based on fresh water m³',
  },
  'Wärmepumpe-Tab anzeigen': { en: 'Show heat pump tab' },
  'Blendet Tab, Statistik-Karte und Flow-Knoten komplett aus': { en: 'Hides the tab, stat card and flow node completely' },
  'Sonstiges': { en: 'Miscellaneous' },
  'Referenz-Limit (kW)': { en: 'Reference limit (kW)' },
  'Netzbezug, ab dem eine Warnung erscheint': { en: 'Grid import above which a warning appears' },
  'Außentemperatur (optional)': { en: 'Outdoor temperature (optional)' },
  'Als Linie im Gas-Diagramm': { en: 'As a line in the gas chart' },
  'PV-Prognose (optional)': { en: 'PV forecast (optional)' },
  'Sensor mit Attribut forecast (15-min-Werte: datetime, watts, p10, p90), z.B. Helios Forecast; Linie im Energieprofil bei Heute': {
    en: 'Sensor with attribute forecast (15-min values: datetime, watts, p10, p90), e.g. Helios Forecast; line in the energy profile for Today',
  },
  'Erweitert: Statistik': { en: 'Advanced: statistics' },
  'Statistik gültig ab (optional)': { en: 'Statistics valid from (optional)' },
  'Frühere Zählerstände werden ignoriert, z.B. wenn die HA-Statistik anfangs stillstand oder sprang': {
    en: 'Earlier meter readings are ignored, e.g. if the HA statistics initially stalled or jumped',
  },
  'Anzeige': { en: 'Display' },
  'Sprache': { en: 'Language' },
  'Oberfläche und Namen der Kostensensoren in HA': { en: 'Interface and names of the cost sensors in HA' },
  'Aktualisierung (Sekunden)': { en: 'Refresh (seconds)' },
  'Wie oft die Live-Werte automatisch neu geladen werden': { en: 'How often live values are reloaded automatically' },
  'Akzentfarbe': { en: 'Accent colour' },
  'CSS-Farbe für Logo und aktiven Reiter, leer = Standard (blau)': { en: 'CSS colour for logo and active tab, empty = default (blue)' },
  'Untertitel': { en: 'Subtitle' },
  'Text neben „Energy“; leer lassen für „Dashboard“, „-“ blendet ihn aus': {
    en: 'Text next to “Energy”; leave empty for “Dashboard”, “-” hides it',
  },
  'Kacheln': { en: 'Tiles' },
  'Haken = anzeigen, ▲/▼ = Reihenfolge; gilt nach dem Speichern. Mit Wärmepumpe teilt sich die Verbrauchs-Kachel mit ihr.': {
    en: 'Tick = show, ▲/▼ = order; applies after saving. With a heat pump, the consumption tile is shared with it.',
  },
  'anzeigen': { en: 'show' },
  'untere Hälfte der Verbrauchs-Kachel': { en: 'lower half of the consumption tile' },
  'Gesamt': { en: 'Total' },
  'Wärme': { en: 'Heat pump' },
  'nach oben': { en: 'move up' },
  'nach unten': { en: 'move down' },
  'Energie-Aggregate (optional)': { en: 'Energy aggregates (optional)' },
  'Erweitert: Sensoren je Zeitraum': { en: 'Advanced: sensors per period' },
  'Optional. Werden fuer die Statistik-Karten der aktuellen Zeitraeume (Heute, Diese Woche, ...) genutzt. Ohne Eintrag wird aus den kumulativen Sensoren berechnet.': {
    de: 'Optional. Werden für die Statistik-Karten der aktuellen Zeiträume (Heute, Diese Woche, …) genutzt. Ohne Eintrag wird aus den kumulativen Sensoren berechnet.',
    en: 'Optional. Used for the stat cards of the current periods (Today, This week, …). Without an entry they are calculated from the cumulative sensors.',
  },
  'Optionale Summensensoren fuer den Verbrauch': { de: 'Optionale Summensensoren für den Verbrauch', en: 'Optional total sensors for consumption' },
  'Optionale Summensensoren fuer die Erzeugung': { de: 'Optionale Summensensoren für die Erzeugung', en: 'Optional total sensors for production' },
  'Optionale Summensensoren fuer den Netzbezug': { de: 'Optionale Summensensoren für den Netzbezug', en: 'Optional total sensors for grid import' },
  'Optionale Summensensoren fuer die Einspeisung': { de: 'Optionale Summensensoren für die Einspeisung', en: 'Optional total sensors for feed-in' },
  'Optionale Summensensoren fuer die Batterieladung': { de: 'Optionale Summensensoren für die Batterieladung', en: 'Optional total sensors for battery charging' },
  'Optionale Summensensoren fuer die Batterieentladung': { de: 'Optionale Summensensoren für die Batterieentladung', en: 'Optional total sensors for battery discharging' },
  'Woche': { en: 'Week' },
  'Monat': { en: 'Month' },
  'Jahr': { en: 'Year' },
  'Kosten-Sensoren (optional)': { en: 'Cost sensors (optional)' },
  'Erweitert: Kosten- und Preis-Sensoren': { en: 'Advanced: cost and price sensors' },
  'Optional. Absolute Kostensensoren (falls vorhanden) statt Berechnung aus Strompreis × Verbrauch.': {
    en: 'Optional. Absolute cost sensors (if available) instead of price × consumption.',
  },
  'Kosten Tag': { en: 'Costs day' },
  'Absolute Stromkosten heute statt Berechnung aus Strompreis x Verbrauch': {
    de: 'Absolute Stromkosten heute statt Berechnung aus Strompreis × Verbrauch',
    en: 'Absolute electricity costs today instead of price × consumption',
  },
  'Kosten Woche': { en: 'Costs week' },
  'Absolute Stromkosten diese Woche': { en: 'Absolute electricity costs this week' },
  'Kosten Monat': { en: 'Costs month' },
  'Absolute Stromkosten diesen Monat': { en: 'Absolute electricity costs this month' },
  'Kosten Jahr': { en: 'Costs year' },
  'Absolute Stromkosten dieses Jahr': { en: 'Absolute electricity costs this year' },
  'Strompreis-Sensor': { en: 'Electricity price sensor' },
  'Aktueller Preis fuer die Statistik-Karten, unabhaengig vom Tarif unten': {
    de: 'Aktueller Preis für die Statistik-Karten, unabhängig von den Tarifen',
    en: 'Current price for the stat cards, independent of the rates',
  },
  'Verguetungs-Sensor': { de: 'Vergütungs-Sensor', en: 'Feed-in tariff sensor' },
  'Aktuelle Einspeiseverguetung fuer die Statistik-Karten': {
    de: 'Aktuelle Einspeisevergütung für die Statistik-Karten',
    en: 'Current feed-in tariff for the stat cards',
  },
  'Speichern': { en: 'Save' },
  'Speichere...': { en: 'Saving...' },
  'Gespeichert!': { en: 'Saved!' },
  'Fehler:': { en: 'Error:' },
};

window.I18N = {
  lang: 'de',

  // Übersetzung eines Quelltexts, Platzhalter {name} aus vars
  t(text, vars) {
    let s = window.I18N_TEXTS[text]?.[this.lang] ?? text;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    return s;
  },

  locale() {
    return this.lang === 'en' ? 'en-GB' : 'de-DE';
  },

  // Zahl als Text im Format der Sprache (Dezimalkomma bei Deutsch)
  num(value) {
    const s = String(value);
    return this.lang === 'de' && /^[-+−]?\d+\.\d+$/.test(s) ? s.replace('.', ',') : s;
  },

  // Übersetzt Textknoten und Attribute unterhalb von root
  apply(root = document.body) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && !['SCRIPT', 'STYLE'].includes(n.parentElement.tagName)
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (node._i18nSrc === undefined) node._i18nSrc = node.nodeValue;
      const src = node._i18nSrc;
      const key = src.replace(/\s+/g, ' ').trim();
      if (!key || !window.I18N_TEXTS[key]) continue;
      const lead = src.match(/^\s*/)[0];
      const trail = src.match(/\s*$/)[0];
      node.nodeValue = lead + this.t(key) + trail;
    }
    for (const attr of ['placeholder', 'title', 'aria-label']) {
      for (const el of root.querySelectorAll(`[${attr}]`)) {
        const store = `i18n${attr.replace('-', '')}`;
        if (el.dataset[store] === undefined) el.dataset[store] = el.getAttribute(attr);
        const src = el.dataset[store];
        if (window.I18N_TEXTS[src]) el.setAttribute(attr, this.t(src));
      }
    }
    document.documentElement.lang = this.lang;
  },
};
