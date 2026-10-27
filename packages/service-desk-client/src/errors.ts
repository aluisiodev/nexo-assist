export type ServiceDeskErrorKind =
  /** Sistema fora do ar / timeout / falha de rede, mesmo depois dos retries. */
  | 'unavailable'
  | 'not_found'
  | 'forbidden'
  | 'unauthorized'
  /** Regra de negócio: duplicado, chamado encerrado, janela de reabertura… (ver `code`). */
  | 'conflict'
  | 'validation'
  /** Resposta fora do contrato. */
  | 'invalid_response'
  | 'unknown';

export class ServiceDeskError extends Error {
  constructor(
    readonly kind: ServiceDeskErrorKind,
    message: string,
    readonly options: {
      readonly status?: number;
      /** Código estável vindo do serviço, ex.: "possible_duplicate". */
      readonly code?: string;
      readonly details?: unknown;
      readonly attempts?: number;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ServiceDeskError';
  }

  get status(): number | undefined {
    return this.options.status;
  }

  get code(): string | undefined {
    return this.options.code;
  }

  get details(): unknown {
    return this.options.details;
  }
}

export function kindFromStatus(status: number): ServiceDeskErrorKind {
  if (status === 400 || status === 422) return 'validation';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 502 || status === 503 || status === 504) return 'unavailable';
  return 'unknown';
}

/** Vale tentar de novo? Só para falhas transitórias do legado. */
export const isTransientStatus = (status: number): boolean => status === 502 || status === 503 || status === 504;
