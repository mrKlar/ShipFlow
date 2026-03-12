const root = document.querySelector("#app");

if (root) {
  root.innerHTML = `
    <section class="shell">
      <p class="eyebrow">ShipFlow scaffold</p>
      <h1>REST + SQLite foundation installed</h1>
      <p class="body-copy">The project now has a stable browser shell, Node server, and package scripts. ShipFlow can focus the LLM on the real product behavior.</p>
    </section>
  `;
}
