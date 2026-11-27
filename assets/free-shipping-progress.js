/**
 * <free-shipping-progress> — PDP free shipping progress bar. See snippets/free-shipping-progress.liquid.
 *
 * One striped bar: the cart (shippable items, less cart-level discounts) plus what the product form would add
 * right now (variant x plan x quantity).
 *
 * "reached" (success message, glint, truck pulse) as soon as the cart plus the selection gets to the threshold,
 * whether or not the selection is in the cart yet. One striped bar shows cart + selection, so adding to the cart
 * changes nothing visually: <purchase-options> starts at quantity 0 and resets to 0 after each add, so the
 * selection simply moves into the cart total.
 *
 * The preview amount comes from <purchase-options> (its lineTotal getter / purchase-options:change event) when the
 * product has that block, otherwise from the selected variant price x the form's quantity input.
 *
 * Without a `form` attribute (cart drawer) there is no preview: the bar is the cart alone. With `data-persist`, the
 * element expects its section to re-render it on every cart change (the cart drawer does, via bundled sections), so
 * it skips cart:change and instead animates from where the previous bar with the same key left off.
 */

// Last rendered position per data-persist key, so a re-rendered bar can animate on from it
const persisted = new Map();

function formatMoney(cents) {
  const format = (window.themeVariables?.settings?.moneyFormat || '${{amount}}').replace(/<[^>]*>/g, '');
  const withDelimiters = (amount, precision, thousands = ',', decimal = '.') => {
    const [whole, fraction] = (amount / 100).toFixed(precision).split('.');
    return whole.replace(/(\d)(?=(\d{3})+(?!\d))/g, `$1${thousands}`) + (fraction ? decimal + fraction : '');
  };
  return format.replace(/\{\{\s*(\w+)\s*\}\}/, (_, key) => {
    switch (key) {
      case 'amount_no_decimals': return withDelimiters(cents, 0);
      case 'amount_with_comma_separator': return withDelimiters(cents, 2, '.', ',');
      case 'amount_no_decimals_with_comma_separator': return withDelimiters(cents, 0, '.', ',');
      case 'amount_with_apostrophe_separator': return withDelimiters(cents, 2, "'", '.');
      default: return withDelimiters(cents, 2);
    }
  });
}

class FreeShippingProgress extends HTMLElement {
  connectedCallback() {
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    let threshold = parseFloat((this.getAttribute('threshold') || '').replace(/[^0-9.]/g, '')) * 100;
    if (this.hasAttribute('convert-currency')) {
      threshold = Math.round(threshold * (parseFloat(window.Shopify?.currency?.rate) || 1));
    }
    this.threshold = threshold;
    this.cartTotal = parseInt(this.dataset.cartTotal, 10) || 0;
    this.preview = parseInt(this.dataset.preview, 10) || 0;
    this.requiresShipping = this.dataset.requiresShipping !== 'false';

    this.formId = this.getAttribute('form');
    this.form = document.getElementById(this.formId);
    this.message = this.querySelector('.fsp__message');
    this.track = this.querySelector('.fsp__track');

    this.persistKey = this.dataset.persist || null;

    if (!this.persistKey) {
      document.addEventListener('cart:change', (event) => this.#onCartChange(event), { signal });
    }

    if (!this.formId) {
      this.#renderCartOnly();
      return;
    }

    document.addEventListener('purchase-options:change', (event) => {
      if (event.target.getAttribute('form') !== this.formId) return;
      this.preview = this.requiresShipping ? event.detail.lineTotal || 0 : 0;
      if (!this.awaitingCart) this.#render();
    }, { signal });

    // Adding to the cart: <purchase-options> resets to 0 on variant:add, just before cart:change brings the new cart
    // total. Hold the render until then so the bar doesn't dip and come back (capture runs before the form's own
    // listeners, so this is set before the reset).
    document.addEventListener('variant:add', (event) => {
      if (event.target === this.form) this.awaitingCart = true;
    }, { signal, capture: true });

    if (this.form) {
      this.form.addEventListener('variant:change', (event) => {
        const variant = event.detail?.variant;
        if (variant) this.requiresShipping = variant.requires_shipping !== false;
        // Let <purchase-options> re-render for the new variant first
        requestAnimationFrame(() => this.#updatePreviewFromForm(variant));
      }, { signal });

      // Products without the purchase options block use the theme's own quantity selector
      this.form.addEventListener('change', (event) => {
        if (event.target.name === 'quantity' && !this.#purchaseOptions) this.#updatePreviewFromForm();
      }, { signal });
    }

    this.#updatePreviewFromForm();
  }

  disconnectedCallback() {
    this.abortController?.abort();
  }

  // Cart drawer: no product preview. When re-rendered, start from the previous bar's position and state, then move to
  // the new one on the next frame so the fill transitions and the unlock glint plays.
  #renderCartOnly() {
    const previous = this.persistKey && persisted.get(this.persistKey);
    if (!previous) {
      this.#render({ fromCart: true });
      return;
    }

    this.rendered = true;
    this.previewProgress = previous.progress;
    this.dataset.state = previous.state;
    this.style.setProperty('--fsp-preview-progress', previous.progress);
    requestAnimationFrame(() => requestAnimationFrame(() => this.#render({ fromCart: true })));
  }

  get #purchaseOptions() {
    const element = document.querySelector(`purchase-options[form="${CSS.escape(this.formId)}"]`);
    return typeof element?.lineTotal === 'number' ? element : null;
  }

  #updatePreviewFromForm(variant) {
    this.unitPrice = variant?.price ?? this.unitPrice ?? this.preview;

    if (!this.requiresShipping) {
      this.preview = 0;
    } else if (this.#purchaseOptions) {
      this.preview = this.#purchaseOptions.lineTotal;
    } else {
      const quantity = parseInt(this.form?.elements.namedItem('quantity')?.value, 10) || 1;
      this.preview = this.unitPrice * quantity;
    }
    this.#render();
  }

  #play(name) {
    clearTimeout(this.playTimeout);
    this.removeAttribute('data-play');
    void this.offsetWidth; // restart the animation if it is already running
    this.dataset.play = name;
    this.playTimeout = setTimeout(() => this.removeAttribute('data-play'), 1200); // glint 0.9s; unlock pulse ends at 1.05s
  }

  #onCartChange(event) {
    const cart = event.detail?.cart;
    if (!cart) return;
    const items = cart.items
      .filter((item) => item.requires_shipping)
      .reduce((sum, item) => sum + item.final_line_price, 0);
    const discounts = (cart.cart_level_discount_applications || [])
      .reduce((sum, application) => sum + (application.discount_application?.total_allocated_amount ?? application.total_allocated_amount ?? 0), 0);
    this.cartTotal = items - discounts;
    this.awaitingCart = false;
    this.#render({ fromCart: true });
  }

  #render({ fromCart = false } = {}) {
    if (!(this.threshold > 0)) {
      this.hidden = true;
      return;
    }

    const cart = Math.max(0, this.cartTotal);
    const withProduct = cart + this.preview;
    const previewProgress = Math.min(1, withProduct / this.threshold);

    // Reached as soon as the cart plus the current selection gets there
    const state = withProduct >= this.threshold ? 'reached' : 'away';
    const template = (state === 'reached' ? this.dataset.messageCartReached : this.dataset.messageAway) || '';
    const amount = `<strong>${formatMoney(Math.max(0, this.threshold - withProduct))}</strong>`;
    const html = template.replace(/\[amount\]/g, amount);
    if (this.message.innerHTML !== html) this.message.innerHTML = html;

    // Animations (styles in free-shipping-progress.css; all disabled by the block setting or prefers-reduced-motion)
    if (this.rendered) {
      if (state === 'reached' && this.dataset.state !== 'reached') {
        this.#play('unlocked'); // the usual glint, plus the truck pulse
      } else if (!fromCart && previewProgress > this.previewProgress) {
        // slight single glint when changing the selection moves the bar forward; cart changes just fill smoothly,
        // so the glint never reads as success when the cart is still under the minimum
        this.#play('progressed');
      }
    }
    this.rendered = true;
    this.previewProgress = previewProgress;

    this.dataset.state = state;
    this.style.setProperty('--fsp-preview-progress', previewProgress);
    this.track.setAttribute('aria-valuenow', String(Math.round(previewProgress * 100)));
    this.track.setAttribute('aria-valuetext', this.message.textContent.trim());

    if (this.persistKey) persisted.set(this.persistKey, { progress: previewProgress, state });
  }
}

if (!window.customElements.get('free-shipping-progress')) {
  window.customElements.define('free-shipping-progress', FreeShippingProgress);
}
