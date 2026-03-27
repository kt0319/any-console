export function renderIconStr(icon, color, size = 16) {
  if (!icon) return "";
  if (icon.startsWith("data:image/") || icon.startsWith("icon:")) {
    const src = icon.startsWith("icon:") ? `/icons/${icon.slice(5)}` : icon;
    return `<img src="${src}" width="${size}" height="${size}" class="favicon-icon" draggable="false" alt="" />`;
  }
  if (icon.startsWith("favicon:")) {
    const domain = icon.slice("favicon:".length);
    return `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32" width="${size}" height="${size}" class="favicon-icon" draggable="false" alt="" />`;
  }
  const styles = [`font-size:${size}px`];
  if (color && /^#[0-9a-fA-F]{3,6}$/.test(color)) styles.push(`color:${color}`);
  return `<span class="mdi ${icon}" style="${styles.join(";")}"></span>`;
}
