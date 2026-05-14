(() => {
  console.debug('[llo-tracker] inject.js loaded');
  const fire = () => window.dispatchEvent(new CustomEvent('llo:navigate'));
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function (...a) {
      const r = orig.apply(this, a);
      fire();
      return r;
    };
  }
  window.addEventListener('popstate', fire);
})();
