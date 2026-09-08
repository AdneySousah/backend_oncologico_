import { addDays, startOfDay, parseISO } from 'date-fns';

// 👇 CORREÇÃO DE BUG: "new Date('2026-09-04')" (string pura, sem hora) é
// interpretado pelo JS como meia-noite em UTC — não meia-noite local. Em
// qualquer servidor rodando num fuso atrás de UTC (ex: Brasil, UTC-3), isso
// faz a data "voltar" um dia quando depois passa por startOfDay() (que
// arredonda em horário LOCAL). É exatamente o bug relatado: marcar o dia
// 04/09 no calendário de posologia personalizada gravava/mostrava 03/09.
// parseISO() do date-fns interpreta "AAAA-MM-DD" como data LOCAL, evitando
// essa armadilha. Esse helper aceita tanto string quanto um Date já pronto
// (alguns lugares já chamam esta função com um Date, outros com string).
function paraDataLocal(valor) {
  if (valor instanceof Date) return valor;
  return parseISO(valor);
}

// ============================================================================
// Cálculo centralizado de posologia — usado em TODO lugar que precisa saber
// "em que data a caixa acaba" ou "esse dia é de tomar ou de pausar".
//
// Antes, essa conta (comprimidos ÷ posologia = dias) estava duplicada em
// pelo menos 8 lugares diferentes do MonitoramentoMedicamentoController,
// todos assumindo que o paciente toma todo santo dia. Isso não cobre
// tratamentos reais como ciclos de toma/pausa (comum em oncologia), uso a
// cada N dias, ou casos realmente irregulares.
//
// Existir como função única, em vez de repetir a lógica em cada lugar,
// garante que a prévia mostrada pro usuário (calendário de confirmação) e o
// cálculo que de fato grava no banco NUNCA divergem — é a mesma função nos
// dois casos.
// ============================================================================

/**
 * Diz se um determinado dia do ciclo (offset em dias a partir do início,
 * começando em 0) é dia de "toma" ou de "pausa". Não cobre 'personalizada'
 * (que não segue um ciclo repetido — ver calcularDataFimCaixa).
 */
export function ehDiaDeToma(offsetDias, tipoPosologia, parametros = {}) {
  if (!tipoPosologia || tipoPosologia === 'diaria') return true;

  if (tipoPosologia === 'ciclica') {
    const toma = Number(parametros.posologia_ciclo_dias_toma) || 1;
    const pausa = Number(parametros.posologia_ciclo_dias_pausa) || 0;
    const ciclo = toma + pausa;
    if (ciclo <= 0) return true;
    return (offsetDias % ciclo) < toma;
  }

  if (tipoPosologia === 'intervalo') {
    const intervalo = Number(parametros.posologia_intervalo_dias) || 1;
    if (intervalo <= 0) return true;
    return (offsetDias % intervalo) === 0;
  }

  return false;
}

/**
 * Calcula em que data a caixa acaba, considerando o padrão de posologia.
 * @param {Date} dataInicio - data em que o paciente começou a tomar dessa caixa (data_administracao).
 * @param {number} totalCapsulas - quantidade total de comprimidos na caixa.
 * @param {number} posologiaDiaria - comprimidos consumidos em cada dia de "toma".
 * @param {string} tipoPosologia - 'diaria' | 'ciclica' | 'intervalo' | 'personalizada'.
 * @param {object} parametros - campos posologia_ciclo_dias_toma/pausa, posologia_intervalo_dias, posologia_datas_personalizadas.
 * @returns {Date}
 */
export function calcularDataFimCaixa(dataInicio, totalCapsulas, posologiaDiaria, tipoPosologia = 'diaria', parametros = {}) {
  if (!dataInicio || !totalCapsulas || !posologiaDiaria) return dataInicio;

  if (tipoPosologia === 'personalizada') {
    const datas = Array.isArray(parametros.posologia_datas_personalizadas) ? parametros.posologia_datas_personalizadas : [];
    const datasOrdenadas = datas
      .map(d => startOfDay(paraDataLocal(d)))
      .filter(d => d >= startOfDay(dataInicio))
      .sort((a, b) => a - b);

    let restante = totalCapsulas;
    for (const data of datasOrdenadas) {
      restante -= posologiaDiaria;
      if (restante <= 0) return data;
    }
    // As datas marcadas acabaram antes dos comprimidos acabarem — não dá
    // pra calcular além disso (posologia personalizada não se repete
    // sozinha). Devolve a última data marcada como melhor estimativa
    // disponível; quem chamou deve tratar isso pedindo pra marcar mais datas.
    return datasOrdenadas.length > 0 ? datasOrdenadas[datasOrdenadas.length - 1] : dataInicio;
  }

  if (!tipoPosologia || tipoPosologia === 'diaria') {
    const diasDuracao = Math.floor(totalCapsulas / posologiaDiaria);
    return addDays(dataInicio, diasDuracao);
  }

  // 'ciclica' e 'intervalo': simula dia a dia. Tratamentos reais duram no
  // máximo algumas centenas de dias, então isso é rápido — e principalmente,
  // é a MESMA lógica usada em gerarPreviewPosologia, então nunca diverge do
  // que foi mostrado na tela de confirmação.
  let restante = totalCapsulas;
  const LIMITE_DIAS = 3650; // trava de segurança (10 anos) contra parâmetro inválido causar loop longo demais
  for (let offset = 0; offset < LIMITE_DIAS; offset++) {
    if (ehDiaDeToma(offset, tipoPosologia, parametros)) {
      restante -= posologiaDiaria;
      if (restante <= 0) return addDays(dataInicio, offset);
    }
  }
  // Não deveria chegar aqui com parâmetros válidos — devolve uma estimativa
  // grosseira (mesma fórmula simples de sempre) em vez de travar o cálculo.
  return addDays(dataInicio, Math.floor(totalCapsulas / posologiaDiaria));
}

/**
 * Gera a prévia de "toma"/"pausa" pros próximos N dias a partir de uma data
 * de referência — alimenta o calendário de confirmação no frontend.
 */
export function gerarPreviewPosologia(dataInicio, tipoPosologia, parametros = {}, numDias = 35) {
  const inicio = startOfDay(paraDataLocal(dataInicio));
  const datasPersonalizadasSet = tipoPosologia === 'personalizada'
    ? new Set((parametros.posologia_datas_personalizadas || []).map(d => startOfDay(paraDataLocal(d)).getTime()))
    : null;

  const dias = [];
  for (let i = 0; i < numDias; i++) {
    const data = addDays(inicio, i);
    const toma = tipoPosologia === 'personalizada'
      ? datasPersonalizadasSet.has(data.getTime())
      : ehDiaDeToma(i, tipoPosologia, parametros);
    dias.push({ data: data.toISOString().slice(0, 10), toma });
  }
  return dias;
}

/**
 * Extrai só os 4 campos de padrão de posologia de um objeto maior (ex:
 * req.body ou uma instância do model) — evita repetir essa desestruturação
 * em cada controller que usa a função.
 */
export function extrairParametrosPosologia(origem) {
  return {
    posologia_ciclo_dias_toma: origem.posologia_ciclo_dias_toma ?? null,
    posologia_ciclo_dias_pausa: origem.posologia_ciclo_dias_pausa ?? null,
    posologia_intervalo_dias: origem.posologia_intervalo_dias ?? null,
    posologia_datas_personalizadas: origem.posologia_datas_personalizadas ?? null,
  };
}
