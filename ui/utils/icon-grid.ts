export function filterIcons(icons: string[], query: string): string[] {
  if (!query) return icons;
  return icons.filter((name) => name.includes(query));
}

export function buildIconGridModel(icons: string[], query: string, maxDisplay: number): { items: string[]; remaining: number } {
  const filtered = filterIcons(icons, query);
  const items = filtered.slice(0, maxDisplay);
  return {
    items,
    remaining: Math.max(0, filtered.length - maxDisplay),
  };
}
