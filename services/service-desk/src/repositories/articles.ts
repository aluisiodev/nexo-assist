import type { Client, Row } from '@libsql/client';
import { ArticleSchema, type Article } from '@nexo/domain';
import { text } from '../db/rows';

const COLUMNS = 'id, title, body, category, tags';

function toArticle(row: Row): Article {
  return ArticleSchema.parse({
    id: text(row, 'id'),
    title: text(row, 'title'),
    body: text(row, 'body'),
    category: text(row, 'category'),
    tags: JSON.parse(text(row, 'tags')) as unknown,
  });
}

export class ArticleRepository {
  constructor(private readonly db: Client) {}

  async listAll(): Promise<Article[]> {
    const rs = await this.db.execute(`SELECT ${COLUMNS} FROM articles ORDER BY id`);
    return rs.rows.map(toArticle);
  }

  async findById(id: string): Promise<Article | null> {
    const rs = await this.db.execute({ sql: `SELECT ${COLUMNS} FROM articles WHERE id = ?`, args: [id] });
    const row = rs.rows[0];
    return row ? toArticle(row) : null;
  }

  async insert(article: Article): Promise<void> {
    await this.db.execute({
      sql: `INSERT INTO articles (${COLUMNS}) VALUES (?, ?, ?, ?, ?)`,
      args: [article.id, article.title, article.body, article.category, JSON.stringify(article.tags)],
    });
  }
}
