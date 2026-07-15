// Minimal hand-rolled (オレオレ) path router. Deep links resolve because the
// worker serves index.html for unknown paths (wrangler
// not_found_handling: single-page-application) and Vite dev does SPA fallback.
// Kept deliberately tiny — a future Vue migration will replace it wholesale.

export interface View {
  // `root` is the shared #app element; each view owns its full contents.
  mount(root: HTMLElement, params: Record<string, string>): void;
  unmount(): void;
}

export interface Route {
  match(path: string): Record<string, string> | null;
  view: () => View;
}

// Compiles a pattern like "/room/:id" into a matcher capturing named params.
export function route(pattern: string, view: () => View): Route {
  const keys: string[] = [];
  const source = pattern.replace(/:[^/]+/g, (m) => {
    keys.push(m.slice(1));
    return "([^/]+)";
  });
  const regex = new RegExp(`^${source}/?$`);
  return {
    match(path) {
      const m = regex.exec(path);
      if (!m) return null;
      const params: Record<string, string> = {};
      keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return params;
    },
    view,
  };
}

let routes: Route[] = [];
let rootEl: HTMLElement;
let current: View | null = null;

export function startRouter(root: HTMLElement, routeList: Route[]): void {
  rootEl = root;
  routes = routeList;
  window.addEventListener("popstate", () => render(location.pathname));
  render(location.pathname);
}

export function navigate(path: string): void {
  if (path === location.pathname) return;
  history.pushState(null, "", path);
  render(path);
}

function render(path: string): void {
  let matched: { route: Route; params: Record<string, string> } | null = null;
  for (const r of routes) {
    const params = r.match(path);
    if (params) {
      matched = { route: r, params };
      break;
    }
  }
  // Unknown paths fall back to the last route (the menu, registered as "/").
  const chosen = matched ?? { route: routes[routes.length - 1], params: {} };

  current?.unmount();
  // Reset between views so one view's classes/markup never bleed into the next.
  rootEl.className = "";
  rootEl.innerHTML = "";
  current = chosen.route.view();
  current.mount(rootEl, chosen.params);
}
