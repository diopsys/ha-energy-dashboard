"""Kostensensoren des Energy Dashboards.

Die Preise kommen aus den Einstellungen des Dashboards (Reiter Einstellungen →
Tarife), die Zähler aus den dort eingetragenen Sensoren. Angelegt wird ein
Sensor, sobald sein Zähler eingetragen ist:

  Stromkosten gesamt    Netzbezug × Arbeitspreis + Grundpreis zeitanteilig (EUR)
  Gaskosten gesamt      m³ × Brennwert × Zustandszahl × Arbeitspreis + Grundpreis (EUR)
  Wasserkosten gesamt   m³ × (Frischwasser + Abwasser) + Grundpreise (EUR)
  Gasverbrauch gesamt   m³ × Brennwert × Zustandszahl (kWh)
  Einspeisevergütung    EEG-Mischpreis nach Leistung (EUR/kWh)

Die Kosten zählen fortlaufend:
  neue Summe = Summe + Verbrauch seit dem letzten gültigen Zählerstand × Arbeitspreis
                     + anteiliger Grundpreis seit der letzten Berechnung
Zählerrücksprung oder unavailable: kein Verbrauch, der Grundpreis läuft weiter
(über die verstrichene Zeit, deckt also auch HA-Ausfälle ab). Ist ein
dynamischer Preis-Sensor eingetragen, gilt dessen aktueller Wert.

Ohne gespeicherten Zustand (erster Start, oder Übernahme der Entitäts-ID eines
früheren Sensors) zählt der Sensor beim letzten Stand seiner Statistik weiter.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from homeassistant.components.sensor import (
    RestoreSensor,
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN, UnitOfEnergy
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.event import (
    async_track_state_change_event,
    async_track_time_change,
)
from homeassistant.util import dt as dt_util

from . import DOMAIN, SIGNAL_SETTINGS_UPDATED

_LOGGER = logging.getLogger(__name__)

SECONDS_PER_MONTH = 365.25 / 12 * 86400


# ── Hilfsfunktionen ────────────────────────────────────────────

def _signed_ids(value) -> list[tuple[str, int]]:
    """„sensor.a,sensor.b,-sensor.c“ → [(sensor.a, 1), (sensor.b, 1), (sensor.c, -1)]."""
    parts = [p.strip() for p in str(value or "").split(",") if p.strip()]
    return [(p[1:].strip(), -1) if p.startswith("-") else (p, 1) for p in parts]


def _float_state(hass: HomeAssistant, entity_id: str) -> float | None:
    state = hass.states.get(entity_id)
    if state is None or state.state in (STATE_UNKNOWN, STATE_UNAVAILABLE, ""):
        return None
    try:
        return float(state.state)
    except ValueError:
        return None


def _unit(hass: HomeAssistant, entity_id: str) -> str:
    state = hass.states.get(entity_id)
    return str(state.attributes.get("unit_of_measurement") or "") if state else ""


def _meter_value(hass: HomeAssistant, entity_ref) -> float | None:
    """Zählerstand, bei mehreren Entitäten vorzeichenrichtig summiert."""
    parts = _signed_ids(entity_ref)
    if not parts:
        return None
    total = 0.0
    for entity_id, sign in parts:
        value = _float_state(hass, entity_id)
        if value is None:
            return None
        total += sign * value
    return total


def _energy_scale(hass: HomeAssistant, entity_ref) -> float:
    """Umrechnung der Zählereinheit in kWh (Wh, kWh, MWh)."""
    parts = _signed_ids(entity_ref)
    unit = _unit(hass, parts[0][0]).lower() if parts else ""
    return {"wh": 0.001, "mwh": 1000.0}.get(unit, 1.0)


def _volume_scale(hass: HomeAssistant, entity_ref) -> float:
    """Umrechnung der Zählereinheit in m³ (L, m³)."""
    parts = _signed_ids(entity_ref)
    unit = _unit(hass, parts[0][0]).lower() if parts else ""
    return 0.001 if unit in ("l", "liter") else 1.0


def _dynamic_price_eur(hass: HomeAssistant, entity_id: str) -> float | None:
    """Aktueller Preis eines dynamischen Preis-Sensors in EUR je Einheit (ct → EUR)."""
    if not entity_id:
        return None
    value = _float_state(hass, entity_id)
    if value is None:
        return None
    return value / 100 if "ct" in _unit(hass, entity_id).lower() else value


def _tariff(settings: dict, key: str) -> float:
    try:
        return float((settings.get("tariffs") or {}).get(key) or 0)
    except (TypeError, ValueError):
        return 0.0


def _tariffs_or_legacy(settings: dict) -> dict:
    """Ohne gespeicherte Tarife: bisherige Felder Strompreis, Grundgebühr, Einspeisevergütung."""
    if settings.get("tariffs"):
        return settings
    return {
        **settings,
        "tariffs": {
            "strom_arbeitspreis": float(settings.get("electricityRate") or 0) * 100,
            "strom_grundpreis": float(settings.get("baseFee") or 0),
            "einspeisung_verguetung_bis_grenze": float(settings.get("feedInRate") or 0) * 100,
        },
    }


def feed_in_rate_eur(hass: HomeAssistant, settings: dict) -> float:
    """Einspeisevergütung in EUR/kWh: dynamischer Sensor oder EEG-Mischpreis nach Leistung."""
    dynamic = _dynamic_price_eur(hass, settings.get("feedInEntity") or "")
    if dynamic is not None:
        return dynamic
    anlage = _tariff(settings, "pv_anlagenleistung")
    grenze = _tariff(settings, "einspeisung_leistungsgrenze")
    satz1 = _tariff(settings, "einspeisung_verguetung_bis_grenze")
    satz2 = _tariff(settings, "einspeisung_verguetung_ueber_grenze")
    if anlage > 0 and anlage > grenze:
        return (grenze * satz1 + (anlage - grenze) * satz2) / anlage / 100
    return satz1 / 100


# ── Sensor-Arten ───────────────────────────────────────────────

class CostKind:
    """Beschreibt Quelle und Preise einer Kostenart."""

    key: str
    name: str

    def meter(self, settings: dict) -> str:
        raise NotImplementedError

    def amount_per_unit(self, hass: HomeAssistant, settings: dict) -> float:
        """EUR je Zählereinheit (Arbeitspreis inkl. Umrechnung)."""
        raise NotImplementedError

    def base_fee_month(self, settings: dict) -> float:
        raise NotImplementedError


class PowerCost(CostKind):
    key, name = "strom", "Stromkosten gesamt"

    def meter(self, settings):
        return ((settings.get("entities") or {}).get("cumulative") or {}).get("grid_import") or ""

    def amount_per_unit(self, hass, settings):
        price = _dynamic_price_eur(hass, settings.get("rateEntity") or "")
        if price is None:
            price = _tariff(settings, "strom_arbeitspreis") / 100
        return _energy_scale(hass, self.meter(settings)) * price

    def base_fee_month(self, settings):
        return _tariff(settings, "strom_grundpreis")


class GasCost(CostKind):
    key, name = "gas", "Gaskosten gesamt"

    def meter(self, settings):
        return ((settings.get("entities") or {}).get("gas") or {}).get("meter") or ""

    def amount_per_unit(self, hass, settings):
        kwh_per_m3 = _tariff(settings, "gas_brennwert") * _tariff(settings, "gas_zustandszahl")
        price = _dynamic_price_eur(hass, settings.get("gasRateEntity") or "")
        if price is None:
            price = _tariff(settings, "gas_arbeitspreis") / 100
        return _volume_scale(hass, self.meter(settings)) * kwh_per_m3 * price

    def base_fee_month(self, settings):
        return _tariff(settings, "gas_grundpreis")


class WaterCost(CostKind):
    key, name = "wasser", "Wasserkosten gesamt"

    def meter(self, settings):
        return ((settings.get("entities") or {}).get("water") or {}).get("meter") or ""

    def amount_per_unit(self, hass, settings):
        price = _tariff(settings, "wasser_preis") + _tariff(settings, "abwasser_preis")
        return _volume_scale(hass, self.meter(settings)) * price

    def base_fee_month(self, settings):
        return _tariff(settings, "wasser_grundpreis") + _tariff(settings, "abwasser_grundpreis")


COST_KINDS = (PowerCost(), GasCost(), WaterCost())


# ── Plattform ──────────────────────────────────────────────────

async def async_setup_platform(hass: HomeAssistant, config, async_add_entities, discovery_info=None):
    if discovery_info is None:
        return
    store = hass.data[DOMAIN]["store"]
    settings = _tariffs_or_legacy(await store.async_load() or {})
    created: set[str] = set()

    @callback
    def add_missing(new_settings: dict) -> None:
        """Legt Sensoren an, sobald ihr Zähler bzw. ihre Tarife eingetragen sind."""
        new_settings = _tariffs_or_legacy(new_settings)
        entities: list[SensorEntity] = []
        for kind in COST_KINDS:
            if kind.key not in created and kind.meter(new_settings):
                entities.append(EnergyCostSensor(hass, kind, new_settings))
                created.add(kind.key)
        if "gas_kwh" not in created and GasCost().meter(new_settings):
            entities.append(GasEnergySensor(hass, new_settings))
            created.add("gas_kwh")
        if "einspeisung" not in created and (
            _tariff(new_settings, "einspeisung_verguetung_bis_grenze") > 0 or new_settings.get("feedInEntity")
        ):
            entities.append(FeedInRateSensor(hass, new_settings))
            created.add("einspeisung")
        if entities:
            async_add_entities(entities)

    add_missing(settings)
    async_dispatcher_connect(hass, SIGNAL_SETTINGS_UPDATED, add_missing)


class _SettingsMixin:
    """Übernimmt neue Einstellungen und abonniert die beteiligten Entitäten neu."""

    _attr_should_poll = False

    def _watched_entities(self) -> list[str]:
        raise NotImplementedError

    def _resubscribe(self) -> None:
        if getattr(self, "_unsub_state", None):
            self._unsub_state()
        watched = [e for e in self._watched_entities() if e]
        self._unsub_state = (
            async_track_state_change_event(self.hass, watched, self._on_state_change) if watched else None
        )

    @callback
    def _on_settings(self, settings: dict) -> None:
        self._settings = _tariffs_or_legacy(settings)
        self._resubscribe()
        self._recalculate()

    @callback
    def _on_state_change(self, event: Event) -> None:
        self._recalculate()

    def _recalculate(self) -> None:
        raise NotImplementedError

    async def _async_setup_listeners(self) -> None:
        self._resubscribe()
        self.async_on_remove(lambda: self._unsub_state and self._unsub_state())
        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_SETTINGS_UPDATED, self._on_settings)
        )


class EnergyCostSensor(_SettingsMixin, RestoreSensor):
    """Fortlaufende Kosten in EUR (Arbeitspreis + zeitanteiliger Grundpreis)."""

    _attr_device_class = SensorDeviceClass.MONETARY
    _attr_state_class = SensorStateClass.TOTAL
    _attr_native_unit_of_measurement = "EUR"
    _attr_icon = "mdi:cash-minus"

    def __init__(self, hass: HomeAssistant, kind: CostKind, settings: dict) -> None:
        self.hass = hass
        self._kind = kind
        self._settings = settings
        self._attr_name = kind.name
        self._attr_unique_id = f"{DOMAIN}_{kind.key}_kosten"
        self._total: float | None = None
        self._meter_last: float | None = None
        self._time_last: datetime | None = None
        self._unsub_state = None

    @property
    def native_value(self):
        return None if self._total is None else round(self._total, 6)

    @property
    def available(self) -> bool:
        return bool(self._kind.meter(self._settings))

    @property
    def extra_state_attributes(self):
        return {
            "zaehlerstand": self._meter_last,
            "berechnet": self._time_last.isoformat() if self._time_last else None,
        }

    def _watched_entities(self):
        ids = [e for e, _ in _signed_ids(self._kind.meter(self._settings))]
        if isinstance(self._kind, PowerCost):
            ids.append(self._settings.get("rateEntity") or "")
        return ids

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        last = await self.async_get_last_sensor_data()
        last_state = await self.async_get_last_state()
        if last is not None and last.native_value is not None:
            self._total = float(last.native_value)
            attrs = last_state.attributes if last_state else {}
            meter = attrs.get("zaehlerstand")
            self._meter_last = float(meter) if meter is not None else None
            self._time_last = dt_util.parse_datetime(attrs.get("berechnet") or "")
        else:
            await self._async_continue_from_statistics()
        if self._total is None:
            self._total = 0.0
        await self._async_setup_listeners()
        # Grundpreis auch ohne Zähleränderung stündlich fortschreiben
        self.async_on_remove(
            async_track_time_change(self.hass, self._on_hour, minute=0, second=0)
        )
        self._recalculate()

    async def _async_continue_from_statistics(self) -> None:
        """Letzten Stand aus der Statistik derselben Entitäts-ID übernehmen."""
        try:
            from homeassistant.components.recorder import get_instance
            from homeassistant.components.recorder.statistics import get_last_short_term_statistics

            result = await get_instance(self.hass).async_add_executor_job(
                get_last_short_term_statistics, self.hass, 1, self.entity_id, True, {"state"}
            )
        except Exception as err:  # noqa: BLE001 – Recorder fehlt oder alte Schnittstelle
            _LOGGER.debug("Keine Statistik für %s: %s", self.entity_id, err)
            return
        rows = (result or {}).get(self.entity_id) or []
        if rows and rows[-1].get("state") is not None:
            row = rows[-1]
            self._total = float(row["state"])
            end = row.get("end") or (row.get("start", 0) + 300)
            self._time_last = dt_util.utc_from_timestamp(float(end))
            _LOGGER.info("%s zählt bei %.2f EUR aus der Statistik weiter", self.entity_id, self._total)

    @callback
    def _on_hour(self, now: datetime) -> None:
        self._recalculate()

    @callback
    def _recalculate(self) -> None:
        if self._total is None:
            return
        now = dt_util.utcnow()
        meter_ref = self._kind.meter(self._settings)
        meter_now = _meter_value(self.hass, meter_ref) if meter_ref else None
        if meter_now is not None and self._meter_last is not None and meter_now >= self._meter_last:
            self._total += (meter_now - self._meter_last) * self._kind.amount_per_unit(self.hass, self._settings)
        if meter_now is not None:
            self._meter_last = meter_now
        if self._time_last is not None:
            elapsed = max(0.0, (now - self._time_last).total_seconds())
            self._total += elapsed / SECONDS_PER_MONTH * self._kind.base_fee_month(self._settings)
        self._time_last = now
        self.async_write_ha_state()


class GasEnergySensor(_SettingsMixin, SensorEntity):
    """Gasverbrauch in kWh = m³ × Brennwert × Zustandszahl (für das Energie-Dashboard)."""

    _attr_device_class = SensorDeviceClass.ENERGY
    _attr_state_class = SensorStateClass.TOTAL_INCREASING
    _attr_native_unit_of_measurement = UnitOfEnergy.KILO_WATT_HOUR
    _attr_icon = "mdi:fire"
    _attr_name = "Gasverbrauch gesamt"
    _attr_unique_id = f"{DOMAIN}_gas_kwh"

    def __init__(self, hass: HomeAssistant, settings: dict) -> None:
        self.hass = hass
        self._settings = settings
        self._unsub_state = None
        self._attr_native_value = None

    def _meter(self) -> str:
        return GasCost().meter(self._settings)

    def _watched_entities(self):
        return [e for e, _ in _signed_ids(self._meter())]

    async def async_added_to_hass(self) -> None:
        await self._async_setup_listeners()
        self._recalculate()

    @callback
    def _recalculate(self) -> None:
        m3 = _meter_value(self.hass, self._meter())
        factor = _tariff(self._settings, "gas_brennwert") * _tariff(self._settings, "gas_zustandszahl")
        self._attr_available = m3 is not None and factor > 0
        if self._attr_available:
            self._attr_native_value = round(m3 * _volume_scale(self.hass, self._meter()) * factor, 2)
        self.async_write_ha_state()


class FeedInRateSensor(_SettingsMixin, SensorEntity):
    """Einspeisevergütung in EUR/kWh (für das Energie-Dashboard)."""

    _attr_native_unit_of_measurement = "EUR/kWh"
    _attr_icon = "mdi:cash-plus"
    _attr_name = "Einspeisevergütung"
    _attr_unique_id = f"{DOMAIN}_einspeiseverguetung"

    def __init__(self, hass: HomeAssistant, settings: dict) -> None:
        self.hass = hass
        self._settings = settings
        self._unsub_state = None
        self._attr_native_value = None

    def _watched_entities(self):
        return [self._settings.get("feedInEntity") or ""]

    async def async_added_to_hass(self) -> None:
        await self._async_setup_listeners()
        self._recalculate()

    @callback
    def _recalculate(self) -> None:
        self._attr_native_value = round(feed_in_rate_eur(self.hass, self._settings), 5)
        self.async_write_ha_state()
