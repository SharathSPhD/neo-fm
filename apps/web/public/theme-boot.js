/* Sets data-theme before first paint to avoid the flash-of-wrong-theme.
 * Persisted by `components/theme-toggle.tsx` under the same key. */
(function () {
  try {
    var t = window.localStorage.getItem("neo-fm:theme");
    if (t === "light" || t === "dark") {
      document.documentElement.setAttribute("data-theme", t);
    }
  } catch (e) {
    /* private mode etc — no-op */
  }
})();
