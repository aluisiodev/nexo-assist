import { textSimilarity, type ArticleHit } from '@nexo/domain';
import type { Repositories } from '../context';

export const ARTICLE_MIN_SCORE = 0.34;

/**
 * Busca na central de ajuda. O título e as tags pesam mais que o corpo, para que uma
 * palavra genérica no corpo não puxe artigos fora de assunto.
 */
export async function searchArticles(repos: Repositories, query: string, limit = 3): Promise<ArticleHit[]> {
  const articles = await repos.articles.listAll();
  return articles
    .map((article) => {
      const head = textSimilarity(query, `${article.title} ${article.tags.join(' ')}`);
      const body = textSimilarity(query, article.body);
      const score = Math.round(Math.max(head, 0.75 * body) * 100) / 100;
      return { ...article, score };
    })
    .filter((hit) => hit.score >= ARTICLE_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
