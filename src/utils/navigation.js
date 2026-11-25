export const APP_SECTIONS = [
  { id: "discover", label: "Discover", path: "/" },
  { id: "library", label: "My Library", path: "/library" }
];

export function parseSectionFromPath(pathname = "/") {
  const normalized = String(pathname || "/").replace(/\/+$/, "") || "/";
  if (normalized === "/library") return "library";
  return "discover";
}

export function pathForSection(sectionId) {
  return APP_SECTIONS.find(section => section.id === sectionId)?.path || "/";
}

export function pushSectionPath(sectionId, historyRef = typeof window !== "undefined" ? window.history : null, locationRef = typeof window !== "undefined" ? window.location : null) {
  if (!historyRef || !locationRef) return;
  const target = pathForSection(sectionId);
  const current = String(locationRef.pathname || "/").replace(/\/+$/, "") || "/";
  if (current !== target) {
    historyRef.pushState({ section: sectionId }, "", target);
  }
}
