// "Linha de tratamento": identidade de um medicamento pro telemonitoramento.
//
// O sistema externo tem um cadastro por APRESENTAÇÃO (Ribociclibe X 21, X 42,
// X 63; Abemaciclibe 50/100/150 mg; LETROZOL x FEMARA; GLIVEC x IMATINIBE),
// e cada cadastro vira uma linha em `medicamentos`. Comparar só o id local
// fazia toda troca de dose ou de marca virar "novo medicamento" e jogava a
// compra na etapa do medicamento errado. A identidade certa é o PRINCÍPIO
// ATIVO (preenchido pelo sync a partir de active_principle); sem ele, o TUSS
// (que é por apresentação); sem os dois, o próprio id.
//
// Mesma função existe no front em src/utils/linhaTratamento.js — manter iguais.
export function normalizarChave(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function chaveLinhaTratamento(medicamento) {
  if (!medicamento) return null;
  const principio = normalizarChave(medicamento.principio_ativo);
  if (principio) return `pa:${principio}`;
  const tuss = String(medicamento.codigo_tuss ?? '').replace(/\D/g, '');
  if (tuss) return `tuss:${tuss}`;
  return medicamento.id !== undefined && medicamento.id !== null ? `id:${medicamento.id}` : null;
}

export function mesmaLinha(medA, medB) {
  if (!medA || !medB) return false;
  if (medA.id !== undefined && medA.id === medB.id) return true;
  const chaveA = chaveLinhaTratamento(medA);
  const chaveB = chaveLinhaTratamento(medB);
  return !!chaveA && chaveA === chaveB;
}
