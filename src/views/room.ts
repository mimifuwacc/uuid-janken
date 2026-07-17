import { createIcons, Home } from "lucide";
import { navigate, type View } from "../router";

// Placeholder for the N-player room (Phase 3 builds the real lobby → reveal →
// ranking flow here). Phase 1 only needs the route to resolve so the menu's
// "みんなで対戦" button and QR deep links land somewhere sensible.
export function createRoomView(): View {
  return {
    mount(root, params) {
      root.classList.add("menu");
      root.innerHTML = `
        <div class="menu-inner">
          <h1 class="menu-title">みんなで対戦</h1>
          <p class="menu-tagline">部屋 <code>${params.id ?? ""}</code> は準備中です</p>
          <div class="menu-list">
            <button type="button" class="menu-btn" id="room-back">
              <i data-lucide="home" class="menu-btn-icon"></i>
              <span class="menu-btn-label">メニューに戻る</span>
            </button>
          </div>
        </div>
      `;
      createIcons({ icons: { Home } });
      root
        .querySelector<HTMLButtonElement>("#room-back")
        ?.addEventListener("click", () => navigate("/"));
    },
    unmount() {},
  };
}
