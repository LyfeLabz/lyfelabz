// Shell footer. A single low-visibility line closing the layout and
// providing a contentinfo landmark for assistive technology. No links,
// no copyright line, no secondary navigation. See spec §3.1.
export function renderFooter(mount: HTMLElement): HTMLElement {
  const doc = mount.ownerDocument;
  const footer = doc.createElement("footer");
  footer.setAttribute("role", "contentinfo");
  footer.className = "shell-footer";
  footer.setAttribute("data-testid", "shell-footer");
  footer.textContent = "LyfeLabz Teacher Platform";
  mount.appendChild(footer);
  return footer;
}
