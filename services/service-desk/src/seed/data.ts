import type { Article, Employee, Ticket, TicketEventKind, ActorType } from '@nexo/domain';

/**
 * Dados de exemplo (Anexo B). As datas são relativas ao momento do seed, para que os
 * casos "vencido" e "resolvido há 4 dias" continuem verdadeiros quando você rodar.
 */

export const EMPLOYEES: readonly Employee[] = [
  { id: 'emp-ana', name: 'Ana Souza', email: 'ana.souza@nexo.com.br', department: 'Financeiro', role: 'employee', supportGroup: null },
  { id: 'emp-bruno', name: 'Bruno Tavares', email: 'bruno.tavares@nexo.com.br', department: 'Comercial', role: 'employee', supportGroup: null },
  { id: 'emp-carla', name: 'Carla Mendes', email: 'carla.mendes@nexo.com.br', department: 'Controladoria', role: 'employee', supportGroup: null },
  { id: 'emp-diego', name: 'Diego Ramos', email: 'diego.ramos@nexo.com.br', department: 'Marketing', role: 'employee', supportGroup: null },
  { id: 'emp-elisa', name: 'Elisa Prado', email: 'elisa.prado@nexo.com.br', department: 'Recursos Humanos', role: 'employee', supportGroup: null },
  { id: 'ana-rafael', name: 'Rafael Lima', email: 'rafael.lima@nexo.com.br', department: 'TI · Service desk', role: 'analyst', supportGroup: 'N2' },
  { id: 'ana-juliana', name: 'Juliana Costa', email: 'juliana.costa@nexo.com.br', department: 'TI · Service desk', role: 'analyst', supportGroup: 'N1' },
];

export const ARTICLES: readonly Article[] = [
  {
    id: 'kb-vpn-809',
    title: 'VPN com erro 809',
    category: 'rede_vpn',
    tags: ['vpn', 'erro 809', 'conexão remota', 'windows 10'],
    body: 'Reinstale o cliente de VPN pelo portal de softwares e reinicie o computador. Vale apenas para Windows 10; no Windows 11, abra um chamado.',
  },
  {
    id: 'kb-horario',
    title: 'Horário do service desk',
    category: 'outros',
    tags: ['horário', 'atendimento', 'plantão', 'expediente'],
    body: 'De segunda a sexta, das 8h às 18h. Chamados críticos têm plantão 24 horas.',
  },
  {
    id: 'kb-senha-rede',
    title: 'Trocar ou desbloquear a senha da rede',
    category: 'acesso',
    tags: ['senha', 'bloqueio', 'desbloquear', 'login', 'rede'],
    body: 'Use o autoatendimento em senha.nexo.com.br: informe seu e-mail corporativo e confirme o código enviado ao celular cadastrado. Depois de 5 tentativas erradas a conta fica bloqueada por 15 minutos e libera sozinha. A nova senha vale para e-mail, VPN e Wi-Fi.',
  },
  {
    id: 'kb-sap-senha',
    title: 'Senha do SAP bloqueada',
    category: 'acesso',
    tags: ['sap', 'senha', 'bloqueada', 'erp'],
    body: 'A senha do SAP é separada da senha da rede. Se aparecer "usuário bloqueado", abra um chamado de Acesso informando o seu usuário SAP; o desbloqueio é feito pelo time de sistemas em até 4 horas úteis.',
  },
  {
    id: 'kb-outlook-celular',
    title: 'E-mail corporativo no celular',
    category: 'email',
    tags: ['outlook', 'celular', 'email', 'sincronizar', 'mfa'],
    body: 'Instale o app Outlook (iOS ou Android), entre com o e-mail corporativo e aprove o login no Authenticator. Se parar de sincronizar, remova a conta do app e adicione de novo. Apps de e-mail nativos do celular não são suportados.',
  },
  {
    id: 'kb-acesso-pasta',
    title: 'Pedir acesso a pastas do SharePoint',
    category: 'acesso',
    tags: ['sharepoint', 'pasta', 'acesso', 'permissão', 'teams'],
    body: 'Acesso a pastas precisa da aprovação do responsável pela pasta. Abra uma requisição de Acesso com o nome da pasta, o nível (leitura ou edição) e o nome do seu gestor. Prazo: 3 dias úteis depois da aprovação.',
  },
  {
    id: 'kb-notebook-lento',
    title: 'Notebook lento depois de atualização',
    category: 'hardware',
    tags: ['notebook', 'lento', 'lentidão', 'atualização', 'windows', 'desempenho'],
    body: 'Reinicie o notebook (desligar e ligar, não só fechar a tampa), rode o "Diagnóstico Nexo" no portal de softwares e confira se há pelo menos 15 GB livres no disco C:. Se continuar lento, abra um chamado de Hardware informando o resultado do diagnóstico.',
  },
  {
    id: 'kb-instalar-software',
    title: 'Instalar programas',
    category: 'software',
    tags: ['software', 'instalar', 'programa', 'portal de softwares', 'licença'],
    body: 'Programas homologados ficam no portal de softwares (software.nexo.com.br) e instalam sozinhos. Para um programa fora da lista, abra uma requisição de Software com o nome, a versão e a justificativa; programas pagos precisam de aprovação do gestor.',
  },
  {
    id: 'kb-wifi',
    title: 'Wi-Fi do escritório',
    category: 'rede_vpn',
    tags: ['wifi', 'wi-fi', 'internet', 'rede', 'visitante'],
    body: 'Funcionários usam a rede Nexo-Corp com o login e a senha da rede. Visitantes usam a Nexo-Guest; a senha do dia fica na recepção. Se a Nexo-Corp não aparecer, desligue e ligue o Wi-Fi do notebook.',
  },
];

// ─── Chamados ────────────────────────────────────────────────────────────────

interface SeedEvent {
  readonly kind: TicketEventKind;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  readonly body: string | null;
  /** Momento relativo ao seed. */
  readonly at: RelativeTime;
}

/** Dias atrás + hora local (São Paulo). */
export interface RelativeTime {
  readonly daysAgo: number;
  readonly hour: number;
  readonly minute?: number;
}

export interface SeedTicket {
  readonly ticket: Omit<Ticket, 'createdAt' | 'updatedAt' | 'slaReferenceAt' | 'resolvedAt'>;
  readonly createdAt: RelativeTime;
  readonly slaReferenceAt: RelativeTime;
  readonly resolvedAt: RelativeTime | null;
  readonly events: readonly SeedEvent[];
}

const t = (daysAgo: number, hour: number, minute = 0): RelativeTime => ({ daysAgo, hour, minute });

export const TICKETS: readonly SeedTicket[] = [
  // ── Ana Souza: os casos do protótipo ──
  {
    ticket: {
      id: 'INC-20311', type: 'INC', category: 'hardware', title: 'Notebook lento após atualização do Windows',
      description: 'Lentidão geral desde a atualização do Windows. Reiniciar e rodar o diagnóstico da central não resolveu.',
      priority: 'media', priorityReason: 'Atrapalha o trabalho, sem parar tudo.', impact: 'individual',
      status: 'aguardando_analista', requesterId: 'emp-ana', assignedGroup: 'N1', assigneeId: null, source: 'portal',
    },
    createdAt: t(8, 14, 20),
    slaReferenceAt: t(6, 11, 0), // sem resposta há 6 dias: vencido (prazo de 3 dias úteis)
    resolvedAt: null,
    events: [
      { kind: 'created', actorType: 'employee', actorId: 'emp-ana', body: null, at: t(8, 14, 20) },
      { kind: 'comment', actorType: 'analyst', actorId: 'ana-juliana', body: 'Pode rodar o Diagnóstico Nexo e me mandar o resultado?', at: t(7, 9, 30) },
      { kind: 'comment', actorType: 'employee', actorId: 'emp-ana', body: 'Rodei o diagnóstico: disco com 40 GB livres e nenhum erro. Continua lento.', at: t(6, 11, 0) },
    ],
  },
  {
    ticket: {
      id: 'INC-20298', type: 'INC', category: 'acesso', title: 'Acesso à pasta Financeiro no SharePoint',
      description: 'Perdi o acesso de edição à pasta "Financeiro / Fechamento 2026" depois da migração do SharePoint.',
      priority: 'media', priorityReason: 'Atrapalha, mas há alternativa.', impact: 'individual',
      status: 'em_andamento', requesterId: 'emp-ana', assignedGroup: 'N1', assigneeId: 'ana-juliana', source: 'portal',
    },
    createdAt: t(3, 10, 5),
    slaReferenceAt: t(0, 9, 0),
    resolvedAt: null,
    events: [
      { kind: 'created', actorType: 'employee', actorId: 'emp-ana', body: null, at: t(3, 10, 5) },
      { kind: 'status_changed', actorType: 'analyst', actorId: 'ana-juliana', body: 'Pedi a aprovação ao responsável pela pasta.', at: t(0, 9, 0) },
    ],
  },
  {
    ticket: {
      id: 'REQ-10442', type: 'REQ', category: 'hardware', title: 'Segundo monitor para home office',
      description: 'Solicito um segundo monitor para o home office. Aprovado pelo gestor (Marcos Lima).',
      priority: 'baixa', priorityReason: 'Pedido sem urgência.', impact: 'individual',
      status: 'aprovado', requesterId: 'emp-ana', assignedGroup: 'N1', assigneeId: null, source: 'portal',
    },
    createdAt: t(9, 16, 0),
    slaReferenceAt: t(2, 15, 0),
    resolvedAt: null,
    events: [
      { kind: 'created', actorType: 'employee', actorId: 'emp-ana', body: null, at: t(9, 16, 0) },
      { kind: 'status_changed', actorType: 'analyst', actorId: 'ana-juliana', body: 'Aprovado. Entrega pela transportadora em até 5 dias úteis.', at: t(2, 15, 0) },
    ],
  },
  {
    ticket: {
      id: 'INC-20150', type: 'INC', category: 'acesso', title: 'Senha do SAP bloqueada',
      description: 'O SAP mostra "usuário bloqueado" ao entrar.',
      priority: 'media', priorityReason: 'Atrapalha, mas há alternativa.', impact: 'individual',
      status: 'resolvido', requesterId: 'emp-ana', assignedGroup: 'N1', assigneeId: 'ana-juliana', source: 'portal',
    },
    createdAt: t(5, 9, 10),
    slaReferenceAt: t(4, 11, 0),
    resolvedAt: t(4, 11, 0), // resolvido há 4 dias: pode ser reaberto
    events: [
      { kind: 'created', actorType: 'employee', actorId: 'emp-ana', body: null, at: t(5, 9, 10) },
      { kind: 'status_changed', actorType: 'analyst', actorId: 'ana-juliana', body: 'Usuário desbloqueado e senha temporária enviada por e-mail.', at: t(4, 11, 0) },
    ],
  },
  {
    ticket: {
      id: 'INC-19877', type: 'INC', category: 'email', title: 'Outlook não sincroniza no celular',
      description: 'O Outlook do celular parou de receber e-mails.',
      priority: 'media', priorityReason: 'Atrapalha, mas há alternativa.', impact: 'individual',
      status: 'resolvido', requesterId: 'emp-ana', assignedGroup: 'N1', assigneeId: 'ana-juliana', source: 'portal',
    },
    createdAt: t(56, 10, 0),
    slaReferenceAt: t(55, 14, 0),
    resolvedAt: t(55, 14, 0), // fora da janela de 7 dias
    events: [
      { kind: 'created', actorType: 'employee', actorId: 'emp-ana', body: null, at: t(56, 10, 0) },
      { kind: 'status_changed', actorType: 'analyst', actorId: 'ana-juliana', body: 'Conta removida e adicionada de novo no app.', at: t(55, 14, 0) },
    ],
  },
  {
    ticket: {
      id: 'INC-19410', type: 'INC', category: 'acesso', title: 'Troca de senha da rede',
      description: 'Senha da rede expirou e o autoatendimento não envia o código.',
      priority: 'alta', priorityReason: 'Impede você de trabalhar e não há alternativa.', impact: 'individual',
      status: 'fechado', requesterId: 'emp-ana', assignedGroup: 'N1', assigneeId: 'ana-juliana', source: 'portal',
    },
    createdAt: t(108, 8, 40),
    slaReferenceAt: t(108, 10, 0),
    resolvedAt: t(108, 10, 0),
    events: [
      { kind: 'created', actorType: 'employee', actorId: 'emp-ana', body: null, at: t(108, 8, 40) },
      { kind: 'status_changed', actorType: 'analyst', actorId: 'ana-juliana', body: 'Celular atualizado no cadastro; senha trocada.', at: t(108, 10, 0) },
    ],
  },

  // ── Outros funcionários (garantem que a privacidade é testada de verdade) ──
  {
    ticket: {
      id: 'INC-20330', type: 'INC', category: 'rede_vpn', title: 'VPN não conecta — erro 809',
      description: 'Desde hoje cedo a VPN não conecta no notebook (Windows 11), erro 809. Preciso para visitar cliente.',
      priority: 'alta', priorityReason: 'Impede você de trabalhar e não há alternativa.', impact: 'individual',
      status: 'aguardando_analista', requesterId: 'emp-bruno', assignedGroup: 'N1', assigneeId: null, source: 'agent',
    },
    createdAt: t(0, 8, 15),
    slaReferenceAt: t(0, 8, 15),
    resolvedAt: null,
    events: [{ kind: 'created', actorType: 'agent', actorId: 'emp-bruno', body: null, at: t(0, 8, 15) }],
  },
  {
    ticket: {
      id: 'REQ-10460', type: 'REQ', category: 'acesso', title: 'Acesso ao módulo FI do SAP',
      description: 'Preciso de acesso ao módulo FI do SAP para o fechamento de hoje. Gestor: Paulo Reis.',
      priority: 'alta', priorityReason: 'Há um compromisso hoje que depende da solução.', impact: 'individual',
      status: 'aguardando_analista', requesterId: 'emp-carla', assignedGroup: 'N1', assigneeId: null, source: 'agent',
    },
    createdAt: t(0, 9, 30),
    slaReferenceAt: t(0, 9, 30),
    resolvedAt: null,
    events: [{ kind: 'created', actorType: 'agent', actorId: 'emp-carla', body: null, at: t(0, 9, 30) }],
  },
  {
    ticket: {
      id: 'INC-20325', type: 'INC', category: 'email', title: 'Outlook não abre anexos em PDF',
      description: 'Ao clicar em anexos PDF no Outlook do notebook aparece "aplicativo não encontrado".',
      priority: 'media', priorityReason: 'Atrapalha, mas há alternativa.', impact: 'individual',
      status: 'aguardando_usuario', requesterId: 'emp-diego', assignedGroup: 'N1', assigneeId: 'ana-juliana', source: 'portal',
    },
    createdAt: t(4, 13, 0),
    slaReferenceAt: t(2, 10, 0),
    resolvedAt: null,
    events: [
      { kind: 'created', actorType: 'employee', actorId: 'emp-diego', body: null, at: t(4, 13, 0) },
      { kind: 'status_changed', actorType: 'analyst', actorId: 'ana-juliana', body: 'Qual a versão do Windows? Pode enviar um print do erro?', at: t(2, 10, 0) },
    ],
  },
  {
    ticket: {
      id: 'INC-20301', type: 'INC', category: 'hardware', title: 'Impressora do RH não imprime',
      description: 'A impressora do 3º andar (RH) aceita os trabalhos, mas não imprime.',
      priority: 'alta', priorityReason: 'Impede o trabalho de mais de uma pessoa.', impact: 'equipe',
      status: 'resolvido', requesterId: 'emp-elisa', assignedGroup: 'N1', assigneeId: 'ana-juliana', source: 'portal',
    },
    createdAt: t(3, 9, 0),
    slaReferenceAt: t(2, 11, 0),
    resolvedAt: t(2, 11, 0),
    events: [
      { kind: 'created', actorType: 'employee', actorId: 'emp-elisa', body: null, at: t(3, 9, 0) },
      { kind: 'status_changed', actorType: 'analyst', actorId: 'ana-juliana', body: 'Fila de impressão limpa e driver reinstalado.', at: t(2, 11, 0) },
    ],
  },
];

/** Próximos números: o primeiro chamado criado será INC-20517 / REQ-10461. */
export const SEQUENCES = { INC: 20516, REQ: 10460 } as const;
