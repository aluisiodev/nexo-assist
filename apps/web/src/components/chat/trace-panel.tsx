'use client';

import { Check, ChevronDown, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { AgentTrace } from '@/lib/chat';

/**
 * Linha de status acima da resposta ("consultou seus chamados") e, ao expandir, o
 * registro completo da decisão: o que entendeu, o que fez, com que segurança e por quê.
 */
export function AgentStatusLine({ trace, expandAll = false }: { trace: AgentTrace | null; expandAll?: boolean }) {
  const [open, setOpen] = useState(expandAll);
  // No console, o analista pode abrir todos os registros de uma vez.
  useEffect(() => setOpen(expandAll), [expandAll]);
  const panelId = useId();
  const steps = trace?.steps ?? [];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        <span className="font-semibold text-ink">Nexo Assist</span>
        {steps.map((s, i) => (
          <span
            key={i}
            className={`flex items-center gap-[5px] ${s.status === 'error' ? 'text-danger-text' : 'text-ink-3'}`}
          >
            {s.status === 'error' ? (
              <X className="size-3" aria-hidden="true" />
            ) : (
              <Check className="size-3" aria-hidden="true" />
            )}
            {s.label}
          </span>
        ))}
        {trace && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            className="flex items-center gap-0.5 rounded px-1 text-ink-3 underline-offset-2 hover:text-ink hover:underline"
          >
            {open ? 'ocultar detalhes' : 'por quê?'}
            <ChevronDown className={`size-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
        )}
      </div>
      {trace && open && <TraceDetails id={panelId} trace={trace} />}
    </div>
  );
}

function TraceDetails({ id, trace }: { id: string; trace: AgentTrace }) {
  const confidence = trace.confidence;
  const level = confidence === undefined ? null : confidence >= 0.75 ? 'alta' : confidence >= 0.5 ? 'média' : 'baixa';
  const barColor = level === 'alta' ? 'bg-success' : level === 'média' ? 'bg-warning' : 'bg-danger';

  return (
    <div id={id} className="max-w-[600px] rounded-xl border border-rule bg-desk px-4 py-3 text-[13px] text-ink-2">
      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2">
        {trace.understood && (
          <>
            <dt className="text-ink-3">Entendi que</dt>
            <dd>{trace.understood}</dd>
          </>
        )}
        {trace.intent && (
          <>
            <dt className="text-ink-3">Intenção</dt>
            <dd className="font-data text-[12px]">{trace.intent}</dd>
          </>
        )}
        {confidence !== undefined && (
          <>
            <dt className="text-ink-3">Segurança</dt>
            <dd className="flex items-center gap-2">
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-rule" aria-hidden="true">
                <span className={`block h-full ${barColor}`} style={{ width: `${Math.round(confidence * 100)}%` }} />
              </span>
              {Math.round(confidence * 100)}% ({level})
            </dd>
          </>
        )}
        {trace.reasoning && (
          <>
            <dt className="text-ink-3">Por quê</dt>
            <dd>{trace.reasoning}</dd>
          </>
        )}
        {trace.steps.length > 0 && (
          <>
            <dt className="text-ink-3">Ações</dt>
            <dd>
              <ol className="flex flex-col gap-1">
                {trace.steps.map((s, i) => (
                  <li key={i} className={s.status === 'error' ? 'text-danger-text' : ''}>
                    <span className="font-medium">{s.label}</span>
                    {s.detail && <span className="text-ink-3"> — {s.detail}</span>}
                  </li>
                ))}
              </ol>
            </dd>
          </>
        )}
        {trace.tools && trace.tools.length > 0 && (
          <>
            <dt className="text-ink-3">Ferramentas</dt>
            <dd className="font-data text-[12px] text-ink-3">{trace.tools.join(' → ')}</dd>
          </>
        )}
        <dt className="text-ink-3">Respondido por</dt>
        <dd>
          {trace.engine}
          {trace.durationMs !== undefined && (
            <span className="text-ink-3"> · {(trace.durationMs / 1000).toFixed(1)} s</span>
          )}
        </dd>
      </dl>
    </div>
  );
}
