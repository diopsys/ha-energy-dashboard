# Changelog

## [Unreleased]

### Added
- **Logo-Link** (Einstellungen → Darstellung): Tippen auf das Logo öffnet eine einstellbare Seite,
  z. B. die eigene HA-Startseite. HA-Pfade (`/…`) öffnen ohne Neuladen im HA-Frontend,
  volle Adressen (`https://…`) im ganzen Fenster; leer = wie bisher. Andere Angaben
  (z. B. `javascript:` oder `//host`) werden ignoriert.

### Changed
- **Kopfleiste schmal** (Handy, HA-App) wie bei den Panels Heizung und Beregnung: Logo oben,
  Reiter in einer eigenen Zeile darunter (nur Symbole, der aktive mit Namen). Der ☰-Knopf entfällt,
  das HA-Menü öffnet per Wischen vom linken Rand.

## [1.6.1] - 2026-10-18

### Fixed
- **Bug:** Preis-Diagramm auf der Kosten-Seite blieb leer bzw. brach beim Zeichnen ab
  (`TypeError: this.t is not a function`). Das `nowLine`-Chart.js-Plugin definierte
  `afterDraw(chart) {...}` als Objekt-Methode — Chart.js ruft das mit `this` = Plugin-Objekt auf,
  nicht die Dashboard-Instanz, wodurch die neue `this.t()`-Übersetzungsfunktion (aus 1.6.0) fehlte.
  Der übersetzte Text wird jetzt vor der Plugin-Definition aufgelöst, nicht mehr zur Zeichenzeit.

## [1.6.0] - 2026-10-18

### Added
- **Kostensensoren der Integration** (Plattform `sensor`, angelegt sobald der jeweilige Zähler eingetragen ist):
  `sensor.stromkosten_gesamt`, `sensor.gaskosten_gesamt`, `sensor.wasserkosten_gesamt` (EUR, fortlaufend:
  Verbrauch × Arbeitspreis + zeitanteiliger Grundpreis, auch über HA-Ausfälle), `sensor.einspeisevergutung`
  (EUR/kWh, EEG-Mischpreis) und `sensor.gasverbrauch_gesamt` (kWh = m³ × Brennwert × Zustandszahl) – direkt
  nutzbar im HA-Energie-Dashboard. Preise aus den Tarifen; nach dem Speichern der Einstellungen sofort aktiv.
  Ohne gespeicherten Zustand zählt ein Sensor beim letzten Stand seiner Statistik weiter, so lassen sich
  eigene Template-Kostensensoren mit derselben Entitäts-ID ohne Bruch ablösen.
- **Dynamische Preise** für Einspeisung und Gas (neben Strom), Einheit EUR/kWh oder ct/kWh wird erkannt.
- Einstellungen: Rubrik **Sonstiges** (Referenz-Limit, Außentemperatur, PV-Prognose, Statistik gültig ab),
  optionale Felder eingeklappt unter **Erweitert**, Kacheln als Liste mit Haken (ein-/ausblenden) und ▲/▼.
- **Sprachauswahl Deutsch/Englisch** (Anzeige → Sprache): Oberfläche, Diagramme, Kostenseite, Hinweistexte und
  Namen der Kostensensoren. Übersetzungen in `www/i18n.js` (Schlüssel = Text im Quelltext). Deutsch mit
  Dezimalkomma und numerischen Datumsachsen; bisher englische Texte („Sensors“, „Custom“, „Reset Zoom“,
  „EXPORT/IMPORT“) sind auf Deutsch übersetzt, Texte ohne Umlaute („fuer“, „Zaehlerstand“) korrigiert.
- **Verbrauch + Wärmepumpe in einer Kachel**: Mit aktivierter Wärmepumpe zeigt die Verbrauchs-Kachel „Gesamt“
  und darunter „Wärme“ (abschaltbar über den Haken), statt einer eigenen Wärmepumpen-Kachel.
- **Akzentfarbe** (früher „Logo-Farbe“) gilt für Logo und aktiven Reiter, wie bei anderen eigenen Panels.

### Changed
- **Tarife ohne `input_number`-Verknüpfung**: feste Preise in den Einstellungen, Sensoren nur noch für
  dynamische Preise. In 1.5.0 verknüpfte Werte stehen bereits in den Einstellungen und gelten weiter.
- Erster Reiter heißt „Strom“, sobald Gas oder Wasser angezeigt wird (Einstellung „Name erster Reiter“ entfällt).
- Entitätsfelder in den Einstellungen nutzen die volle Breite.

### Hinweis
- Wegen der neuen Sensor-Plattform braucht dieses Update einen **HA-Neustart**.

### Fixed
- **Bug:** Wärmepumpe-Tab zeigte bei Gestern/Woche/Monat/Jahr für "Heizen"/"Warmwasser" (Aufschlüsselung
  und Diagramm) nur ~0,00x kWh statt realistischer Werte — ein fest einprogrammiertes `/1000` ("Sensor in
  Wh → kWh") ging von Wh-Sensoren aus, die zugrunde liegenden Sensoren melden aber bereits in kWh. Nutzt
  jetzt wie alle anderen Energiewerte `getUnitScale()` zur automatischen Erkennung statt einer festen Annahme.
  Elektrisch/Thermisch oben waren von diesem speziellen Bug nicht betroffen (hatten die Division nie).
- **Bug:** Heizstab-Kachel zeigte bei Gestern/Woche/Monat/Jahr immer 0,00 kWh — die hinterlegten Sensoren
  (`sensor.warmepumpe_heizstab_gesamtverbrauch`/`_verbrauch_taglich`) existieren nicht mehr (404), sie wurden
  durch `sensor.wp_heizstab_energie_gesamt`/`_taglich` ersetzt. `_wpEntities` auf die neuen IDs umgestellt;
  die Zeitraum-Berechnung nutzt jetzt `counterRange()` (Differenz der Zählerstände) statt `change`-Summe,
  robust gegen Statistik-Sprünge.

### Added
- **Eigenes Icon/Logo** für HACS und die Integrationsliste in Home Assistant (`custom_components/ha_energy_dashboard/brand/`:
  `icon.png`, `icon@2x.png`, `logo.png`, `logo@2x.png`). Funktioniert ab HA 2026.3 automatisch, kein externer
  PR bei `home-assistant/brands` nötig (lokale Bilder haben seitdem Vorrang vor der Brands-CDN).

---

## [1.5.0] - 2026-10-18

### Added
- **Gas- und Wasser-Tab** mit eigenem Schalter: Verbrauch aus der Differenz der Zählerstände (robust gegen
  Lesefehler mit Rücksprung), Umrechnung m³ → kWh über Brennwert × Zustandszahl, Kosten inkl. anteiligem
  Grundpreis, Abwasser nach Frischwasser-m³, optional Außentemperatur im Gas-Diagramm. Zähler unter Einstellungen.
- **Tarife** in den Einstellungen (Strom, Einspeisung, Gas, Wasser/Abwasser), je Tarif optional mit einer
  `input_number` verknüpft. Einspeisevergütung als EEG-Mischpreis nach Leistung (Schwelle, z.B. 10 kWp).
  Ohne gespeicherte Tarife werden Strompreis, Grundgebühr und Einspeisevergütung übernommen.
- **Kostenseite** mit Gas und Wasser, „Zu zahlen gesamt“ = Strom + Gas + Wasser; Kacheln 2 × 3.
- **PV-Prognose** im Energieprofil bei „Heute“ (gestrichelte Linie, optional p10–p90-Band), Sensor unter Einstellungen.
- **Zoom-abhängige Auflösung** im Energieprofil: Tag → Stunde → 30/15/10/5 min, je nach sichtbarem Zeitraum
  (unter 1 h aus der 5-min-Statistik, die HA 10 Tage hält).
- **kW-Ansicht über 14 Tage**: je Tag die Tagesspitze (höchste Stundenleistung) statt Tagesmittel.
- **Kachel Netzbezug**; Reihenfolge der Kacheln, Logo-Farbe, Untertitel und Name des ersten Reiters einstellbar.
- **Batterie-Gesamtzähler** (geladen/entladen) unter den kumulativen Sensoren.
- **Mehrere Entitäten je kumulativem Sensor** (`a,b,-c`), z.B. Erzeugung = MPPT1 + MPPT2.
- **„Verbrauch fein“**: direkt messender Verbrauchszähler für Balken bis 1 h (bei Lücken gilt der Hauptzähler).
- **„Statistik gültig ab“**: Zählerstände vor diesem Zeitpunkt werden ignoriert.
- **☰-Knopf** öffnet in schmaler Ansicht (HA-App) das HA-Menü.

### Fixed
- **Laufende Zeiträume ohne Aggregat-Sensoren** zeigten nichts, obwohl der Hinweis „Ohne Eintrag wird aus den
  kumulativen Sensoren berechnet“ das versprach. Heute/Woche/Monat/Jahr werden jetzt aus den Gesamtzählern berechnet
  (aktueller Stand minus Stand zu Periodenbeginn).
- **Sprünge in der Statistik**: Energiemengen (Kennzahlen, Diagramme) als Differenz der Zählerstände statt Summe der
  `change`-Werte. Diese springen, wenn HA die Summen neu aufsetzt (z.B. Statistik-Import: +46.864 kWh in 5 min).
- **Batterie bei Woche/Monat** zeigte nur den stärksten Tag (Maximum des Tageszählers).
- **kW-Ansicht bei langen Zeiträumen** 1000-fach zu hoch bei Wh-Zählern (fehlende Umrechnung).
- **Eigenverbrauch größer als Verbrauch** bei Anlagen mit Batterie: jetzt Verbrauch − Netzbezug
  (vorher Erzeugung − Einspeisung, inkl. Batterieladung).
- **Ersparnis immer 0 €** ohne Strompreis-Sensor: es gilt der Tarif, ein eingetragener Kosten-Sensor hat Vorrang.
- **„invalid redirect uri“ in der iPhone-App**: Anmeldung über das Token des HA-Frontends im Elternfenster.
- **Browser-Cache**: `panel.js` lädt `index.html` mit Zeitstempel, Änderungen sind nach einem Update sofort sichtbar.
- „1 Tage“ → „1 Tag“.

---

## [1.4.3] - 2026-09-15

### Fixed
- **Bug:** Vergangene Zeiträume (Gestern, Letzte Woche, Letzter Monat, Letztes Jahr) zeigten absurd
  hohe Werte im MWh-Bereich statt kWh, wenn der konfigurierte kumulative Sensor tatsächlich in `Wh`
  statt `kWh` meldet (bei einigen Integrationen/Geräten der Fall) — die HA-Statistik-"change"-Werte
  wurden ungeprüft als kWh interpretiert. Neue `getUnitScale()`-Methode liest die tatsächliche
  `unit_of_measurement` des Sensors und normalisiert automatisch (`Wh` → ÷1000, `MWh` → ×1000).
  Betrifft `loadPeriodFromHistory()` (Stat-Karten für vergangene Zeiträume) und `loadChartData()`
  (Verbrauchs-/Erzeugungs-Chart).

---

## [1.4.2] - 2026-09-15

### Fixed
- **Bug:** `loadSettings()` hat `rateEntity` (Strompreis-Sensor fuer dynamische Tarife) bei jedem
  Laden bedingungslos ueberschrieben, auch wenn im Storage noch nichts gespeichert war — dadurch
  fiel die Anzeige nach dem Umbau auf v1.4.0 auf "Fester Wert" zurueck, obwohl ein Sensor konfiguriert
  war. Wird jetzt wie alle anderen Felder nur ueberschrieben, wenn der Storage-Key tatsaechlich gesetzt ist.
- `setVal()` in `populateSettingsForm()` liess Zahlenfelder mit Wert `0` leer (truthy-Check statt
  Praesenz-Check) — betraf z.B. eine Grundgebuehr von 0 EUR.
- Waermepumpe-Toggle wurde durch eine zu allgemeine CSS-Regel (`.settings-field label`, die auch den
  Toggle-Wrapper traf, da er zufaellig ebenfalls ein `<label>` ist) auf 160px Breite gezogen statt 42px.

### Added
- Kurze Beschreibung unter jedem Feld/jeder Sensor-Gruppe in den Einstellungen.

### Data-Loss-Hinweis
- Beim Aufraeumen der 38 alten Helper in v1.4.0 wurden `Grundgebuehr` und `Strompreis-Entitaet`
  (die kein `config.js`-Aequivalent haben) mitgeloescht, ohne vorher migriert zu werden. Werte
  liessen sich ueber die HA-Historie der geloeschten Entities rekonstruieren, muessen aber einmalig
  ueber die Einstellungen-Seite neu eingetragen werden.

---

## [1.4.1] - 2026-09-15

### Added
- Aktualisierungsintervall (bisher nur in `config.js` als `ui.refreshInterval`) jetzt in den
  Einstellungen editierbar (Sekunden, wirkt sofort nach dem Speichern ohne Reload).

### Note
- `ui.animationSpeed`, `ui.chartHeight` und `ui.locale` bleiben vorerst nur in `config.js`
  dokumentiert — sie werden im Code aktuell gar nicht ausgelesen, wären also totes UI gewesen.

---

## [1.4.0] - 2026-09-15

### Changed
- Einstellungen-Persistenz komplett auf einen eigenen Backend-Endpunkt umgestellt
  (`/api/ha_energy_dashboard/settings`, JSON-Datei über HA's `Store`-Helper) statt HA-Helper-Entities.
  Alle 38 `energyboard_*`-Helper (7 aus v1.2.x + 31 aus v1.3.0) entfallen ersatzlos — die
  Einstellungen-Seite funktioniert direkt nach der Installation, ohne jegliches Setup.
- Grund: `input_text` ist bei HA auf 255 Zeichen begrenzt, zu wenig für die kombinierten
  Energie-/Kosten-Entity-IDs aus v1.3.0.

### Setup
- Da der neue Endpunkt Teil des Python-Backends ist, braucht dieses Update (anders als reine
  HTML/CSS/JS-Änderungen) einen **HA-Neustart**.
- Bereits über v1.3.0 angelegte `energyboard_*`-Helper können danach gelöscht werden — sie werden
  nicht mehr gelesen.

---

## [1.3.0] - 2026-09-15

### Added
- Wärmepumpe-Tab per Schalter in den Einstellungen ein-/ausschaltbar (Tab, Stat-Karte und
  Flow-Diagramm-Knoten werden ausgeblendet, keine Anfragen mehr an nicht vorhandene Sensoren).
- Energie-Aggregate (Tag/Woche/Monat/Jahr, 6 Kategorien) und Kosten-Sensoren (Tag/Woche/Monat/Jahr,
  Strompreis- und Vergütungs-Sensor) jetzt über die Einstellungen-Seite konfigurierbar statt nur
  per Hand in `config.js`.

---

## [1.2.1] - 2026-08-13

### Fixed
- Panel-Inhalt wurde nach einem HA-Core-Update oben abgeschnitten (iframe kollabierte auf Mini-Höhe,
  da `height: 100%` nicht mehr zuverlässig durch den HA-Panel-Container vererbt wurde).
  `panel.js` misst die Höhe jetzt per JS (`getBoundingClientRect`/`resize`) statt sich auf CSS-Vererbung zu verlassen.

---

## [1.2.0] - 2026-03-17

### Fixed
- `config.js` wird nicht mehr aus dem HACS-Ordner geladen (würde bei Updates gelöscht).
  Konfiguration liegt jetzt dauerhaft in `/config/www/ha-energy-dashboard-config.js`.

---

## [1.1.0] - 2026-03-17

### Added
- Reset Zoom Button im Kosten-Tab (Rate Chart)

### Fixed
- HACS Integration-Typ statt Plugin (alle Dateien werden korrekt installiert)
- Kompatibilität mit HA 2026.x (`async_register_static_paths`)

---

## [1.0.0] - 2026-03-17

### Added
- Initiale Version
- Energy Flow Diagramm mit Solar, Batterie, Netz, Haus
- Zeiträume: Heute, Gestern, Diese Woche, Letzter Monat, Dieses Jahr, Benutzerdefiniert
- Statistik-Karten mit Verbrauch, Erzeugung, Einspeisung, Eigenverbrauch
- Wärmepumpe-Tab mit COP, Heizen/Warmwasser-Aufschlüsselung
- Kosten-Tab mit dynamischem Strompreis-Chart
- Interaktive Charts mit Zoom & Pan
- HACS-kompatibel
