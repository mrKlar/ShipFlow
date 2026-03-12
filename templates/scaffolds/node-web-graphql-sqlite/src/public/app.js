const root = document.querySelector("#app");

if (root) {
  root.innerHTML = `
    <section class="shell">
      <p class="eyebrow">ShipFlow scaffold</p>
      <h1>GraphQL + SQLite foundation installed</h1>
      <p class="body-copy">The HTTP server, browser shell, and GraphQL dependency are ready. ShipFlow can now spend its tokens on the product logic instead of rebuilding the base stack.</p>
    </section>
  `;
}
