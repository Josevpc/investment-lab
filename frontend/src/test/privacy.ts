/**
 * Textos com "R$" que ficam fora de <Money> (classe `money`) vazam no modo "ocultar valores", porque é a classe
 * que o CSS desfoca. Devolve os trechos soltos, para o teste afirmar que não há nenhum.
 */
export function unprotectedMoney(root: HTMLElement): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    const parent = node.parentElement;
    if (/R\$\s*\d/.test(text) && !parent?.closest(".money")) found.push(text.trim());
  }
  // Nomes acessíveis (aria-label, title) também são lidos e vistos em dicas: não podem carregar valores.
  for (const el of root.querySelectorAll<HTMLElement>("[aria-label], [title]")) {
    const label = `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""}`;
    if (/R\$\s*\d/.test(label)) found.push(label.trim());
  }
  return found;
}
