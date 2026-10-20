/**
 * <slideshow-testimonials autoplay="5000">
 *   <figure class="testimonial-card is-selected">…</figure>
 *   <figure class="testimonial-card">…</figure>
 *   …
 * </slideshow-testimonials>
 *
 * The testimonials are stacked on top of each other (see testimonial-card.css), and only the card with the is-selected
 * class is visible. This element fades to the next card every `autoplay` milliseconds, looping back to the first card
 * at the end. It does nothing when there is a single card.
 * Autoplay pauses while the visitor touches, hovers or focuses the cards, and restarts the countdown afterwards.
 */

class SlideshowTestimonials extends HTMLElement {
  #abortController;
  #timer;
  #paused = false;

  get delay() {
    return parseInt(this.getAttribute('autoplay')) || 5000;
  }

  get cards() {
    return Array.from(this.children);
  }

  connectedCallback() {
    this.#abortController = new AbortController();
    const { signal } = this.#abortController;

    const pause = () => this.#pause();
    const resume = () => this.#resume();

    this.addEventListener('pointerenter', pause, { signal });
    this.addEventListener('pointerleave', resume, { signal });
    this.addEventListener('touchstart', pause, { passive: true, signal });
    this.addEventListener('touchend', resume, { passive: true, signal });
    this.addEventListener('focusin', pause, { signal });
    this.addEventListener('focusout', resume, { signal });

    document.addEventListener('visibilitychange', () => (document.hidden ? this.#stop() : this.#restart()), { signal });

    if (window.Shopify?.designMode) {
      this.addEventListener('shopify:block:select', (event) => {
        this.#pause();
        this.#select(event.target);
      }, { signal });

      this.addEventListener('shopify:block:deselect', resume, { signal });
    }

    // Liquid selects the first block, but that block may render nothing (e.g. a blank quote)
    if (!this.querySelector(':scope > .is-selected')) {
      this.#select(this.cards[0]);
    }

    this.#restart();
  }

  disconnectedCallback() {
    this.#abortController?.abort();
    this.#stop();
  }

  #pause() {
    this.#paused = true;
    this.#stop();
  }

  #resume() {
    this.#paused = false;
    this.#restart();
  }

  #restart() {
    this.#stop();

    if (this.#paused || document.hidden || this.cards.length < 2) {
      return;
    }

    this.#timer = setInterval(() => this.#next(), this.delay);
  }

  #stop() {
    clearInterval(this.#timer);
    this.#timer = null;
  }

  #next() {
    const cards = this.cards;
    const current = cards.findIndex((card) => card.classList.contains('is-selected'));
    this.#select(cards[(current + 1) % cards.length]);
  }

  #select(card) {
    if (!this.contains(card)) {
      return;
    }

    this.cards.forEach((item) => item.classList.toggle('is-selected', item === card));
  }
}

if (!window.customElements.get('slideshow-testimonials')) {
  window.customElements.define('slideshow-testimonials', SlideshowTestimonials);
}
