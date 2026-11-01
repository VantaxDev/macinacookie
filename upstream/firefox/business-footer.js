/* Business identification only; existing project attribution is retained. */
(() => {
  "use strict";
  const vat = ["043", "706", "00274"].join("");
  function render() {
    const line = `© ${new Date().getFullYear()} SERVER TAMER DI DANIELE VANTAGGIATO - P.IVA ${vat}`;
    document.querySelectorAll("[data-business-footer]").forEach((footer) => {
      if (footer.textContent !== line) footer.textContent = line;
    });
  }
  render();
  // Refresh long-lived dashboards at rollover and after a suspended tab resumes.
  setInterval(render, 1000);
  document.addEventListener("visibilitychange", render);
})();
