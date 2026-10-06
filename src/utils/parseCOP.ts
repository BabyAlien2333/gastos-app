/**
 * Convierte un monto escrito por el usuario (formato colombiano) a número.
 *
 * Reglas: el punto es separador de miles y la coma es el decimal.
 *   "1.500.000"  -> 1500000
 *   "1.500,50"   -> 1500.5
 *   "8500"       -> 8500
 *   "abc" / ""   -> 0
 *
 * Úsala en TODA la app para evitar que "1.500" se lea como 1.5.
 */
export function parseCOP(input: string): number {
  if (!input) return 0;
  const clean = input
    .replace(/[^\d.,]/g, '') // quita $, espacios, letras
    .replace(/\./g, '')      // quita separador de miles
    .replace(',', '.');      // coma -> punto decimal
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : 0;
}