# Kegmaster KS-1 → Home Assistant integration

![plot](/2kegs.png)

Integrates the Kegmaster KS-1 Bluetooth keg scale into Home Assistant, without any cloud
dependency or the official app. It works by passively listening to the KS-1's BLE
advertisement broadcasts (the scale never needs pairing — it just shouts its data into
the air every ~30 seconds) and relaying the parsed values into HA via an ESP32 running
ESPHome.

Supports up to 4 scales on one ESP32 (a typical kegerator's max capacity), exposing
weight, temperature, battery voltage/percentage, broadcast count, and uptime per scale —
plus a custom Lovelace card that renders each keg as a vertical fill gauge, scaled by
keg size (19L / 10L).

## Hardware needed

- 1x ESP32 dev board per kegerator (generic "ESP32 Dev Module" boards work fine)
- 1 or more Kegmaster KS-1 scales
- A phone with the [nRF Connect](https://www.nordicsemi.com/Products/Development-tools/nrf-connect-for-mobile)
  app (free, iOS/Android) — only needed once, to find each scale's MAC address

## Step 1 — Find each scale's MAC address

The ESP32 needs to know each scale's Bluetooth MAC address to listen for it specifically.

1. Install nRF Connect and open it.
2. Tap **Scan**. Your KS-1(s) should show up in the list (look for the device name or,
   if unnamed, watch for a device whose advertisement updates roughly every 30s).
3. Tap into the device — the MAC address is shown at the top, in the form
   `XX:XX:XX:XX:XX:XX`.
4. Repeat for each scale you own.

Keep these handy — you'll paste them into the ESPHome config below.

## Step 2 — The BLE protocol (reverse-engineered)

The KS-1 advertises a **Service Data** structure under a custom 16-bit UUID `0xE4BE`
(not a standard Eddystone/iBeacon format, despite also listing Eddystone's UUID
elsewhere in the same packet). The service data payload is 17 bytes, laid out as
follows (0-indexed byte offsets):

| Bytes | Field | Type | Formula |
|---|---|---|---|
| 2–3 | Battery | uint16, big-endian | raw millivolts (e.g. `3972` = 3.972V) |
| 4–5 | Temperature | uint16, big-endian | `(raw / 10.0) - 50.0` = °C |
| 8–9 | Broadcast count | uint16, big-endian | increments each advertisement sent |
| 10–13 | Uptime | uint32, big-endian | raw value is in **deciseconds** (tenths of a second) — divide by 10 for seconds |
| 15–16 | Weight | int16, big-endian | `raw * 4` = grams |

These were derived empirically by capturing advertisements at known weights (0g,
1737g, 2438g) and known temperatures (confirmed against the official Kegmaster app at
7°C and 3.5°C), then solving for the linear relationships. Battery and the two counter
fields were identified afterward by comparing which bytes moved independently of
weight/temperature and cross-checking the counters against the app's own "Broadcast
Count" and uptime display.

Battery is broadcast as raw voltage, not a percentage — this integration estimates
percentage with a simple linear model (3.0V = 0%, 4.2V = 100%, typical for a single
Li-ion/LiPo cell). Treat the percentage as an approximation; the voltage reading itself
is exact.

## Step 3 — ESPHome configuration

Install the ESPHome add-on (or standalone dashboard), create a new device, and use this
config. It already supports 4 kegs — replace the two placeholder MACs with real ones as
you add more scales, and swap in the two MACs you already have.

**Note:** MAC address string comparisons in the lambda must be **uppercase** to match
what `address_str()` returns.

```yaml
esphome:
  name: keg-scale-bridge

esp32:
  board: esp32dev
  framework:
    type: arduino

wifi:
  ssid: !secret wifi_ssid
  password: !secret wifi_password

api:
ota:
  platform: esphome
logger:

esp32_ble_tracker:
  scan_parameters:
    active: false
  on_ble_advertise:
    - mac_address:
        - "F0:24:F9:2A:83:66"   # Keg 1 — replace with your MAC
        - "88:57:21:50:D1:96"   # Keg 2 — replace with your MAC
        - "AA:AA:AA:AA:AA:AA"   # Keg 3 (placeholder)
        - "BB:BB:BB:BB:BB:BB"   # Keg 4 (placeholder)
      then:
        - lambda: |-
            std::string addr = x.address_str();

            for (auto &service_data : x.get_service_datas()) {
              if (service_data.uuid != esp32_ble_tracker::ESPBTUUID::from_uint16(0xE4BE)) continue;
              auto &data = service_data.data;
              if (data.size() < 17) continue;

              int16_t raw_weight = (data[15] << 8) | data[16];
              float weight_g = raw_weight * 4.0f;

              uint16_t raw_temp = (data[4] << 8) | data[5];
              float temp_c = (raw_temp / 10.0f) - 50.0f;

              uint16_t raw_batt_mv = (data[2] << 8) | data[3];
              float batt_v = raw_batt_mv / 1000.0f;
              float batt_pct = ((batt_v - 3.0f) / (4.2f - 3.0f)) * 100.0f;
              if (batt_pct > 100) batt_pct = 100;
              if (batt_pct < 0) batt_pct = 0;

              uint16_t broadcast_count = (data[8] << 8) | data[9];

              uint32_t uptime_deciseconds = ((uint32_t)data[10] << 24) | ((uint32_t)data[11] << 16) |
                                             ((uint32_t)data[12] << 8) | data[13];
              uint32_t uptime_s = uptime_deciseconds / 10;

              if (addr == "F0:24:F9:2A:83:66") {
                id(keg1_weight).publish_state(weight_g);
                id(keg1_temperature).publish_state(temp_c);
                id(keg1_battery_voltage).publish_state(batt_v);
                id(keg1_battery_percent).publish_state(batt_pct);
                id(keg1_broadcast_count).publish_state(broadcast_count);
                id(keg1_uptime_seconds).publish_state((float)uptime_s);
              } else if (addr == "88:57:21:50:D1:96") {
                id(keg2_weight).publish_state(weight_g);
                id(keg2_temperature).publish_state(temp_c);
                id(keg2_battery_voltage).publish_state(batt_v);
                id(keg2_battery_percent).publish_state(batt_pct);
                id(keg2_broadcast_count).publish_state(broadcast_count);
                id(keg2_uptime_seconds).publish_state((float)uptime_s);
              } else if (addr == "AA:AA:AA:AA:AA:AA") {
                id(keg3_weight).publish_state(weight_g);
                id(keg3_temperature).publish_state(temp_c);
                id(keg3_battery_voltage).publish_state(batt_v);
                id(keg3_battery_percent).publish_state(batt_pct);
                id(keg3_broadcast_count).publish_state(broadcast_count);
                id(keg3_uptime_seconds).publish_state((float)uptime_s);
              } else if (addr == "BB:BB:BB:BB:BB:BB") {
                id(keg4_weight).publish_state(weight_g);
                id(keg4_temperature).publish_state(temp_c);
                id(keg4_battery_voltage).publish_state(batt_v);
                id(keg4_battery_percent).publish_state(batt_pct);
                id(keg4_broadcast_count).publish_state(broadcast_count);
                id(keg4_uptime_seconds).publish_state((float)uptime_s);
              }
            }

sensor:
  - platform: template
    name: "Keg 1 Weight"
    id: keg1_weight
    unit_of_measurement: "g"
    accuracy_decimals: 0
    device_class: weight
    state_class: measurement
  - platform: template
    name: "Keg 1 Temperature"
    id: keg1_temperature
    unit_of_measurement: "°C"
    accuracy_decimals: 1
    device_class: temperature
    state_class: measurement
  - platform: template
    name: "Keg 1 Battery Voltage"
    id: keg1_battery_voltage
    unit_of_measurement: "V"
    accuracy_decimals: 3
    device_class: voltage
    state_class: measurement
  - platform: template
    name: "Keg 1 Battery"
    id: keg1_battery_percent
    unit_of_measurement: "%"
    accuracy_decimals: 0
    device_class: battery
    state_class: measurement
  - platform: template
    name: "Keg 1 Broadcast Count"
    id: keg1_broadcast_count
    accuracy_decimals: 0
    state_class: measurement
  - platform: template
    name: "Keg 1 Uptime"
    id: keg1_uptime_seconds
    unit_of_measurement: "s"
    accuracy_decimals: 0
    device_class: duration
    state_class: measurement

  - platform: template
    name: "Keg 2 Weight"
    id: keg2_weight
    unit_of_measurement: "g"
    accuracy_decimals: 0
    device_class: weight
    state_class: measurement
  - platform: template
    name: "Keg 2 Temperature"
    id: keg2_temperature
    unit_of_measurement: "°C"
    accuracy_decimals: 1
    device_class: temperature
    state_class: measurement
  - platform: template
    name: "Keg 2 Battery Voltage"
    id: keg2_battery_voltage
    unit_of_measurement: "V"
    accuracy_decimals: 3
    device_class: voltage
    state_class: measurement
  - platform: template
    name: "Keg 2 Battery"
    id: keg2_battery_percent
    unit_of_measurement: "%"
    accuracy_decimals: 0
    device_class: battery
    state_class: measurement
  - platform: template
    name: "Keg 2 Broadcast Count"
    id: keg2_broadcast_count
    accuracy_decimals: 0
    state_class: measurement
  - platform: template
    name: "Keg 2 Uptime"
    id: keg2_uptime_seconds
    unit_of_measurement: "s"
    accuracy_decimals: 0
    device_class: duration
    state_class: measurement

  - platform: template
    name: "Keg 3 Weight"
    id: keg3_weight
    unit_of_measurement: "g"
    accuracy_decimals: 0
    device_class: weight
    state_class: measurement
  - platform: template
    name: "Keg 3 Temperature"
    id: keg3_temperature
    unit_of_measurement: "°C"
    accuracy_decimals: 1
    device_class: temperature
    state_class: measurement
  - platform: template
    name: "Keg 3 Battery Voltage"
    id: keg3_battery_voltage
    unit_of_measurement: "V"
    accuracy_decimals: 3
    device_class: voltage
    state_class: measurement
  - platform: template
    name: "Keg 3 Battery"
    id: keg3_battery_percent
    unit_of_measurement: "%"
    accuracy_decimals: 0
    device_class: battery
    state_class: measurement
  - platform: template
    name: "Keg 3 Broadcast Count"
    id: keg3_broadcast_count
    accuracy_decimals: 0
    state_class: measurement
  - platform: template
    name: "Keg 3 Uptime"
    id: keg3_uptime_seconds
    unit_of_measurement: "s"
    accuracy_decimals: 0
    device_class: duration
    state_class: measurement

  - platform: template
    name: "Keg 4 Weight"
    id: keg4_weight
    unit_of_measurement: "g"
    accuracy_decimals: 0
    device_class: weight
    state_class: measurement
  - platform: template
    name: "Keg 4 Temperature"
    id: keg4_temperature
    unit_of_measurement: "°C"
    accuracy_decimals: 1
    device_class: temperature
    state_class: measurement
  - platform: template
    name: "Keg 4 Battery Voltage"
    id: keg4_battery_voltage
    unit_of_measurement: "V"
    accuracy_decimals: 3
    device_class: voltage
    state_class: measurement
  - platform: template
    name: "Keg 4 Battery"
    id: keg4_battery_percent
    unit_of_measurement: "%"
    accuracy_decimals: 0
    device_class: battery
    state_class: measurement
  - platform: template
    name: "Keg 4 Broadcast Count"
    id: keg4_broadcast_count
    accuracy_decimals: 0
    state_class: measurement
  - platform: template
    name: "Keg 4 Uptime"
    id: keg4_uptime_seconds
    unit_of_measurement: "s"
    accuracy_decimals: 0
    device_class: duration
    state_class: measurement
```

Flash it, watch the logs to confirm connectivity, and the device auto-discovers in HA
under Settings → Devices & Services.

## Step 4 — Dashboard: the Keg Fill card

A custom Lovelace card (`keg-fill-card.js`, included alongside this README) renders each
keg as a vertical fill gauge sized to the keg's actual weight range, with weight,
battery and uptime shown alongside. No helpers or template sensors required — everything
is computed inside the card itself.

**Install:**
1. Copy `keg-fill-card.js` to `/config/www/keg-fill-card.js` on your HA instance.
2. Settings → Dashboards → ⋮ menu → Resources → Add Resource → URL `/local/keg-fill-card.js`,
   type **JavaScript module**.
3. Hard-refresh your browser.
4. Edit a dashboard → Add card → search "Keg Fill Card". Its editor lets you pick:
   - **Weight sensor** — e.g. `sensor.keg1_weight`
   - **Battery sensor** — e.g. `sensor.keg1_battery_percent`
   - **Uptime sensor** — the raw seconds sensor, e.g. `sensor.keg1_uptime_seconds`
   - **Empty keg weight (g)** and **Full keg weight (g)** — weigh your keg empty and
     full once, enter those numbers here
   - **Keg size** — 19L or 10L; a 10L keg's bar renders at half the height of a 19L
     one, bottom-aligned, so card heights stay identical across your dashboard while
     still visually representing relative capacity

Add one card per keg — no YAML editing needed after the resource is registered.

## Notes / limitations

- Battery percentage is a linear voltage estimate, not a true state-of-charge curve —
  treat it as approximate.
- The "Broadcast Count" and uptime fields reset when the scale itself reboots (e.g.
  battery change), not when the ESP32 reboots — they reflect the *scale's* own uptime.
- This was reverse-engineered against one specific KS-1 firmware revision. If your
  scale's payload doesn't match the byte offsets above, the capture-and-diff process in
  Step 2 is the way to re-derive them — capture at a few known weights/temperatures and
  compare which bytes move.

