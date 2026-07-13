/** Load HTML partials — no build step. */
const ASSET_BASE = "assets/partials";

const PARTIALS = [
  ["partial-sidebar", `${ASSET_BASE}/sidebar.html`],
  ["partial-header", `${ASSET_BASE}/header.html`],
  ["partial-screens", `${ASSET_BASE}/screens.html`],
];

export async function loadPartials() {
  if (document.getElementById("nav")) {
    return;
  }
  await Promise.all(
    PARTIALS.map(async ([id, url]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const res = await fetch(url);
      el.innerHTML = await res.text();
    })
  );
  const foot = document.getElementById("partial-footer");
  if (foot) {
    const res = await fetch(`${ASSET_BASE}/footer.html`);
    foot.innerHTML = await res.text();
  }
}
