// Finds the order number in an email with plain patterns: no model needed for this part.
// Covers "#4821", "order 4812", "order no. 4812", "commande n° 4826", "pedido 4822", "Bestellung 4801".

const PATTERNS = [
  /\b(?:order|orders|commande|pedido|bestellung|ordine|bestelling)\s*(?:no\.?|number|nr\.?|n[°º]\.?|#)?\s*:?\s*[#(]?\s*(\d{3,10})\b/i,
  /#\s?(\d{3,10})\b/,
];

export function extractOrderId(text: string): string | null {
  for (const pattern of PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}
