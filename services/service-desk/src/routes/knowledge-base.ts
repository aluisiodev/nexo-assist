import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { notFound } from '../errors';
import { validate } from '../middleware/validate';
import { searchArticles } from '../use-cases/knowledge-base';

const SearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(500),
  limit: z.coerce.number().int().min(1).max(10).default(3),
});

/** /kb: central de ajuda. Conteúdo público dentro da empresa, então não exige ator. */
export function knowledgeBaseRoutes() {
  return new Hono<AppEnv>()
    .get('/search', validate('query', SearchQuerySchema), async (c) => {
      const { q, limit } = c.req.valid('query');
      return c.json({ articles: await searchArticles(c.var.repos, q, limit) });
    })
    .get('/articles/:id', async (c) => {
      const article = await c.var.repos.articles.findById(c.req.param('id'));
      if (!article) throw notFound('Artigo não encontrado.');
      return c.json({ article });
    });
}
