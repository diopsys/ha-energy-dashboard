"""HA Energy Dashboard — serves static dashboard files via HTTP."""
from pathlib import Path

from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.helpers.discovery import async_load_platform
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

DOMAIN = "ha_energy_dashboard"
WWW_PATH = "/ha-energy-dashboard"
STORAGE_VERSION = 1
STORAGE_KEY = "ha_energy_dashboard_settings"
# Wird nach dem Speichern der Einstellungen gesendet (Kostensensoren übernehmen
# neue Preise und Zähler sofort)
SIGNAL_SETTINGS_UPDATED = f"{DOMAIN}_settings_updated"


class EnergyDashboardSettingsView(HomeAssistantView):
    """Read/write the dashboard's Settings-tab config as one JSON blob."""

    url = "/api/ha_energy_dashboard/settings"
    name = "api:ha_energy_dashboard:settings"
    requires_auth = True

    def __init__(self, hass: HomeAssistant, store: Store) -> None:
        self._hass = hass
        self._store = store

    async def get(self, request):
        data = await self._store.async_load()
        return self.json(data or {})

    async def post(self, request):
        try:
            data = await request.json()
        except ValueError:
            return self.json_message("Invalid JSON", status_code=400)
        if not isinstance(data, dict):
            return self.json_message("Body must be a JSON object", status_code=400)
        await self._store.async_save(data)
        async_dispatcher_send(self._hass, SIGNAL_SETTINGS_UPDATED, data)
        return self.json({"success": True})


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    await hass.http.async_register_static_paths([
        StaticPathConfig(
            WWW_PATH,
            str(Path(__file__).parent / "www"),
            cache_headers=False,
        )
    ])

    store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    hass.data[DOMAIN] = {"store": store}
    hass.http.register_view(EnergyDashboardSettingsView(hass, store))

    # Kostensensoren (Strom, Gas, Wasser, Einspeisevergütung, Gasverbrauch kWh)
    hass.async_create_task(
        async_load_platform(hass, Platform.SENSOR, DOMAIN, {}, config)
    )

    return True
