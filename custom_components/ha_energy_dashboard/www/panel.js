class EnergyPanel extends HTMLElement {
  connectedCallback() {
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
        }
        iframe {
          border: none;
          width: 100%;
          display: block;
        }
      </style>
      <iframe src="/ha-energy-dashboard/index.html?t=${Date.now()}"></iframe>
    `;
    this._iframe = this.shadowRoot.querySelector('iframe');
    this._resize = () => {
      const top = this.getBoundingClientRect().top;
      this._iframe.style.height = `${window.innerHeight - top}px`;
    };
    this._resize();
    window.addEventListener('resize', this._resize);
  }

  disconnectedCallback() {
    window.removeEventListener('resize', this._resize);
  }
}

customElements.define('energy-panel', EnergyPanel);
