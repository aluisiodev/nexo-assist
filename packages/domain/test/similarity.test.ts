import { describe, expect, it } from 'vitest';
import { normalizeText, textSimilarity, tokenize } from '../src';

describe('similarity', () => {
  it('normaliza acentos e pontuação', () => {
    expect(normalizeText('Não conecta à VPN! Erro 809.')).toBe('nao conecta a vpn erro 809');
  });

  it('remove palavras vazias e mantém números', () => {
    expect(tokenize('Meu notebook não conecta na VPN, erro 809')).toEqual(['notebook', 'conecta', 'vpn', 'erro', '809']);
  });

  it('aproxima a mensagem do funcionário de um chamado sobre o mesmo problema', () => {
    const score = textSimilarity(
      'a vpn continua dando erro 809',
      'VPN não conecta no notebook — erro 809. Desde ontem o notebook não conecta na VPN.',
    );
    expect(score).toBeGreaterThanOrEqual(0.6);
  });

  it('separa problemas diferentes', () => {
    const score = textSimilarity('impressora do andar não imprime', 'VPN não conecta no notebook — erro 809');
    expect(score).toBe(0);
  });

  it('textos vazios dão zero', () => {
    expect(textSimilarity('', 'vpn')).toBe(0);
  });
});
