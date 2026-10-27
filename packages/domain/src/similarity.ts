/**
 * Similaridade textual simples e determinística, usada para:
 *  - encontrar candidatos a chamado duplicado;
 *  - buscar artigos na central de ajuda.
 *
 * Para 5–10 artigos e poucos chamados por pessoa, sobreposição de termos resolve bem
 * e não custa nada. O agent ainda confirma com o funcionário antes de atualizar.
 * Embeddings ficam como evolução (ver README).
 */

// prettier-ignore
const STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos',
  'nas', 'por', 'para', 'pra', 'com', 'sem', 'que', 'e', 'ou', 'se', 'ao', 'aos', 'meu', 'minha', 'meus',
  'minhas', 'seu', 'sua', 'seus', 'suas', 'esta', 'este', 'isso', 'isto', 'esse', 'essa', 'ele', 'ela', 'eu',
  'me', 'mim', 'voce', 'nao', 'sim', 'mais', 'muito', 'muita', 'ja', 'tem', 'ter', 'estou', 'estao', 'foi',
  'ser', 'sao', 'como', 'quando', 'desde', 'apos', 'depois', 'ainda', 'tambem', 'consigo', 'preciso',
  'aparece', 'favor', 'ola', 'oi', 'bom', 'dia', 'tarde', 'noite', 'hoje', 'ontem',
]);

/** Minúsculas, sem acentos, só letras/dígitos e espaços. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Radical simples para português: remove plural e algumas terminações frequentes. */
function stem(token: string): string {
  if (token.length <= 4 || /^\d+$/.test(token)) return token;
  return token
    .replace(/(coes|soes)$/, 'cao')
    .replace(/(mente|ando|endo|indo|ado|ido|ada|ida)$/, '')
    .replace(/s$/, '');
}

/** Termos relevantes, únicos, na ordem em que aparecem. */
export function tokenize(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of normalizeText(text).split(' ')) {
    if (raw.length < 3 && !/^\d+$/.test(raw)) continue;
    if (STOPWORDS.has(raw)) continue;
    const token = stem(raw);
    if (token.length >= 2) seen.add(token);
  }
  return [...seen];
}

/**
 * Coeficiente de sobreposição: |A ∩ B| / min(|A|, |B|), entre 0 e 1.
 * Favorece textos curtos (a mensagem do funcionário) contidos em textos longos (o chamado).
 */
export function textSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}
