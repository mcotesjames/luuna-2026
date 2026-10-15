/**
 * <slideshow-carousel no-transition>…</slideshow-carousel>
 *
 * Lets the slideshow switch slides instantly instead of animating between them. Prestige's carousel has no option for
 * this, but it already skips its animations for instant changes by calling finish() on them, so this does the same.
 * The theme's own method still runs first, so videos are still paused and played as slides change.
 */

customElements.whenDefined('slideshow-carousel').then(() => {
  const SlideshowCarousel = customElements.get('slideshow-carousel');

  if (SlideshowCarousel.prototype.createOnChangeAnimationControls.noTransitionPatched) {
    return;
  }

  const createOnChangeAnimationControls = SlideshowCarousel.prototype.createOnChangeAnimationControls;

  const patched = function (fromSlide, toSlide, options) {
    const controls = createOnChangeAnimationControls.call(this, fromSlide, toSlide, options);

    if (!this.hasAttribute('no-transition')) {
      return controls;
    }

    const finished = (createControls) => () => {
      const animationControls = createControls();
      animationControls.finish();
      return animationControls;
    };

    return {
      leaveControls: finished(controls.leaveControls),
      enterControls: finished(controls.enterControls)
    };
  };

  patched.noTransitionPatched = true;
  SlideshowCarousel.prototype.createOnChangeAnimationControls = patched;
});
