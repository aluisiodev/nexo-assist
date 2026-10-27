import type { Client, Row } from '@libsql/client';
import { EmployeeSchema, type Employee } from '@nexo/domain';
import { nullableText, text } from '../db/rows';

const COLUMNS = 'id, name, email, department, role, support_group';

function toEmployee(row: Row): Employee {
  return EmployeeSchema.parse({
    id: text(row, 'id'),
    name: text(row, 'name'),
    email: text(row, 'email'),
    department: text(row, 'department'),
    role: text(row, 'role'),
    supportGroup: nullableText(row, 'support_group'),
  });
}

export class EmployeeRepository {
  constructor(private readonly db: Client) {}

  async findById(id: string): Promise<Employee | null> {
    const rs = await this.db.execute({ sql: `SELECT ${COLUMNS} FROM employees WHERE id = ?`, args: [id] });
    const row = rs.rows[0];
    return row ? toEmployee(row) : null;
  }

  async findByEmail(email: string): Promise<Employee | null> {
    const rs = await this.db.execute({
      sql: `SELECT ${COLUMNS} FROM employees WHERE email = ? COLLATE NOCASE`,
      args: [email.trim()],
    });
    const row = rs.rows[0];
    return row ? toEmployee(row) : null;
  }

  async findManyByIds(ids: readonly string[]): Promise<Employee[]> {
    if (ids.length === 0) return [];
    const rs = await this.db.execute({
      sql: `SELECT ${COLUMNS} FROM employees WHERE id IN (${ids.map(() => '?').join(', ')})`,
      args: [...ids],
    });
    return rs.rows.map(toEmployee);
  }

  async insert(employee: Employee): Promise<void> {
    await this.db.execute({
      sql: `INSERT INTO employees (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [employee.id, employee.name, employee.email, employee.department, employee.role, employee.supportGroup],
    });
  }
}
