/**
 * Comportamento de rolagem programática. O `scroll-behavior` do CSS não vale quando o código pede "smooth" de
 * propósito, então quem rola a tela por código consulta a preferência de redução de movimento aqui.
 */
export function scrollBehavior(): ScrollBehavior {
  const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return reduced ? "auto" : "smooth";
}
