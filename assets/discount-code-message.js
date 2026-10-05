/**
 * <discount-code-message discount-code="FREESHIPPING">
 *   <p data-discount-state="default">…</p>
 *   <p data-discount-state="applied" hidden>…</p>
 * </discount-code-message>
 *
 * Shows one of two messages depending on whether a discount code is applied to the cart. Liquid does not expose
 * discount codes on the cart object (and shipping discounts never appear in cart.discount_applications), so the state
 * is read from /cart.js. The element starts in a "pending" state (hidden by CSS) and is revealed once the correct
 * message is known. Because the cart drawer re-renders its HTML on every cart change, the last known state is kept in
 * memory so re-rendered elements can show the right message immediately, then confirm it against the cart.
 */

const knownStates = new Map();
let cartRequest = null;

const fetchCart = () => {
  cartRequest ??= fetch(`${window.Shopify?.routes?.root ?? '/'}cart.js`)
    .then((response) => response.json())
    .finally(() => (cartRequest = null));

  return cartRequest;
};

class DiscountCodeMessage extends HTMLElement {
  #abortController;

  get discountCode() {
    return (this.getAttribute('discount-code') || '').trim().toUpperCase();
  }

  connectedCallback() {
    this.#abortController = new AbortController();
    const { signal } = this.#abortController;

    document.addEventListener('cart:change', (event) => this.#sync(event.detail?.cart?.discount_codes ? event.detail.cart : undefined), { signal });
    document.addEventListener('cart:refresh', () => this.#sync(), { signal });
    window.addEventListener('pageshow', (event) => event.persisted && this.#sync(), { signal });

    if (knownStates.has(this.discountCode)) {
      this.#render(knownStates.get(this.discountCode));
    }

    // Never leave the message invisible if the cart request hangs
    setTimeout(() => this.removeAttribute('pending'), 3000);
    this.#sync();
  }

  disconnectedCallback() {
    this.#abortController?.abort();
  }

  async #sync(cart) {
    try {
      cart ??= await fetchCart();
      const isApplied = (cart.discount_codes || []).some((discount) => discount.applicable && discount.code.toUpperCase() === this.discountCode);
      knownStates.set(this.discountCode, isApplied);
      this.#render(isApplied);
    } catch (error) {
      // If the cart can't be read, fall back to showing the default message
      this.removeAttribute('pending');
    }
  }

  #render(isApplied) {
    const defaultMessage = this.querySelector('[data-discount-state="default"]');
    const appliedMessage = this.querySelector('[data-discount-state="applied"]');
    const showApplied = isApplied && !!appliedMessage;

    defaultMessage?.toggleAttribute('hidden', showApplied);
    appliedMessage?.toggleAttribute('hidden', !showApplied);
    this.toggleAttribute('applied', showApplied);
    this.toggleAttribute('hidden', !(showApplied ? appliedMessage : defaultMessage));
    this.removeAttribute('pending');
  }
}

if (!window.customElements.get('discount-code-message')) {
  window.customElements.define('discount-code-message', DiscountCodeMessage);
}
