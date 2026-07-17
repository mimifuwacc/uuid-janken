// Renders a UUID with its last `revealCount` characters "opened" (the rest as
// placeholder dots), split into two rows for a larger font. Shared by the 1v1
// halves and the room's own-UUID reveal. Styling lives in .uuid-* CSS classes.
export function buildUuidRevealHtml(uuid: string, revealCount: number): string {
  if (!uuid) return "";

  const revealFrom = 36 - revealCount;

  const spans = uuid.split("").map((ch, i) => {
    const isDash = ch === "-";
    if (i >= revealFrom) {
      const isNew = i === revealFrom;
      const cls = ["uuid-char", isDash ? "dash" : "", "revealed", isNew ? "new" : ""]
        .filter(Boolean)
        .join(" ");
      return `<span class="${cls}">${ch}</span>`;
    }
    return `<span class="uuid-char${isDash ? " dash" : ""}">${isDash ? "-" : "·"}</span>`;
  });

  // Split into two rows at the third dash (index 18) for larger font.
  const row1 = spans.slice(0, 18).join("");
  const row2 = spans.slice(18).join("");
  return `<div class="uuid-row">${row1}</div><div class="uuid-row">${row2}</div>`;
}
