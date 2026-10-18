# HA Energy Dashboard

Ein vollständiges Energie-Dashboard für Home Assistant mit Solar, Batterie, Netz und Wärmepumpe.

![Dashboard](preview.html)

## Features

- **Energy Flow** – Animiertes Echtzeit-Diagramm mit Haus, Solar, Netz und Batterie
- **Zeiträume** – Gestern, diese Woche, letzter Monat, dieses Jahr, benutzerdefiniert
- **Statistik-Karten** – Verbrauch, Erzeugung, Einspeisung, Eigenverbrauch, Autarkiegrad
- **Wärmepumpe-Tab** – COP, thermische Energie, Heizen/Warmwasser-Aufschlüsselung
- **Interaktive Charts** – Balken- und Liniendiagramme mit Zoom; beim Hineinzoomen feinere Balken (Tag → Stunde → 30/15/10/5 min)
- **Kosten** – Stromkosten mit dynamischem oder festem Tarif, Grundpreis, EEG-Mischpreis für Anlagen über 10 kWp
- **Gas- und Wasser-Tab** (optional) – Verbrauch aus dem Zählerstand, Kosten inkl. Grundpreis und Abwasser, Außentemperatur
- **PV-Prognose** (optional) – Prognose-Linie im Energieprofil, z.B. aus Helios Forecast
- **HA-App** – Anmeldung über das HA-Frontend (auch in der iPhone-App) und ☰-Knopf für das HA-Menü

---

## Installation via HACS

### Voraussetzungen

- [HACS](https://hacs.xyz/) installiert
- Home Assistant 2023.1 oder neuer

### Schritt 1: Repository hinzufügen

1. HACS öffnen → drei Punkte oben rechts → **Eigene Repositories** (Custom repositories)
2. URL eintragen: `https://github.com/gorbi87/ha-energy-dashboard`
3. Kategorie: **Integration** (nicht Plugin — das Dashboard wird als HACS-Integration installiert,
   weil es einen eigenen Python-Backend-Teil mitbringt)
4. **Hinzufügen** klicken

### Schritt 2: Installieren

1. In HACS nach **HA Energy Dashboard** suchen → **Download**
2. HACS installiert die Dateien nach `/config/custom_components/ha_energy_dashboard/`

### Schritt 3: Panel registrieren

In `/config/configuration.yaml` eintragen:

```yaml
ha_energy_dashboard:

panel_custom:
  - name: energy-panel
    sidebar_title: Energie
    sidebar_icon: mdi:solar-power-variant
    module_url: /ha-energy-dashboard/panel.js
    embed_iframe: false
    require_admin: false
```

Die leere `ha_energy_dashboard:`-Zeile ist nötig, damit HA die Integration überhaupt lädt (registriert
die statischen Dateien unter `/ha-energy-dashboard/` sowie den Settings-API-Endpunkt) — der
`panel_custom`-Block bindet sie dann als eigenen Sidebar-Eintrag ein.

**Danach Home Assistant neu starten.** In der Sidebar erscheint ein neuer Punkt "Energie".

### Schritt 4 (optional): `config.js` anlegen

Nur nötig, falls du den Access Token oder die UI-Optionen (`refreshInterval` u.ä.) setzen willst —
Sensoren selbst lassen sich seit v1.3.0 komplett über die **Einstellungen-Seite im Dashboard** eintragen,
ganz ohne Datei-Zugriff (siehe unten).

```bash
# Via SSH oder File Editor:
cp /config/custom_components/ha_energy_dashboard/www/config.example.js \
   /config/www/ha-energy-dashboard-config.js
```

Dann `/config/www/ha-energy-dashboard-config.js` mit den eigenen Werten befüllen (siehe unten).

> **Wichtig:** Die Konfiguration liegt in `/config/www/` — dieser Ordner wird von HACS nie angefasst, die Datei bleibt bei jedem Update erhalten.

---

## Konfiguration

### Long-Lived Access Token

1. HA Profil → **Sicherheit** → **Langlebige Zugriffstoken** → **Token erstellen**
2. Token in `config.js` bei `accessToken` eintragen

### Entity-IDs

`config.js` enthält alle nötigen Sensor-Zuordnungen. Die wichtigsten:

```javascript
entities: {
  power: {
    consumption:       'sensor.DEIN_VERBRAUCH_W',        // Watt
    production:        'sensor.DEINE_PV_LEISTUNG_W',     // Watt
    grid_import:       'sensor.DEIN_NETZBEZUG_W',        // Watt
    grid_export:       'sensor.DEINE_EINSPEISUNG_W',     // Watt
    battery_charge:    'sensor.DEINE_BATTERIE_LADEN_W',  // Watt (optional)
    battery_discharge: 'sensor.DEINE_BATTERIE_ENTLADEN_W', // Watt (optional)
  },
  cumulative: {
    consumption: 'sensor.VERBRAUCH_GESAMT_KWH',   // kWh, state_class: total
    production:  'sensor.PV_GESAMT_KWH',
    grid_import: 'sensor.NETZBEZUG_GESAMT_KWH',
    grid_export: 'sensor.EINSPEISUNG_GESAMT_KWH',
  },
  // ... weitere Sensoren in config.example.js dokumentiert
}
```

Die vollständige Konfiguration mit allen Optionen ist in `config.example.js` dokumentiert.

---

## Einstellungen-Seite

Alternativ zu `config.js` lassen sich alle Sensoren, Tarife und der Wärmepumpe-Schalter auch direkt im Dashboard unter **Einstellungen** eintragen — praktisch, wenn man das Dashboard auf einer zweiten HA-Instanz (z.B. bei Familie/Freunden) einrichtet, ohne Dateien anzufassen. Es sind keine HA-Helper oder sonstige Vorbereitung nötig: Die Integration bringt dafür einen eigenen kleinen API-Endpunkt (`/api/ha_energy_dashboard/settings`) mit, der die Einstellungen serverseitig als JSON speichert.

Im Dashboard unter **Einstellungen**:
- Sensoren eintragen (Leistung, kumulative Energie, Energie-Aggregate, Kosten) — Tippen zeigt eine Autocomplete-Liste passender HA-Entities
- **Wärmepumpe-Tab anzeigen** ausschalten, falls keine Wärmepumpe vorhanden ist (blendet Tab, Stat-Karte und Flow-Diagramm-Knoten aus)
- **Tarife**: Arbeits- und Grundpreis für Strom, Gas und Wasser/Abwasser, Gas-Brennwert und Zustandszahl,
  Einspeisevergütung mit Schwelle (EEG-Mischpreis nach Leistung). Jeder Tarif ist eine Zahl in den Einstellungen
  oder optional live mit einer `input_number` verknüpft — dann schreibt das Panel Änderungen dorthin, sodass auch
  Kostensensoren in HA dieselben Preise nutzen. Für dynamische Tarife (z.B. Tibber) gibt es ein Sensor-Feld.
- **Gas / Wasser**: Zählerstand in m³ (mit Statistik) eintragen, optional Außentemperatur. Ohne Zähler bleibt der Tab ausgeblendet.
- **Prognose & Statistik**: Sensor mit PV-Prognose (Attribut `forecast` mit 15-min-Werten `datetime`, `watts`, `p10`, `p90`)
  und „Statistik gültig ab“, falls die HA-Statistik anfangs fehlerhafte Zählerstände enthält.
- **Anzeige**: Logo-Farbe, Untertitel (`-` blendet ihn aus), Name des ersten Reiters, Reihenfolge der Kacheln
- **Speichern** klicken

Kumulative Sensoren dürfen mehrere Entitäten enthalten, die addiert bzw. mit `-` abgezogen werden,
z.B. `sensor.mppt1,sensor.mppt2` oder `sensor.ac_energie,sensor.bezug,-sensor.einspeisung`. Optional gibt es
„Verbrauch fein“: ein direkt messender Zähler, der für Balken bis 1 h genutzt wird. Energiemengen werden als
Differenz der Zählerstände berechnet, nicht aus den `change`-Werten der Statistik — die springen, wenn HA die
Summen neu aufsetzt (z.B. nach einem Statistik-Import).

Werte, die hier eingetragen werden, überschreiben die Defaults aus `config.js`. Leer gelassene Felder fallen auf `config.js` zurück.

> Die Wärmepumpe selbst (13 Daikin-Sensoren) ist aktuell nur über den Schalter ein-/ausschaltbar, die Sensor-Zuordnung ist noch fest in `app.js` (`_wpEntities`) verdrahtet — für eine andere Wärmepumpen-Marke müsste das noch konfigurierbar gemacht werden.
>
> Da der Endpunkt Teil des Python-Backends ist (`custom_components/ha_energy_dashboard/__init__.py`), braucht ein Update dieses Teils — anders als reine HTML/CSS/JS-Änderungen — einen **HA-Neustart** (HACS zeigt das nach dem Update an).

---

## Updates

Updates werden in HACS unter **Updates verfügbar** angezeigt und können dort direkt installiert werden. Die eigene `config.js` bleibt dabei erhalten.

---

## Lizenz

MIT License
