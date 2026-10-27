'use client';

import { createContext, useContext } from 'react';

/** Ações do chat disponíveis para os cards (confirmar rascunho, editar…). */
export interface ChatActions {
  readonly send: (text: string) => void;
  readonly draftAction: (draftId: string, action: 'confirm' | 'cancel') => void;
  readonly editDraft: (draftId: string) => void;
  /** Alguma ação em andamento (desabilita botões). */
  readonly busy: boolean;
}

const noop = () => {};
export const ChatActionsContext = createContext<ChatActions>({
  send: noop,
  draftAction: noop,
  editDraft: noop,
  busy: false,
});

export const useChatActions = () => useContext(ChatActionsContext);
