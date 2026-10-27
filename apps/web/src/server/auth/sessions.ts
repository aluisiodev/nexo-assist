import { createHash, randomBytes } from 'node:crypto';
import type { Client } from '@libsql/client';
import type { Employee, EmployeeRole, SupportGroup } from '@nexo/domain';
import { nullableText, text } from '../db/rows';

/** Quem está logado. Cópia dos dados do diretório no momento do login. */
export interface SessionUser {
  readonly employeeId: string;
  readonly name: string;
  readonly email: string;
  readonly department: string;
  readonly role: EmployeeRole;
  readonly supportGroup: SupportGroup | null;
}

export const SESSION_TTL_MS = 12 * 60 * 60_000;
export const REMEMBER_TTL_MS = 30 * 24 * 60 * 60_000;

/** O banco guarda só o hash do token: um vazamento do banco não dá acesso às sessões. */
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export class SessionRepository {
  constructor(private readonly db: Client) {}

  async create(
    employee: Employee,
    opts: { remember: boolean; now: Date },
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(opts.now.getTime() + (opts.remember ? REMEMBER_TTL_MS : SESSION_TTL_MS));
    await this.db.execute({
      sql: `INSERT INTO sessions (token_hash, employee_id, employee_name, employee_email, department, role, support_group, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        hashToken(token),
        employee.id,
        employee.name,
        employee.email,
        employee.department,
        employee.role,
        employee.supportGroup,
        opts.now.toISOString(),
        expiresAt.toISOString(),
      ],
    });
    return { token, expiresAt };
  }

  async find(token: string, now: Date): Promise<SessionUser | null> {
    const rs = await this.db.execute({
      sql: 'SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?',
      args: [hashToken(token), now.toISOString()],
    });
    const row = rs.rows[0];
    if (!row) return null;
    const role = text(row, 'role');
    const group = nullableText(row, 'support_group');
    return {
      employeeId: text(row, 'employee_id'),
      name: text(row, 'employee_name'),
      email: text(row, 'employee_email'),
      department: text(row, 'department'),
      role: role === 'analyst' ? 'analyst' : 'employee',
      supportGroup: group === 'N1' || group === 'N2' ? group : null,
    };
  }

  async delete(token: string): Promise<void> {
    await this.db.execute({ sql: 'DELETE FROM sessions WHERE token_hash = ?', args: [hashToken(token)] });
  }

  async deleteExpired(now: Date): Promise<void> {
    await this.db.execute({ sql: 'DELETE FROM sessions WHERE expires_at <= ?', args: [now.toISOString()] });
  }
}
