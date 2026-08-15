class KegFillCard extends HTMLElement {
  setConfig(config) {
    if (!config.weight_entity) {
      throw new Error('weight_entity is required');
    }
    this._config = config;
    this._elements = null;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 3;
  }

  static getConfigElement() {
    return document.createElement('keg-fill-card-editor');
  }

  static getStubConfig() {
    return {
      title: 'Keg',
      weight_entity: '',
      battery_entity: '',
      uptime_entity: '',
      empty_weight: 0,
      full_weight: 0,
      keg_size: '19L',
    };
  }

  _fmt(entityId, formatter) {
    if (!entityId) return '–';
    const state = this._hass.states[entityId];
    if (!state || state.state === 'unknown' || state.state === 'unavailable') return '–';
    return formatter(state.state);
  }

  _render() {
    if (!this._hass || !this._config) return;
    const c = this._config;

    const weightState = this._hass.states[c.weight_entity];
    const empty = parseFloat(c.empty_weight) || 0;
    const full = parseFloat(c.full_weight) || 0;

    let pct = 0;
    let weightText = '–';
    if (weightState && weightState.state !== 'unknown' && weightState.state !== 'unavailable') {
      const currentG = parseFloat(weightState.state) || 0;
      weightText = (currentG / 1000).toFixed(1) + ' kg';
      if (full > empty) {
        pct = ((currentG - empty) / (full - empty)) * 100;
        pct = Math.max(0, Math.min(100, pct));
      }
    }

    const battery = this._fmt(c.battery_entity, (s) => Math.round(parseFloat(s)) + '%');
    const uptime = this._fmt(c.uptime_entity, (s) => {
      const totalSeconds = Math.floor(parseFloat(s));
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
    });

    const slotHeight = 160;
    const boxHeight = c.keg_size === '10L' ? slotHeight / 2 : slotHeight;

    if (!this._elements) {
      this.innerHTML = `
        <ha-card>
          <div class="wrap">
            <div class="title"></div>
            <div class="row">
              <div class="bar-slot"><div class="bar-outer"><div class="bar-fill"></div><div class="bar-label"></div></div></div>
              <div class="stats">
                <div><span class="k">Weight</span><span class="weight"></span></div>
                <div><span class="k">Battery</span><span class="battery"></span></div>
                <div><span class="k">Uptime</span><span class="uptime"></span></div>
              </div>
            </div>
          </div>
        </ha-card>
        <style>
          ha-card { padding: 12px 16px; }
          .title { font-weight: 500; font-size: 15px; margin-bottom: 10px; color: var(--primary-text-color); }
          .row { display: flex; gap: 14px; }
          .bar-slot {
            width: 56px; height: 160px;
            display: flex; align-items: flex-end; flex-shrink: 0;
          }
          .bar-outer {
            width: 100%; border-radius: 8px;
            background: var(--secondary-background-color);
            position: relative; overflow: hidden;
            border: 1px solid var(--divider-color);
          }
          .bar-fill {
            position: absolute; bottom: 0; left: 0; right: 0;
            background: #EF9F27; transition: height 0.4s ease;
          }
          .bar-label {
            position: absolute; top: 6px; left: 0; right: 0; text-align: center;
            font-size: 12px; font-weight: 500; color: var(--secondary-text-color);
          }
          .stats {
            display: flex; flex-direction: column; justify-content: center;
            gap: 6px; font-size: 12px;
          }
          .stats .k { color: var(--secondary-text-color); margin-right: 4px; }
          .stats span:last-child { color: var(--primary-text-color); font-weight: 500; }
        </style>
      `;
      this._elements = {
        title: this.querySelector('.title'),
        barOuter: this.querySelector('.bar-outer'),
        fill: this.querySelector('.bar-fill'),
        label: this.querySelector('.bar-label'),
        weight: this.querySelector('.weight'),
        battery: this.querySelector('.battery'),
        uptime: this.querySelector('.uptime'),
      };
    }

    this._elements.title.textContent = c.title || 'Keg';
    this._elements.barOuter.style.height = boxHeight + 'px';
    this._elements.fill.style.height = pct + '%';
    this._elements.label.textContent = Math.round(pct) + '%';
    this._elements.weight.textContent = weightText;
    this._elements.battery.textContent = battery;
    this._elements.uptime.textContent = uptime;
  }
}
customElements.define('keg-fill-card', KegFillCard);

class KegFillCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._hass) return;
    if (!this._form) {
      this._form = document.createElement('ha-form');
      this._form.addEventListener('value-changed', (ev) => {
        this._config = ev.detail.value;
        this.dispatchEvent(
          new CustomEvent('config-changed', { detail: { config: this._config } })
        );
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = this._config || {};
    this._form.schema = [
      { name: 'title', selector: { text: {} } },
      { name: 'weight_entity', selector: { entity: {} } },
      { name: 'battery_entity', selector: { entity: {} } },
      { name: 'uptime_entity', selector: { entity: {} } },
      { name: 'empty_weight', selector: { number: { mode: 'box', unit_of_measurement: 'g' } } },
      { name: 'full_weight', selector: { number: { mode: 'box', unit_of_measurement: 'g' } } },
      {
        name: 'keg_size',
        selector: {
          select: {
            options: [
              { value: '19L', label: '19L keg' },
              { value: '10L', label: '10L keg' },
            ],
          },
        },
      },
    ];
    this._form.computeLabel = (schema) => {
      const labels = {
        title: 'Title',
        weight_entity: 'Weight sensor',
        battery_entity: 'Battery sensor',
        uptime_entity: 'Uptime sensor',
        empty_weight: 'Empty keg weight (g)',
        full_weight: 'Full keg weight (g)',
        keg_size: 'Keg size',
      };
      return labels[schema.name] || schema.name;
    };
  }
}
customElements.define('keg-fill-card-editor', KegFillCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'keg-fill-card',
  name: 'Keg Fill Card',
  description: 'Vertical fill gauge for a keg scale, with weight, battery and uptime.',
});
