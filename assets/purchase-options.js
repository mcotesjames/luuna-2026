/**
 * <purchase-options> — Subscribe & save / One-time purchase module.
 *
 * State lives here; the product form receives it through two hidden inputs linked with the `form` attribute:
 *   - quantity
 *   - selling_plan (disabled for one-time, so it is not submitted)
 * Because the sticky bar button submits the same form, it automatically sends the same values. We only keep
 * the button labels (main + sticky) in sync with a live total.
 */

const UNIT_DAYS = { day: 1, week: 7, month: 30, year: 365 };

function parseInterval(source) {
  const match = /(\d+)\s*(day|week|month|year)/i.exec(source || '');
  if (!match) return null;
  const count = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const phrase = count === 1 ? `every ${unit}` : `every ${count} ${unit}s`;
  return { count, unit, days: count * UNIT_DAYS[unit], phrase, title: phrase.charAt(0).toUpperCase() + phrase.slice(1) };
}

function formatMoney(cents, format) {
  const value = typeof cents === 'string' ? parseInt(cents.replace('.', ''), 10) : cents;
  // The shop's money format can include HTML (e.g. <span class=money>), so strip tags: prices are set as text
  const fmt = (format || window.themeVariables?.settings?.moneyFormat || '${{amount}}').replace(/<[^>]*>/g, '');
  const withDelimiters = (amount, precision, thousands = ',', decimal = '.') => {
    const fixed = (amount / 100).toFixed(precision);
    const [whole, fraction] = fixed.split('.');
    return whole.replace(/(\d)(?=(\d{3})+(?!\d))/g, `$1${thousands}`) + (fraction ? decimal + fraction : '');
  };
  return fmt.replace(/\{\{\s*(\w+)\s*\}\}/, (_, key) => {
    switch (key) {
      case 'amount_no_decimals': return withDelimiters(value, 0);
      case 'amount_with_comma_separator': return withDelimiters(value, 2, '.', ',');
      case 'amount_no_decimals_with_comma_separator': return withDelimiters(value, 0, '.', ',');
      case 'amount_with_apostrophe_separator': return withDelimiters(value, 2, "'", '.');
      default: return withDelimiters(value, 2);
    }
  });
}

function track(event, params) {
  if (Array.isArray(window.dataLayer)) {
    window.dataLayer.push({ event, ...params });
  }
}

class PurchaseOptions extends HTMLElement {
  connectedCallback() {
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    this.form = document.getElementById(this.getAttribute('form'));
    if (!this.form) return;

    this.data = JSON.parse(this.querySelector('[data-po-data]').textContent);
    this.quantityInput = this.querySelector('[data-po-quantity-input]');
    this.planInput = this.querySelector('[data-po-plan-input]');
    this.cards = {
      subscription: this.querySelector('[data-po-card="subscription"]'),
      onetime: this.querySelector('[data-po-card="onetime"]')
    };

    this.#setupChips();
    this.#setupRow();

    this.state = {
      purchaseType: this.dataset.defaultType || 'onetime',
      planId: this.chips[0]?.dataset.planId || null,
      quantity: 1
    };

    this.addEventListener('change', (event) => {
      if (event.target.matches('.po-radio')) this.#setType(event.target.value);
    }, { signal });

    this.querySelector('[data-po-chips]')?.addEventListener('click', (event) => {
      const chip = event.target.closest('.po-chip');
      if (chip) this.#setPlan(chip.dataset.planId, true);
    }, { signal });

    this.querySelector('[data-po-chips]')?.addEventListener('keydown', (event) => this.#onChipKeydown(event), { signal });

    // Variant change: the theme re-renders buy buttons and the sticky bar, then fires variant:change
    this.form.addEventListener('variant:change', () => this.#render(), { signal });

    this.form.addEventListener('variant:add', () => {
      track('add_to_cart_purchase_option', {
        purchase_type: this.state.purchaseType,
        selling_plan_id: this.state.purchaseType === 'subscription' ? this.state.planId : null,
        quantity: this.state.quantity
      });
    }, { signal });

    this.#render();
  }

  disconnectedCallback() {
    this.abortController?.abort();
  }

  get variant() {
    const id = this.form.elements.namedItem('id')?.value;
    return this.data.variants[id] || Object.values(this.data.variants)[0];
  }

  get variantPlans() {
    return this.variant?.plans || {};
  }

  get hasSubscription() {
    return Boolean(this.cards.subscription) && Object.keys(this.variantPlans).length > 0;
  }

  /* ---------- setup ---------- */

  #setupChips() {
    const container = this.querySelector('[data-po-chips]');
    this.chips = container ? Array.from(container.querySelectorAll('.po-chip')) : [];

    this.chips.forEach((chip) => {
      chip.interval = parseInterval(chip.dataset.planSource);
      if (chip.interval) {
        chip.querySelector('[data-po-chip-title]').textContent = chip.interval.title;
      }
    });

    // Shortest interval first
    this.chips.sort((a, b) => (a.interval?.days ?? Infinity) - (b.interval?.days ?? Infinity));
    this.chips.forEach((chip, index) => {
      container.appendChild(chip);
      const subtitle = this.data.subtitles?.[index];
      const subElement = chip.querySelector('[data-po-chip-sub]');
      if (subtitle) {
        subElement.textContent = subtitle;
        subElement.hidden = false;
      }
    });
  }

  #setupRow() {
    const template = this.querySelector('[data-po-row-template]');
    this.row = template.content.firstElementChild.cloneNode(true);
    this.rowPrice = this.row.querySelector('[data-po-row-price]');
    this.rowQty = this.row.querySelector('[data-po-qty]');
    this.stepButtons = Array.from(this.row.querySelectorAll('[data-po-step]'));
    this.stepButtons.forEach((button) => {
      button.addEventListener('click', () => this.#setQuantity(this.state.quantity + parseInt(button.dataset.poStep, 10)));
    });
  }

  /* ---------- state changes ---------- */

  #setType(type) {
    if (type === this.state.purchaseType) return;
    this.state.purchaseType = type;
    this.#render();
    this.#emit();
    track('purchase_option_select', { type });
  }

  #setPlan(planId, userAction = false) {
    this.state.planId = planId;
    this.#render();
    this.#emit();
    if (userAction) {
      const chip = this.chips.find((c) => c.dataset.planId === planId);
      track('subscription_frequency_select', {
        selling_plan_id: planId,
        interval: chip?.interval ? `${chip.interval.count} ${chip.interval.unit}` : null
      });
    }
  }

  #setQuantity(quantity) {
    const max = this.variant?.max ?? Infinity;
    this.state.quantity = Math.max(1, Math.min(quantity, max || 1));
    this.#render();
    this.#emit();
  }

  #onChipKeydown(event) {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const visible = this.chips.filter((chip) => !chip.hidden);
    const index = visible.findIndex((chip) => chip.dataset.planId === this.state.planId);
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = visible[(index + step + visible.length) % visible.length];
    this.#setPlan(next.dataset.planId, true);
    next.focus();
  }

  #emit() {
    this.dispatchEvent(new CustomEvent('purchase-options:change', { bubbles: true, detail: { ...this.state } }));
  }

  /* ---------- render ---------- */

  #render() {
    const variant = this.variant;
    const plans = this.variantPlans;
    const moneyFormat = window.themeVariables?.settings?.moneyFormat;

    // Subscription availability for the current variant
    if (this.cards.subscription) this.cards.subscription.hidden = !this.hasSubscription;
    if (!this.hasSubscription && this.cards.onetime) this.state.purchaseType = 'onetime';

    // Plan must exist for this variant
    const visibleChips = this.chips.filter((chip) => {
      chip.hidden = !(chip.dataset.planId in plans);
      return !chip.hidden;
    });
    if (!(this.state.planId in plans)) this.state.planId = visibleChips[0]?.dataset.planId || null;

    // Quantity clamp against inventory
    const max = variant?.max;
    if (max != null && max > 0 && this.state.quantity > max) this.state.quantity = max;

    const isSub = this.state.purchaseType === 'subscription';
    const unitPrice = isSub && this.state.planId ? plans[this.state.planId] : variant.price;

    // Cards
    Object.entries(this.cards).forEach(([type, card]) => {
      if (!card) return;
      const open = type === this.state.purchaseType || card.hasAttribute('data-po-solo');
      card.classList.toggle('is-open', open);
      const body = card.querySelector('[data-po-body]');
      body.inert = !open;
      body.setAttribute('aria-hidden', String(!open));
      const radio = card.querySelector('.po-radio');
      if (radio) radio.checked = open;
      if (open) card.querySelector('[data-po-row-slot]').appendChild(this.row);
    });

    // Header prices + badge
    const planPrices = Object.values(plans);
    if (planPrices.length) {
      // Flat discount today; if plans ever differ, the header shows the best price and largest saving
      const lowest = Math.min(...planPrices);
      const bestPct = Math.round(((variant.price - lowest) / variant.price) * 100);
      this.querySelector('[data-po-sub-price]').textContent = formatMoney(lowest, moneyFormat);
      this.querySelector('[data-po-compare-value]').textContent = formatMoney(variant.price, moneyFormat);
      this.querySelector('[data-po-sub-compare]').hidden = lowest >= variant.price;
      const badge = this.querySelector('[data-po-badge]');
      badge.hidden = bestPct <= 0;
      badge.textContent = (this.dataset.badgeTemplate || 'Save [percent]%').replace('[percent]', bestPct);
    }
    const onetimePrice = this.querySelector('[data-po-onetime-price]');
    if (onetimePrice) onetimePrice.textContent = formatMoney(variant.price, moneyFormat);

    // Chips
    this.chips.forEach((chip) => {
      const selected = chip.dataset.planId === this.state.planId;
      chip.setAttribute('aria-checked', String(selected));
      chip.tabIndex = selected ? 0 : -1;
    });

    // Row
    this.rowPrice.textContent = formatMoney(unitPrice, moneyFormat);
    this.rowQty.textContent = this.state.quantity;
    const disabled = !variant.available;
    this.stepButtons[0].disabled = disabled || this.state.quantity <= 1;
    this.stepButtons[1].disabled = disabled || (max != null && this.state.quantity >= max);

    // Form fields
    this.quantityInput.value = this.state.quantity;
    this.planInput.value = isSub ? this.state.planId || '' : '';
    this.planInput.disabled = !(isSub && this.state.planId);
    this.form.dataset.poType = this.state.purchaseType;

    // Button labels (main buy button + sticky bar, both submit this form)
    if (variant.available) {
      const total = formatMoney(unitPrice * this.state.quantity, moneyFormat);
      const chip = this.chips.find((c) => c.dataset.planId === this.state.planId);
      const phrase = isSub ? ` ${chip?.interval?.phrase || ''}`.trimEnd() : '';
      const label = `${this.dataset.addLabel} · ${total}${phrase}`;
      Array.from(this.form.elements)
        .filter((element) => element.type === 'submit')
        .forEach((button) => {
          if (button.textContent.trim() !== label) button.textContent = label;
        });
    }
  }
}

if (!window.customElements.get('purchase-options')) {
  window.customElements.define('purchase-options', PurchaseOptions);
}
