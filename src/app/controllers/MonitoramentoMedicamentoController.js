import MonitoramentoMedicamento from '../models/MonitoramentoMedicamento.js';
import Medicamentos from '../models/Medicamentos.js';
import Pacientes from '../models/Pacientes.js';
import PatientEvaluation from '../models/PatientEvaluation.js';
import Operadora from '../models/Operadora.js';
import EventosPaciente from '../models/EventosPaciente.js'; // NOVO IMPORT AQUI
import HistoricoTrocaMedicamento from '../models/HistoricoTrocaMedicamento.js';
import ReacaoAdversa from '../models/ReacaoAdversa.js';
import MotivoPausaTratamento from '../models/MotivoPausaTratamento.js';
import { addDays, subDays, parseISO } from 'date-fns';
import { Op, fn, col, literal } from 'sequelize';
import { getOperadoraFilter } from '../../utils/permissionUtils.js';
import { calcularDataFimCaixa, gerarPreviewPosologia, extrairParametrosPosologia, obterPeriodosPausa, calcularRestanteNaData } from '../../utils/calcularPosologia.js';
import { chaveLinhaTratamento, mesmaLinha } from '../../utils/linhaTratamento.js';
import * as Yup from 'yup';
import AuditService from '../../services/AuditService.js';

const obterProximoDiaUtil = (dataBase) => {
  const proximoDia = addDays(dataBase, 1);
  const diaDaSemana = proximoDia.getDay();
  if (diaDaSemana === 6) return addDays(proximoDia, 2);
  if (diaDaSemana === 0) return addDays(proximoDia, 1);
  return proximoDia;
};


const ehSolicitandoUsoConjunto = (dadosNovaCompraCliente, modoNovoMedicamento) => {
  return !!(dadosNovaCompraCliente?.mudou_medicamento && modoNovoMedicamento === 'CONJUNTO');
};


// 👇 NOVO: motivos aceitos quando o operador decide NÃO aplicar uma compra que
// o sistema ofereceu neste contato. A chave vai no payload; o rótulo vai pra
// auditoria. MEDICAMENTO_DESCONTINUADO é gerado pelo próprio backend.
const MOTIVOS_NAO_APLICAR_COMPRA = {
  PACIENTE_NAO_RECEBEU: 'Paciente ainda não recebeu / não iniciou esta compra',
  AINDA_NA_CAIXA_ANTERIOR: 'Paciente ainda está usando a caixa anterior (aplicar no próximo contato)',
  DADOS_DIVERGENTES: 'Dados da compra divergem do que o paciente informou',
  COMPRA_NAO_PERTENCE: 'Compra não corresponde a este tratamento',
  OUTRO: 'Outro',
  MEDICAMENTO_DESCONTINUADO: 'Medicamento descontinuado neste contato',
  MEDICAMENTO_PAUSADO: 'Medicamento pausado temporariamente neste contato (a compra volta a ser oferecida ao destravar a pausa)'
};
// Evento cuja previsão de uso passou há mais de N dias é tratado como "antigo"
// (o front já esperava esse campo — evento_antigo — mas o back nunca enviava).
const DIAS_EVENTO_ANTIGO = 90;

const formatarDataBR = (valor) => {
  if (!valor) return 'N/A';
  const texto = valor instanceof Date ? valor.toISOString() : String(valor);
  return texto.split('T')[0].split('-').reverse().join('/');
};

// Data que ordena os eventos de compra: a previsão de administração VIGENTE
// (o sistema externo pode reprogramá-la), com a entrega como fallback.
const dataDeReferenciaEvento = (evento) =>
  evento.data_administracao_prevista || evento.data_entrega_prevista || evento.data_entrega_real;

const compararEventosPorData = (a, b) => {
  const dataA = dataDeReferenciaEvento(a);
  const dataB = dataDeReferenciaEvento(b);
  if (dataA && dataB && dataA !== dataB) return new Date(dataA) - new Date(dataB);
  if (dataA && !dataB) return -1; // evento com data conhecida vem antes de um sem data
  if (!dataA && dataB) return 1;
  return parseInt(a.external_id, 10) - parseInt(b.external_id, 10); // fallback final: ordem de criação
};

const descreverEvento = (evento) => {
  const nome = evento.medicamento?.nome || `medicamento ${evento.medicamento_id}`;
  const entrega = evento.data_entrega_real || evento.data_entrega_prevista;
  return `#${evento.external_id} (${nome}, ${evento.qtd_caixas || 1} cx, entrega ${formatarDataBR(entrega)}, previsão de uso ${formatarDataBR(evento.data_administracao_prevista)})`;
};

// Eventos PENDENTES do mesmo medicamento do evento escolhido que são mais
// antigos do que ele (e posteriores ao evento do ciclo atual): ao aplicar o
// escolhido, esses ficam "pulados" e precisam ser marcados como consumidos —
// senão continuariam pendentes pra sempre sem ninguém saber.
// 👇 CORREÇÃO (cronologia por data, não por id): o sistema externo reaproveita
// programações editando as datas em vez de criar eventos novos, então um
// evento com external_id MENOR pode ser a compra MAIS NOVA (ex: 52433 entregue
// em 17/09 depois do 52598 de 31/07). A marca d'água por id escondia essa
// compra pra sempre. Agora "é posterior ao ciclo atual" é decidido pela data
// de referência do evento comparada à do evento-base do ciclo (ou, sem ele, à
// data de entrega/administração do ciclo). O id só decide quando falta data.
const dataAncoraDoCiclo = async (monitoramento, options = {}) => {
  if (monitoramento.evento_externo_id) {
    const eventoBase = await EventosPaciente.findOne({
      where: { external_id: monitoramento.evento_externo_id, paciente_id: monitoramento.paciente_id },
      attributes: ['external_id', 'data_administracao_prevista', 'data_entrega_prevista', 'data_entrega_real'],
      ...options
    });
    const dataBase = eventoBase ? dataDeReferenciaEvento(eventoBase) : null;
    if (dataBase) return dataBase;
  }
  const fallback = monitoramento.data_entrega || monitoramento.data_administracao;
  if (!fallback) return null;
  return (fallback instanceof Date ? fallback.toISOString() : String(fallback)).split('T')[0];
};

const ehPosteriorAoCicloAtual = (evento, ancora, eventoAtualId) => {
  const extId = parseInt(evento.external_id, 10);
  const atualId = parseInt(eventoAtualId, 10);
  if (!isNaN(atualId) && extId === atualId) return false; // o próprio evento-base nunca é "o próximo"
  const data = dataDeReferenciaEvento(evento);
  if (data && ancora) return new Date(data) >= new Date(ancora); // mesmo dia conta (compra conjunta no mesmo dia)
  return isNaN(atualId) ? true : extId > atualId; // sem data de um dos lados: regra antiga por id
};

// 👇 LINHA DE TRATAMENTO (ver utils/linhaTratamento.js): "mesmo medicamento"
// passa a ser mesmo princípio ativo, não mesmo id local. Atributos que a
// comparação precisa carregar em todo include de Medicamentos envolvido.
const ATRIBUTOS_MEDICAMENTO_LINHA = ['id', 'nome', 'qtd_capsula', 'principio_ativo', 'codigo_tuss'];

// Ids locais de todos os cadastros da mesma linha de um medicamento (a tabela
// é pequena — ~100 linhas — então carrega tudo e compara pela chave).
const idsMedicamentosDaLinha = async (medicamento, options = {}) => {
  const chave = chaveLinhaTratamento(medicamento);
  const todos = await Medicamentos.findAll({ attributes: ['id', 'principio_ativo', 'codigo_tuss'], ...options });
  const ids = new Set([medicamento.id]);
  todos.forEach(m => { if (chaveLinhaTratamento(m) === chave) ids.add(m.id); });
  return [...ids];
};

// { [medicamento_id]: chave da linha } pra um conjunto de ids.
const mapaChavesLinha = async (ids, options = {}) => {
  const distintos = [...new Set(ids.filter(id => id !== null && id !== undefined))];
  if (distintos.length === 0) return {};
  const medicamentos = await Medicamentos.findAll({ where: { id: { [Op.in]: distintos } }, attributes: ['id', 'principio_ativo', 'codigo_tuss'], ...options });
  const mapa = {};
  medicamentos.forEach(m => { mapa[m.id] = chaveLinhaTratamento(m); });
  return mapa;
};

// Chaves das linhas que o paciente tem em acompanhamento ATIVO (PENDENTE ou
// PAUSADO), em qualquer grupo. Compra de uma dessas linhas pertence à etapa
// daquele medicamento — nunca aparece como "novo medicamento" em outra etapa.
const chavesLinhasAtivasDoPaciente = async (pacienteId, options = {}) => {
  const ativos = await MonitoramentoMedicamento.findAll({
    where: { paciente_id: pacienteId, status: { [Op.in]: ['PENDENTE', 'PAUSADO'] } },
    attributes: ['medicamento_id'],
    raw: true,
    ...options
  });
  const mapa = await mapaChavesLinha(ativos.map(a => a.medicamento_id), options);
  return new Set(Object.values(mapa));
};

// 👇 SELETOR DE COMPRA-BASE: resumo de uma compra pendente pro operador escolher
// qual é a atual (usado por candidatos de retomada, linhas novas e medicamentosAtivos).
const resumirEventoPendente = (evento) => {
  const referencia = evento.data_administracao_prevista || evento.data_entrega_prevista || evento.data_entrega_real;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return {
    evento_externo_id: evento.external_id,
    medicamento_id: evento.medicamento_id,
    medicamento_nome: evento.medicamento?.nome,
    qtd_caixas: evento.qtd_caixas,
    data_entrega: evento.data_entrega_real || evento.data_entrega_prevista,
    data_administracao_prevista: evento.data_administracao_prevista,
    dias_desde_previsao: referencia ? Math.floor((hoje - new Date(`${String(referencia).split('T')[0]}T00:00:00`)) / (1000 * 60 * 60 * 24)) : null
  };
};

const listarEventosAnterioresPendentes = async (eventoEscolhido, monitoramentoAtual, options = {}) => {
  // compras anteriores da MESMA LINHA (qualquer apresentação) ficam puladas
  const idsDaLinha = await idsMedicamentosDaLinha(eventoEscolhido.medicamento || { id: eventoEscolhido.medicamento_id }, options);
  const pendentes = await EventosPaciente.findAll({
    where: {
      paciente_id: monitoramentoAtual.paciente_id,
      medicamento_id: { [Op.in]: idsDaLinha },
      recebido: true,
      processado: false,
      excluido_externo: false, // 👈 NOVO: excluído no externo não conta
      external_id: { [Op.ne]: eventoEscolhido.external_id }
    },
    include: [{ model: Medicamentos, as: 'medicamento', attributes: ATRIBUTOS_MEDICAMENTO_LINHA }],
    ...options
  });
  // Só o que está entre o ciclo atual e o evento escolhido: histórico anterior
  // ao ciclo (nunca monitorado) não é "pulado" e fica como está.
  const ancora = await dataAncoraDoCiclo(monitoramentoAtual, options);
  return pendentes
    .filter(e => ehPosteriorAoCicloAtual(e, ancora, monitoramentoAtual.evento_externo_id) && compararEventosPorData(e, eventoEscolhido) < 0)
    .sort(compararEventosPorData);
};

// Grava no próprio evento que ele foi consumido pelo telemonitoramento. Nunca
// sobrescreve uma marcação anterior: a primeira é a que vale.
const marcarEventoProcessado = async (evento, { userId, monitoramentoId = null, tipo, observacao = null }, options = {}) => {
  if (!evento || evento.processado) return false;
  await evento.update({
    processado: true,
    processado_em: new Date(),
    processado_por_id: userId || null,
    monitoramento_id: monitoramentoId,
    tipo_processamento: tipo,
    processamento_observacao: observacao
  }, options);
  return true;
};

// Fecha o processamento de uma compra aplicada num contato: marca o evento
// escolhido (CICLO), marca os anteriores pulados (CONSUMIDO_SEM_CICLO) e
// grava auditoria de tudo — é o rastro que faltava pra responder "esse
// evento foi processado? quando? por quem? virou ciclo?".
const registrarProcessamentoCompra = async ({ compraRevalidada, monitoramentoAtual, novoCiclo, userId, transaction }) => {
  const { evento, eventosAnteriores } = compraRevalidada;
  const cicloId = novoCiclo ? novoCiclo.id : null;
  await marcarEventoProcessado(evento, {
    userId,
    monitoramentoId: cicloId,
    tipo: 'CICLO',
    observacao: `Aplicado no registro de contato do monitoramento #${monitoramentoAtual.id}.`
  }, { transaction });
  await AuditService.log(
    userId, 'Edição', 'Monitoramento', monitoramentoAtual.id,
    `Aplicou a compra ${descreverEvento(evento)} ao fechar o contato${cicloId ? ` → novo ciclo #${cicloId}` : ''}${novoCiclo?.data_administracao ? `, início ${formatarDataBR(novoCiclo.data_administracao)}` : ''}.${compraRevalidada.mudouApresentacao ? ' Apresentação diferente da anterior (mesmo princípio ativo): o ciclo adota o cadastro da compra.' : ''}`
  );
  if (eventosAnteriores.length > 0) {
    for (const anterior of eventosAnteriores) {
      await marcarEventoProcessado(anterior, {
        userId,
        monitoramentoId: null,
        tipo: 'CONSUMIDO_SEM_CICLO',
        observacao: `Pulado ao aplicar a compra mais recente #${evento.external_id} no contato do monitoramento #${monitoramentoAtual.id}, com confirmação do operador de que o medicamento foi utilizado.`
      }, { transaction });
    }
    await AuditService.log(
      userId, 'Edição', 'Monitoramento', monitoramentoAtual.id,
      `Marcou como processadas (medicamento usado, sem ciclo próprio) as compras anteriores ${eventosAnteriores.map(e => descreverEvento(e)).join('; ')} ao aplicar a #${evento.external_id}.`
    );
  }
};

// Auditoria da decisão de NÃO aplicar a compra oferecida — sem isso um
// evento pode ficar pendente por meses sem ninguém saber que foi oferecido.
const registrarCompraNaoAplicada = async ({ monitoramentoAtual, compraOferecidaId, motivo, texto, userId, transaction }) => {
  const evento = await EventosPaciente.findOne({
    where: { external_id: compraOferecidaId, paciente_id: monitoramentoAtual.paciente_id },
    include: [{ model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome'] }],
    transaction
  });
  const descricao = evento ? descreverEvento(evento) : `#${compraOferecidaId}`;
  const rotulo = MOTIVOS_NAO_APLICAR_COMPRA[motivo] || motivo;
  await AuditService.log(
    userId, 'Edição', 'Monitoramento', monitoramentoAtual.id,
    `Compra ${descricao} oferecida e NÃO aplicada neste contato. Motivo: ${rotulo}${texto ? ` — ${texto}` : ''}.`
  );
};

// Regra compartilhada entre o registro individual e o em conjunto: compra
// oferecida e não aplicada exige motivo (e descrição, se "Outro").
const validarMotivoNaoAplicarCompra = ({ contato_efetivo, descontinuar_medicamento, aplicar_nova_compra, compra_oferecida_evento_id, motivo_nao_aplicar_compra, motivo_nao_aplicar_compra_texto }) => {
  const oferecidaSemAplicar = contato_efetivo !== false && !descontinuar_medicamento && !aplicar_nova_compra && !!compra_oferecida_evento_id;
  if (!oferecidaSemAplicar) return null;
  if (!motivo_nao_aplicar_compra) return 'Informe o motivo para não aplicar a compra oferecida neste contato.';
  if (motivo_nao_aplicar_compra === 'OUTRO' && !(motivo_nao_aplicar_compra_texto || '').trim()) return 'Descreva o motivo para não aplicar a compra oferecida.';
  return null;
};

// 👇 NOVO: regra dos "candidatos de retomada" (compra recebida que o
// telemonitoramento nunca viu) extraída de candidatosRetomada pra ser usada
// também pelo index — é ela que diz se um paciente "ainda usa" um
// medicamento que não tem ciclo ativo. Devolve { [pacienteId]: [candidato] }.
const calcularCandidatosRetomada = async (idsArray) => {
  if (!idsArray || idsArray.length === 0) return {};
  // 👇 CORREÇÃO (cronologia por data): a marca d'água era o maior external_id
  // já usado por um ciclo do par paciente+medicamento, e só eventos com id
  // MAIOR viravam candidatos. Como o sistema externo reaproveita programações
  // editando datas, uma compra nova pode ter id menor. Agora a referência é
  // o evento PROCESSADO mais recente do par (por data): candidato = evento
  // recebido, não processado e posterior a ele. Sem evento processado no par,
  // vale a marca d'água antiga por id (ciclos cujo evento nunca foi importado).
  const eventos = await EventosPaciente.findAll({
    where: { paciente_id: { [Op.in]: idsArray }, recebido: true, excluido_externo: false }, // 👈 NOVO: excluído no externo não conta
    include: [{ model: Medicamentos, as: 'medicamento' }]
  });

  // 👇 LINHA DE TRATAMENTO: o par é paciente + linha (princípio ativo), então
  // Ribociclibe X 21 e X 42 são o mesmo par.
  const porPar = {};
  eventos.forEach(e => {
    const chave = `${e.paciente_id}-${chaveLinhaTratamento(e.medicamento) || `id:${e.medicamento_id}`}`;
    if (!porPar[chave]) porPar[chave] = { processados: [], pendentes: [] };
    porPar[chave][e.processado ? 'processados' : 'pendentes'].push(e);
  });

  const monitoramentos = await MonitoramentoMedicamento.findAll({
    where: { paciente_id: { [Op.in]: idsArray }, evento_externo_id: { [Op.not]: null } },
    attributes: ['paciente_id', 'medicamento_id', 'evento_externo_id'],
    raw: true
  });
  const chavesPorMedicamentoId = await mapaChavesLinha(monitoramentos.map(m => m.medicamento_id));
  const watermarkPorPar = {};
  monitoramentos.forEach(m => {
    const chave = `${m.paciente_id}-${chavesPorMedicamentoId[m.medicamento_id] || `id:${m.medicamento_id}`}`;
    const extId = parseInt(m.evento_externo_id, 10);
    if (!watermarkPorPar[chave] || extId > watermarkPorPar[chave]) watermarkPorPar[chave] = extId;
  });

  const candidatos = {};
  Object.entries(porPar).forEach(([chave, { processados, pendentes }]) => {
    if (pendentes.length === 0) return;
    // 👇 SELETOR DE COMPRA-BASE: todas as compras pendentes posteriores ao último
    // processado (ou à marca d'água) entram, da mais antiga pra mais recente; o
    // candidato é a MAIS ANTIGA delas (nunca se pula compra sem confirmação) e
    // leva a lista inteira pro operador escolher.
    const ordenadas = [...pendentes].sort(compararEventosPorData);
    let posteriores;
    if (processados.length > 0) {
      const ultimoProcessado = [...processados].sort(compararEventosPorData).pop();
      posteriores = ordenadas.filter(e => compararEventosPorData(e, ultimoProcessado) > 0);
    } else {
      const marca = watermarkPorPar[chave];
      posteriores = marca === undefined ? ordenadas : ordenadas.filter(e => parseInt(e.external_id, 10) > marca);
    }
    if (posteriores.length === 0) return;
    const evento = posteriores[0];

    const pacienteId = evento.paciente_id;
    if (!candidatos[pacienteId]) candidatos[pacienteId] = [];
    const dataAdminExterna = evento.data_administracao_prevista;
    candidatos[pacienteId].push({
      evento_externo_id: evento.external_id,
      medicamento_id: evento.medicamento_id,
      linha_tratamento: chaveLinhaTratamento(evento.medicamento), // 👈 LINHA DE TRATAMENTO
      medicamento_nome: evento.medicamento?.nome,
      qtd_capsula_conhecida: evento.medicamento?.qtd_capsula != null,
      qtd_caixas: evento.qtd_caixas,
      data_entrega: evento.data_entrega_real || evento.data_entrega_prevista,
      data_previsao_administracao: dataAdminExterna,
      data_sugerida_primeiro_contato: dataAdminExterna ? calcularDataTelemonitoramento(parseISO(dataAdminExterna)) : null,
      eventos_pendentes: posteriores.map(resumirEventoPendente) // 👈 SELETOR DE COMPRA-BASE
    });
  });
  return candidatos;
};

// 👇 NOVO: pacientes "parcialmente encerrados" — sem nenhum ciclo PENDENTE,
// com pelo menos um medicamento DESCONTINUADO, mas que ainda usam OUTRO
// medicamento: existe compra recebida (candidato) de um medicamento
// diferente dos descontinuados. Esses não são "acompanhamento encerrado":
// ficam na lista normal, com alerta, pra alguém iniciar o outro medicamento.
// Devolve { [pacienteId]: dataReferencia } (data do encerramento mais recente,
// usada pra ordenar na lista como contato atrasado).
const listarParcialmenteEncerrados = async (pacienteWhere, idsComPendente) => {
  const descontinuados = await MonitoramentoMedicamento.findAll({
    attributes: ['paciente_id', 'medicamento_id', 'data_telemonitoramento_efetivado', 'createdAt'],
    where: {
      status: 'DESCONTINUADO',
      paciente_id: idsComPendente.length > 0 ? { [Op.notIn]: idsComPendente } : { [Op.ne]: null }
    },
    include: [{ model: Pacientes, as: 'paciente', attributes: [], where: pacienteWhere, required: true }],
    raw: true
  });
  if (descontinuados.length === 0) return {};

  const medicamentosDescontinuadosPorPaciente = {};
  const dataEncerramentoPorPaciente = {};
  descontinuados.forEach(r => {
    if (!medicamentosDescontinuadosPorPaciente[r.paciente_id]) medicamentosDescontinuadosPorPaciente[r.paciente_id] = new Set();
    medicamentosDescontinuadosPorPaciente[r.paciente_id].add(r.medicamento_id);
    const data = new Date(r.data_telemonitoramento_efetivado || r.createdAt).getTime();
    if (!dataEncerramentoPorPaciente[r.paciente_id] || data > dataEncerramentoPorPaciente[r.paciente_id]) dataEncerramentoPorPaciente[r.paciente_id] = data;
  });

  const candidatos = await calcularCandidatosRetomada(Object.keys(medicamentosDescontinuadosPorPaciente).map(Number));
  // 👇 LINHA DE TRATAMENTO: "medicamento diferente dos descontinuados" por linha, não por id
  const chavesPorMedicamentoId = await mapaChavesLinha(descontinuados.map(r => r.medicamento_id));
  const parciais = {};
  Object.entries(candidatos).forEach(([pacienteId, lista]) => {
    const descontinuadosDoPaciente = medicamentosDescontinuadosPorPaciente[pacienteId] || new Set();
    const linhasDescontinuadas = new Set([...descontinuadosDoPaciente].map(id => chavesPorMedicamentoId[id] || `id:${id}`));
    if (lista.some(c => !linhasDescontinuadas.has(c.linha_tratamento || `id:${c.medicamento_id}`))) {
      parciais[pacienteId] = dataEncerramentoPorPaciente[pacienteId];
    }
  });
  return parciais;
};

// 👇 NOVO (data em que parou + comprimidos restantes): projeta quantos
// comprimidos o paciente tinha no primeiro dia sem tomar, a partir do ciclo
// (início da caixa, total, posologia, padrão e pausas anteriores) ou de uma
// base informada pela tela (caixa nova ainda não gravada). É a conta que a
// pessoa do contato confirma com o paciente ("você tem X?") na pausa
// temporária e na descontinuação.
const projetarRestanteNaParada = (monitoramento, dataParada, base = null) => {
  const dataInicio = base?.data_inicio || monitoramento.data_administracao || monitoramento.data_entrega;
  const qtdTotal = base?.qtd_total ?? monitoramento.qtd_total_capsulas;
  const posologia = base?.posologia ?? monitoramento.posologia_diaria;
  const tipoPosologia = base?.tipo_posologia || monitoramento.tipo_posologia || 'diaria';
  const parametros = base ? extrairParametrosPosologia(base.parametros || {}) : extrairParametrosPosologia(monitoramento);
  const periodosPausa = base ? [] : obterPeriodosPausa(monitoramento);
  const { consumidos, restante, diasContados } = calcularRestanteNaData(dataInicio, qtdTotal, posologia, tipoPosologia, parametros, periodosPausa, dataParada);
  return {
    data_parada: dataParada,
    data_inicio: dataInicio ? String(dataInicio instanceof Date ? dataInicio.toISOString() : dataInicio).split('T')[0] : null,
    qtd_total: qtdTotal,
    posologia_diaria: posologia,
    tipo_posologia: tipoPosologia,
    dias_de_toma_contados: diasContados,
    consumidos,
    qtd_restante_projetada: restante
  };
};

// Valida a decisão "parou em X, tem Y comprimidos" (pausa e descontinuação).
// Devolve { erro } ou { projecao, qtd_restante_informada, qtd_restante_confirmada }.
const resolverRestanteNaParada = (monitoramento, { data_parada, qtd_restante_informada, qtd_restante_confirmada }, base = null) => {
  if (!data_parada) return { erro: 'Informe a data em que o paciente parou de tomar o medicamento.' };
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const parada = parseISO(data_parada);
  if (isNaN(parada.getTime())) return { erro: 'Data em que parou de tomar inválida.' };
  if (parada > hoje) return { erro: 'A data em que parou de tomar não pode ser no futuro.' };
  const projecao = projetarRestanteNaParada(monitoramento, data_parada, base);
  const confirmada = qtd_restante_confirmada === true || qtd_restante_confirmada === 'true';
  let informada = confirmada ? projecao.qtd_restante_projetada : qtd_restante_informada;
  if (informada === null || informada === undefined || informada === '') return { erro: 'Confirme com o paciente quantos comprimidos ele tem na caixa.' };
  informada = parseInt(informada, 10);
  if (isNaN(informada) || informada < 0) return { erro: 'Quantidade de comprimidos restantes inválida.' };
  return { projecao, qtd_restante_informada: informada, qtd_restante_confirmada: informada === projecao.qtd_restante_projetada };
};

const revalidarDadosNovaCompra = async (monitoramentoAtual, dadosNovaCompraCliente, modoNovoMedicamento, options = {}, { confirmarConsumoAnteriores = false } = {}) => {
  if (!dadosNovaCompraCliente || !dadosNovaCompraCliente.evento_externo_id) {
    const erro = new Error('Dados da nova compra ausentes ou incompletos.');
    erro.status = 400;
    throw erro;
  }
  const evento = await EventosPaciente.findOne({
    where: {
      external_id: dadosNovaCompraCliente.evento_externo_id,
      paciente_id: monitoramentoAtual.paciente_id
    },
    include: [{ model: Medicamentos, as: 'medicamento' }],
    ...options
  });
  if (!evento) {
    const erro = new Error('O evento de compra informado não foi encontrado ou não pertence mais a este paciente. Atualize a tela e tente novamente.');
    erro.status = 409;
    throw erro;
  }
  // 👇 NOVO: um evento consumido (virou ciclo ou foi marcado como usado) não
  // pode ser aplicado de novo — protege contra tela defasada / duplo envio.
  if (evento.processado) {
    const erro = new Error(`A compra #${evento.external_id} já foi processada em ${formatarDataBR(evento.processado_em)} e não pode ser aplicada novamente. Atualize a tela e tente de novo.`);
    erro.status = 409;
    throw erro;
  }
  // 👇 NOVO: evento excluído no sistema externo (sumiu da lista no sync) não pode virar ciclo
  if (evento.excluido_externo) {
    const erro = new Error(`A compra #${evento.external_id} foi excluída no sistema externo e não pode ser aplicada. Atualize a tela.`);
    erro.status = 409;
    throw erro;
  }

  // 👇 LINHA DE TRATAMENTO: troca de medicamento é mudança de PRINCÍPIO ATIVO.
  // Mesma linha com outro cadastro (Ribociclibe X 21 → X 42, LETROZOL → FEMARA)
  // é mudança de apresentação: o ciclo seguinte ADOTA o cadastro da compra
  // (nome e caixa certos; posologia confirmada pelo operador), sem histórico de troca.
  const medicamentoAtual = await Medicamentos.findByPk(monitoramentoAtual.medicamento_id, { attributes: ATRIBUTOS_MEDICAMENTO_LINHA, ...options });
  const mesmaLinhaQueAtual = mesmaLinha(evento.medicamento, medicamentoAtual);
  const mudouMedicamento = !mesmaLinhaQueAtual;
  const mudouApresentacao = mesmaLinhaQueAtual && evento.medicamento_id !== monitoramentoAtual.medicamento_id;
  const ehUsoConjunto = mudouMedicamento && modoNovoMedicamento === 'CONJUNTO';

  if (ehUsoConjunto) {
    let medicamentosDoGrupoIds = [monitoramentoAtual.medicamento_id];
    if (monitoramentoAtual.grupo_medicamentos_id) {
      const irmaos = await MonitoramentoMedicamento.findAll({
        where: {
          grupo_medicamentos_id: monitoramentoAtual.grupo_medicamentos_id,
          status: { [Op.notIn]: ['CANCELADO', 'DESCONTINUADO'] },
          id: { [Op.ne]: monitoramentoAtual.id }
        },
        ...options
      });
      medicamentosDoGrupoIds = [...new Set([monitoramentoAtual.medicamento_id, ...irmaos.map(i => i.medicamento_id)])];
    }
    if (medicamentosDoGrupoIds.length >= 10) {
      const erro = new Error('Este paciente já possui o número máximo de medicamentos em acompanhamento simultâneo. Não é possível aplicar como uso em conjunto.');
      erro.status = 409;
      throw erro;
    }
    // 👇 LINHA DE TRATAMENTO: só entra como "novo medicamento" uma linha que o
    // paciente NÃO tem em acompanhamento ativo (em qualquer grupo). Outra
    // apresentação de um medicamento já acompanhado pertence à etapa dele.
    const linhasAtivas = await chavesLinhasAtivasDoPaciente(monitoramentoAtual.paciente_id, options);
    if (linhasAtivas.has(chaveLinhaTratamento(evento.medicamento))) {
      const erro = new Error(`${evento.medicamento?.nome} é o mesmo medicamento (princípio ativo) de um acompanhamento já ativo deste paciente — aplique a compra na etapa daquele medicamento.`);
      erro.status = 409;
      throw erro;
    }
  }

  const totalCapsulasNovas = (evento.medicamento?.qtd_capsula || 0) * (evento.qtd_caixas || 1);

  // 👇 NOVO: o operador pode escolher uma compra mais recente do que a mais
  // antiga pendente (ex: paciente já está na caixa seguinte). As anteriores
  // do mesmo medicamento não somem: ficam marcadas como consumidas sem
  // ciclo próprio — mas só com confirmação explícita de quem está no contato.
  const eventosAnteriores = await listarEventosAnterioresPendentes(evento, monitoramentoAtual, options);
  if (eventosAnteriores.length > 0 && !confirmarConsumoAnteriores) {
    const erro = new Error(`Existem compras anteriores deste medicamento ainda pendentes (${eventosAnteriores.map(e => `#${e.external_id}`).join(', ')}). Confirme que o paciente já as utilizou para marcá-las como processadas, ou aplique a mais antiga.`);
    erro.status = 400;
    throw erro;
  }

  return {
    mudouMedicamento,
    mudouApresentacao,
    ehUsoConjunto,
    medicamentoNovoId: evento.medicamento_id, // mesma linha com outro cadastro: adota o cadastro da compra
    medicamentoAtualId: monitoramentoAtual.medicamento_id,
    qtdCaixas: evento.qtd_caixas || 1,
    totalCapsulasNovas,
    dataEntrega: evento.data_entrega_real || evento.data_entrega_prevista,
    eventoExternoId: evento.external_id,
    evento,
    eventosAnteriores
  };
};

// Mesma regra de +5 dias (pulando fim de semana) usada no front, para calcular
// a data do primeiro telemonitoramento de um medicamento adicional (uso conjunto)
const calcularDataTelemonitoramento = (dataBase) => {
  let data = addDays(dataBase, 5);
  const diaDaSemana = data.getDay();
  if (diaDaSemana === 6) data = addDays(data, 2);
  else if (diaDaSemana === 0) data = addDays(data, 1);

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  if (data < hoje) {
    return hoje;
  }
  return data;
};

class MonitoramentoMedicamentoController {
  async store(req, res) {
    const schema = Yup.object().shape({
      paciente_id: Yup.number().integer().required(),
      patient_evaluation_id: Yup.number().integer().nullable(),
      medicamentos_confirmados: Yup.array().of(
        Yup.object().shape({
          medicamento_id: Yup.number().integer().required(),
          posologia_diaria: Yup.number().integer().required(),
          data_entrega: Yup.date().required(),
          data_telemonitoramento: Yup.date().required(),
          qtd_capsula_manual: Yup.number().integer().nullable(),
          qtd_caixas: Yup.number().integer().nullable(),
          // 👇 NOVO: padrão de posologia fora do padrão diário. Se omitido,
          // assume 'diaria' — comportamento idêntico ao de sempre.
          tipo_posologia: Yup.string().oneOf(['diaria', 'ciclica', 'intervalo', 'personalizada']).nullable(),
          posologia_ciclo_dias_toma: Yup.number().integer().positive().nullable(),
          posologia_ciclo_dias_pausa: Yup.number().integer().min(0).nullable(),
          posologia_intervalo_dias: Yup.number().integer().positive().nullable(),
          posologia_datas_personalizadas: Yup.array().of(Yup.date()).nullable(),
          // 👇 SELETOR DE COMPRA-BASE: o operador escolheu qual compra pendente é a
          // atual; as anteriores da mesma linha são marcadas como consumidas sem ciclo.
          confirmar_consumo_eventos_anteriores: Yup.boolean().nullable(),
          // 👇 NOVO: presente quando o medicamento vem de um candidato de
          // retomada detectado automaticamente. Se ausente (fluxo original de
          // onboarding), o comportamento continua igual ao de antes.
          evento_externo_id: Yup.number().integer().nullable()
        })
      ).min(1).max(10).required()
    });
    try { await schema.validate(req.body, { abortEarly: false }); }
    catch (err) { return res.status(400).json({ error: 'Falha na validação', messages: err.inner }); }

    const { paciente_id, patient_evaluation_id, medicamentos_confirmados } = req.body;

    try {
      // 👇 NOVO: impede criar um novo tratamento se o paciente já tiver
      // qualquer ciclo ativo. Sem essa trava, esse endpoint reaproveitado pra
      // retomada poderia, por engano ou corrida entre abas, criar um segundo
      // conjunto de ciclos por cima de um paciente já em acompanhamento.
      // 👇 LINHA DE TRATAMENTO: com o paciente já em acompanhamento, este endpoint
      // passa a servir pra INICIAR um medicamento novo (linha sem ciclo ativo) em
      // conjunto — o ciclo novo entra no grupo dos ativos. Linha que já tem ciclo
      // ativo continua bloqueada (seria um segundo ciclo do mesmo medicamento).
      const ciclosAtivos = await MonitoramentoMedicamento.findAll({
        where: { paciente_id, status: { [Op.in]: ['PENDENTE', 'PAUSADO'] } }
      });
      const chavesAtivas = new Set(Object.values(await mapaChavesLinha(ciclosAtivos.map(c => c.medicamento_id))));

      const medicamentosCarregados = [];
      for (let item of medicamentos_confirmados) {
        const medicamento = await Medicamentos.findByPk(item.medicamento_id);
        if (!medicamento) return res.status(404).json({ error: `Medicamento não encontrado.` });
        if (chavesAtivas.has(chaveLinhaTratamento(medicamento))) {
          return res.status(409).json({ error: `${medicamento.nome} já está em acompanhamento ativo para este paciente. Aplique a compra pelo contato de telemonitoramento desse medicamento.` });
        }
        const qtdPorCaixa = item.qtd_capsula_manual || medicamento.qtd_capsula;
        if (!qtdPorCaixa) {
          return res.status(400).json({
            error: 'MISSING_QTD_CAPSULA',
            needs_qtd_capsula: true,
            medicamento_id: medicamento.id,
            message: `Informe a quantidade total de comprimidos da caixa para ${medicamento.nome}.`
          });
        }

        // 👇 NOVO: se o front informou um evento específico (veio de um
        // candidato detectado), confirma que ele realmente existe e pertence
        // a este paciente+medicamento antes de usar como baseline — nunca
        // confia cegamente no id enviado. Se não bater (ou não foi enviado),
        // cai no comportamento original: pega o último evento conhecido.
        // 👇 SELETOR DE COMPRA-BASE (mesma regra do telemonitoramento): a compra-base
        // é a escolhida pelo operador entre as pendentes DA LINHA (qualquer
        // apresentação do princípio ativo); sem escolha, a mais ANTIGA pendente —
        // nunca se pula compra sem alguém dizer que a caixa já foi consumida.
        // Compras anteriores à escolhida só são puladas com a confirmação explícita
        // e ficam marcadas como CONSUMIDO_SEM_CICLO.
        const idsDaLinha = await idsMedicamentosDaLinha(medicamento);
        const pendentesDaLinha = (await EventosPaciente.findAll({
          where: { paciente_id, medicamento_id: { [Op.in]: idsDaLinha }, recebido: true, processado: false, excluido_externo: false },
          include: [{ model: Medicamentos, as: 'medicamento', attributes: ATRIBUTOS_MEDICAMENTO_LINHA }]
        })).sort(compararEventosPorData);
        let eventoExternoIdBase = null;
        let eventosAnterioresAConsumir = [];
        if (item.evento_externo_id) {
          const escolhido = pendentesDaLinha.find(e => Number(e.external_id) === Number(item.evento_externo_id));
          if (!escolhido) {
            return res.status(409).json({ error: `A compra #${item.evento_externo_id} não está mais disponível para ${medicamento.nome} (já processada, excluída ou de outro medicamento). Atualize a tela.` });
          }
          eventoExternoIdBase = escolhido.external_id;
          eventosAnterioresAConsumir = pendentesDaLinha.filter(e => compararEventosPorData(e, escolhido) < 0);
          if (eventosAnterioresAConsumir.length > 0 && item.confirmar_consumo_eventos_anteriores !== true) {
            return res.status(400).json({
              error: `Há ${eventosAnterioresAConsumir.length} compra(s) de ${medicamento.nome} anterior(es) à escolhida. Confirme que o paciente já as utilizou para continuar.`,
              eventos_anteriores: eventosAnterioresAConsumir.map(e => e.external_id)
            });
          }
        } else if (pendentesDaLinha.length > 0) {
          eventoExternoIdBase = pendentesDaLinha[0].external_id;
        } else {
          // sem pendente nenhum (ex.: retomada com tudo já consumido): a mais recente de todas
          const todos = await EventosPaciente.findAll({ where: { paciente_id, medicamento_id: { [Op.in]: idsDaLinha } } });
          const base = [...todos].sort(compararEventosPorData).pop();
          eventoExternoIdBase = base ? base.external_id : null;
        }

        // 👇 NOVO: busca automática do ciclo descontinuado anterior deste
        // mesmo paciente+medicamento, se existir — é o que alimenta o vínculo
        // de retomada, sem o atendente precisar escolher nada.
        const cicloDescontinuadoAnterior = await MonitoramentoMedicamento.findOne({
          where: { paciente_id, medicamento_id: item.medicamento_id, status: 'DESCONTINUADO' },
          order: [['data_telemonitoramento_efetivado', 'DESC']]
        });

        medicamentosCarregados.push({
          item,
          medicamento,
          qtdPorCaixa,
          eventoExternoIdBase,
          eventosAnterioresAConsumir,
          retomadoDeId: cicloDescontinuadoAnterior ? cicloDescontinuadoAnterior.id : null
        });
      }

      // 👇 LINHA DE TRATAMENTO: se o paciente já tem ciclo ativo, o novo entra no
      // grupo dele (ou cria o grupo e põe os ativos dentro) — vira contato em conjunto.
      const grupoExistente = ciclosAtivos.find(c => c.grupo_medicamentos_id)?.grupo_medicamentos_id || null;
      const grupoMedicamentosId = grupoExistente
        || ((ciclosAtivos.length + medicamentos_confirmados.length) > 1 ? `grp-${paciente_id}-${Date.now()}` : null);

      const agendamentos = await MonitoramentoMedicamento.sequelize.transaction(async (transaction) => {
        if (grupoMedicamentosId && ciclosAtivos.length > 0) {
          await MonitoramentoMedicamento.update(
            { grupo_medicamentos_id: grupoMedicamentosId },
            { where: { id: { [Op.in]: ciclosAtivos.map(c => c.id) }, grupo_medicamentos_id: null }, transaction }
          );
        }
        const criados = [];
        for (let { item, medicamento, qtdPorCaixa, eventoExternoIdBase, eventosAnterioresAConsumir, retomadoDeId } of medicamentosCarregados) {
          if (item.qtd_capsula_manual && !medicamento.qtd_capsula) {
            await medicamento.update({ qtd_capsula: item.qtd_capsula_manual }, { transaction });
          }
          const qtdCaixas = item.qtd_caixas || 1;
          const totalCapsulas = qtdPorCaixa * qtdCaixas;
          const dataEntrega = parseISO(item.data_entrega);
          const tipoPosologia = item.tipo_posologia || 'diaria';
          const parametrosPosologia = extrairParametrosPosologia(item);
          const dataFimCaixa = calcularDataFimCaixa(dataEntrega, totalCapsulas, item.posologia_diaria, tipoPosologia, parametrosPosologia);
          const dataProximoContato = parseISO(item.data_telemonitoramento);

          const novoMonitoramento = await MonitoramentoMedicamento.create({
            paciente_id,
            patient_evaluation_id,
            medicamento_id: item.medicamento_id,
            posologia_diaria: item.posologia_diaria,
            tipo_posologia: tipoPosologia,
            ...parametrosPosologia,
            data_entrega: dataEntrega,
            data_calculada_fim_caixa: dataFimCaixa,
            data_proximo_contato: dataProximoContato,
            qtd_caixas: qtdCaixas,
            qtd_total_capsulas: totalCapsulas,
            evento_externo_id: eventoExternoIdBase,
            grupo_medicamentos_id: grupoMedicamentosId,
            retomado_de_monitoramento_id: retomadoDeId,
            status: 'PENDENTE'
          }, { transaction });

          // 👇 NOVO: a compra base vira "processada" no próprio evento, com
          // o ciclo que a consumiu — antes só existia o evento_externo_id
          // copiado no ciclo, sem data nem autor.
          if (eventoExternoIdBase) {
            const eventoBase = await EventosPaciente.findOne({
              where: { external_id: eventoExternoIdBase, paciente_id },
              include: [{ model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome'] }],
              transaction
            });
            const marcou = await marcarEventoProcessado(eventoBase, {
              userId: req.userId,
              monitoramentoId: novoMonitoramento.id,
              tipo: 'CICLO',
              observacao: `Usado como compra base ao iniciar o acompanhamento (monitoramento #${novoMonitoramento.id}).`
            }, { transaction });
            if (marcou) {
              await AuditService.log(req.userId, 'Criação', 'Monitoramento', novoMonitoramento.id, `Iniciou o acompanhamento de ${medicamento.nome} a partir da compra ${descreverEvento(eventoBase)}.`);
            }
          }
          // 👇 SELETOR DE COMPRA-BASE: compras anteriores à escolhida, confirmadas
          // como já utilizadas, saem das pendentes sem virar ciclo.
          for (const anterior of (eventosAnterioresAConsumir || [])) {
            const marcou = await marcarEventoProcessado(anterior, {
              userId: req.userId,
              monitoramentoId: novoMonitoramento.id,
              tipo: 'CONSUMIDO_SEM_CICLO',
              observacao: `Compra anterior à escolhida como base (#${eventoExternoIdBase}) ao iniciar o acompanhamento; o operador confirmou que já foi utilizada.`
            }, { transaction });
            if (marcou) {
              await AuditService.log(req.userId, 'Edição', 'Monitoramento', novoMonitoramento.id, `Ao iniciar o acompanhamento de ${medicamento.nome} pela compra #${eventoExternoIdBase}, marcou a compra ${descreverEvento(anterior)} como já utilizada (sem ciclo).`);
            }
          }

          criados.push(novoMonitoramento);
        }
        return criados;
      });

      return res.status(201).json(agendamentos);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao gerar monitoramento', details: error.message });
    }
  }
  async index(req, res) {
    try {
      const { operadora_id, page = 1, limit = 20, search = '', incluir_descontinuados } = req.query;
      const apenasDescontinuados = incluir_descontinuados === 'true' || incluir_descontinuados === true;
      const offset = (page - 1) * limit;
      const permission = await getOperadoraFilter(req.userId, operadora_id);
      if (!permission.authorized) {
        if (permission.emptyResult) return res.json({ data: [], total: 0, totalPages: 0, currentPage: 1 });
        return res.status(permission.status).json({ error: permission.error });
      }

      let pacienteWhere = { ...permission.whereClause, tratamento_pausado: { [Op.not]: true } };
      if (search) {
        const termosPesquisa = search.trim().split(/\s+/);
        const condicoesBusca = termosPesquisa.map(termo => ({
          [Op.or]: [{ nome: { [Op.iLike]: `%${termo}%` } }, { sobrenome: { [Op.iLike]: `%${termo}%` } }]
        }));
        pacienteWhere = { ...pacienteWhere, [Op.and]: condicoesBusca };
      }

      // ==========================================================
      // Caminho ORIGINAL — pacientes com pelo menos um registro PENDENTE.
      // Continua sendo o padrão da tela.
      // 👇 CORREÇÃO: a paginação é feita por PACIENTE DISTINTO, não por linha
      // de monitoramento. Antes, o LIMIT/OFFSET era aplicado direto nas linhas
      // de MonitoramentoMedicamento — um paciente com 2 medicamentos em uso
      // conjunto podia ter suas duas linhas caindo em páginas diferentes
      // (cada uma ordenada pela própria data_proximo_contato), fazendo o
      // mesmo paciente aparecer duplicado em duas páginas.
      // ==========================================================
      if (!apenasDescontinuados) {
        const pacientesComPendencia = await MonitoramentoMedicamento.findAll({
          attributes: [
            'paciente_id',
            [fn('MIN', col('MonitoramentoMedicamento.data_proximo_contato')), 'proxima_data']
          ],
          where: { status: 'PENDENTE' },
          include: [
            {
              model: Pacientes, as: 'paciente', attributes: [],
              where: pacienteWhere, required: true
            }
          ],
          group: ['MonitoramentoMedicamento.paciente_id'],
          // 👇 CORREÇÃO: "paciente_id" como critério de desempate depois da
          // data. Sem isso, quando dois ou mais pacientes têm EXATAMENTE a
          // mesma data de próximo contato, o Postgres não garante a mesma
          // ordem relativa entre duas chamadas separadas (página 1 e página
          // 2 são duas queries diferentes) — um paciente perto da fronteira
          // entre páginas podia "trocar de lugar" de uma chamada pra outra e
          // acabar aparecendo (ou sumindo) nas duas páginas. Com um segundo
          // critério de desempate único e estável, a ordem fica sempre a
          // mesma, não importa quantas vezes a lista for buscada.
          order: [[literal('proxima_data'), 'ASC'], [col('MonitoramentoMedicamento.paciente_id'), 'ASC']],
          subQuery: false,
          raw: true
        });

        // 👇 NOVO: pacientes que encerraram UM medicamento mas ainda usam outro
        // (compra recebida de outro medicamento sem ciclo) entram na lista
        // normal — não são "acompanhamento encerrado". Ordenam pela data do
        // encerramento, como um contato atrasado: alguém precisa iniciar o
        // outro medicamento. A paginação (por paciente) passou a ser feita
        // aqui em memória pra mesclar os dois conjuntos sem quebrar a ordem.
        const idsComPendente = pacientesComPendencia.map(p => p.paciente_id);
        const parciais = await listarParcialmenteEncerrados(pacienteWhere, idsComPendente);
        const ordenados = [
          ...pacientesComPendencia.map(p => ({ paciente_id: p.paciente_id, data: new Date(p.proxima_data).getTime() })),
          ...Object.entries(parciais).map(([pacienteId, data]) => ({ paciente_id: Number(pacienteId), data }))
        ].sort((a, b) => (a.data - b.data) || (a.paciente_id - b.paciente_id));

        if (ordenados.length === 0) return res.json({ data: [], total: 0, totalPages: 0, currentPage: parseInt(page) });

        // Total de pacientes distintos (não de linhas) — base real pra paginação
        const totalPacientesDistintos = ordenados.length;

        const uniquePatientIds = ordenados.slice(parseInt(offset), parseInt(offset) + parseInt(limit)).map(p => p.paciente_id);
        const allRecordsForPage = await MonitoramentoMedicamento.findAll({
          where: { paciente_id: { [Op.in]: uniquePatientIds }, status: { [Op.ne]: 'CANCELADO' } },
          include: [
            {
              model: Pacientes, as: 'paciente',
              attributes: ['id', 'nome', 'sobrenome', 'celular', 'telefone', 'operadora_id', 'possui_cuidador', 'nome_cuidador', 'contato_cuidador'],
              include: [
                { model: Operadora, as: 'operadoras', attributes: ['id', 'nome'] },
                { model: PatientEvaluation, as: 'avaliacoes', attributes: ['id', 'total_score', 'createdAt'], required: false },
              ]
            },
            { model: Medicamentos, as: 'medicamento', attributes: ATRIBUTOS_MEDICAMENTO_LINHA },
            { model: PatientEvaluation, as: 'avaliacao', attributes: ['id', 'total_score'] }
          ],
          order: [['createdAt', 'DESC']]
        });

        return res.json({ data: allRecordsForPage, total: totalPacientesDistintos, totalPages: Math.ceil(totalPacientesDistintos / limit), currentPage: parseInt(page) });
      }

      // ==========================================================
      // 👇 NOVO: filtro EXCLUSIVO — mostra só pacientes com acompanhamento
      // totalmente encerrado (zero registros PENDENTE, pelo menos um
      // DESCONTINUADO). Paginação por paciente, ordenado do mais
      // recentemente encerrado pro mais antigo.
      // ==========================================================
      const registrosPendentes = await MonitoramentoMedicamento.findAll({
        attributes: ['paciente_id'],
        where: { status: 'PENDENTE' },
        raw: true
      });
      const idsComPendente = [...new Set(registrosPendentes.map(p => p.paciente_id))];

      const descontinuados = await MonitoramentoMedicamento.findAll({
        attributes: ['paciente_id', 'data_telemonitoramento_efetivado', 'createdAt'],
        where: {
          status: 'DESCONTINUADO',
          paciente_id: idsComPendente.length > 0 ? { [Op.notIn]: idsComPendente } : { [Op.ne]: null }
        },
        include: [{
          model: Pacientes, as: 'paciente', attributes: [],
          where: pacienteWhere, required: true
        }],
        raw: true
      });

      const dataMaisRecentePorPaciente = {};
      descontinuados.forEach(r => {
        const referencia = r.data_telemonitoramento_efetivado || r.createdAt;
        const data = new Date(referencia).getTime();
        const atual = dataMaisRecentePorPaciente[r.paciente_id];
        if (atual === undefined || data > atual) dataMaisRecentePorPaciente[r.paciente_id] = data;
      });

      // 👇 NOVO: quem encerrou um medicamento mas ainda usa outro não é
      // "encerrado" — está na lista normal, com alerta.
      const parciais = await listarParcialmenteEncerrados(pacienteWhere, idsComPendente);
      const idsOrdenados = Object.keys(dataMaisRecentePorPaciente)
        .map(Number)
        .filter(id => !parciais[id])
        .sort((a, b) => dataMaisRecentePorPaciente[b] - dataMaisRecentePorPaciente[a]);

      const total = idsOrdenados.length;
      if (total === 0) return res.json({ data: [], total: 0, totalPages: 0, currentPage: parseInt(page) });

      const idsDaPagina = idsOrdenados.slice(offset, offset + parseInt(limit));

      const allRecordsForPage = await MonitoramentoMedicamento.findAll({
        where: { paciente_id: { [Op.in]: idsDaPagina }, status: { [Op.ne]: 'CANCELADO' } },
        include: [
          {
            model: Pacientes, as: 'paciente',
            attributes: ['id', 'nome', 'sobrenome', 'celular', 'telefone', 'operadora_id', 'possui_cuidador', 'nome_cuidador', 'contato_cuidador'],
            include: [
              { model: Operadora, as: 'operadoras', attributes: ['id', 'nome'] },
              { model: PatientEvaluation, as: 'avaliacoes', attributes: ['id', 'total_score', 'createdAt'], required: false },
            ]
          },
          { model: Medicamentos, as: 'medicamento', attributes: ATRIBUTOS_MEDICAMENTO_LINHA },
          { model: PatientEvaluation, as: 'avaliacao', attributes: ['id', 'total_score'] }
        ],
        order: [['createdAt', 'DESC']]
      });

      return res.json({ data: allRecordsForPage, total, totalPages: Math.ceil(total / parseInt(limit)), currentPage: parseInt(page) });
    } catch (error) { return res.status(500).json({ error: 'Erro ao buscar monitoramentos.', details: error.message }); }
  }

  async update(req, res) {
    const schema = Yup.object().shape({
      contato_efetivo: Yup.boolean().nullable(),
      nivel_adesao: Yup.string().oneOf(['COMPLETAMENTE', 'PARCIALMENTE', 'NAO_ADERE']).nullable(),
      qtd_informada_caixa: Yup.number().integer().nullable(),
      data_abertura_nova_caixa: Yup.date().nullable(),
      is_reacao: Yup.boolean().nullable(),
      reacoes_adversas: Yup.array().of(Yup.number().integer()).nullable(),
      observacao: Yup.string().nullable(),
      aplicar_nova_compra: Yup.boolean().nullable(),
      dados_nova_compra: Yup.object().nullable(),
      data_inicio_nova_caixa: Yup.date().nullable(),
      posologia_nova_caixa: Yup.number().integer().nullable(),
      // 👇 PADRÃO DA NOVA CAIXA (reposição): diário/cíclico/intervalo/personalizado
      tipo_posologia_nova_caixa: Yup.string().oneOf(['diaria', 'ciclica', 'intervalo', 'personalizada']).nullable(),
      posologia_ciclo_dias_toma_nova_caixa: Yup.number().integer().positive().nullable(),
      posologia_ciclo_dias_pausa_nova_caixa: Yup.number().integer().min(0).nullable(),
      posologia_intervalo_dias_nova_caixa: Yup.number().integer().positive().nullable(),
      posologia_datas_personalizadas_nova_caixa: Yup.array().of(Yup.string()).nullable(),
      mudou_posologia: Yup.boolean().nullable(),
      nova_posologia: Yup.number().integer().nullable(),
      data_mudanca_posologia: Yup.date().nullable(),
      tipo_posologia_nova: Yup.string().oneOf(['diaria', 'ciclica', 'intervalo', 'personalizada']).nullable(),
      posologia_ciclo_dias_toma_nova: Yup.number().integer().positive().nullable(),
      posologia_ciclo_dias_pausa_nova: Yup.number().integer().min(0).nullable(),
      posologia_intervalo_dias_nova: Yup.number().integer().positive().nullable(),
      posologia_datas_personalizadas_nova: Yup.array().of(Yup.date()).nullable(),
      motivo_falha_contato_id: Yup.number().integer().nullable(),
      modo_novo_medicamento: Yup.string().oneOf(['CONJUNTO', 'SUBSTITUICAO']).nullable(),
      descontinuar_medicamento: Yup.boolean().nullable(),
      motivo_encerramento: Yup.string().nullable(),
      motivo_encerramento_id: Yup.number().integer().nullable(),
      // 👇 NOVO: descontinuação com data em que parou + comprimidos restantes
      data_descontinuacao: Yup.string().nullable(),
      qtd_restante_informada: Yup.number().integer().min(0).nullable(),
      qtd_restante_confirmada: Yup.boolean().nullable(),
      // 👇 NOVO: rastreio de processamento da compra oferecida neste contato
      confirmar_consumo_eventos_anteriores: Yup.boolean().nullable(),
      compra_oferecida_evento_id: Yup.number().integer().nullable(),
      motivo_nao_aplicar_compra: Yup.string().oneOf(Object.keys(MOTIVOS_NAO_APLICAR_COMPRA)).nullable(),
      motivo_nao_aplicar_compra_texto: Yup.string().nullable()
    });
    try { await schema.validate(req.body, { abortEarly: false }); }
    catch (err) { return res.status(400).json({ error: 'Falha na validação', messages: err.inner }); }

    const { id } = req.params;
    const {
      contato_efetivo, nivel_adesao, qtd_informada_caixa, data_abertura_nova_caixa,
      is_reacao, reacoes_adversas, observacao, aplicar_nova_compra, dados_nova_compra,
      data_inicio_nova_caixa, posologia_nova_caixa,
      mudou_posologia, nova_posologia, data_mudanca_posologia,
      tipo_posologia_nova, posologia_ciclo_dias_toma_nova, posologia_ciclo_dias_pausa_nova,
      posologia_intervalo_dias_nova, posologia_datas_personalizadas_nova,
      motivo_falha_contato_id,
      modo_novo_medicamento,
      descontinuar_medicamento,
      motivo_encerramento,
      motivo_encerramento_id,
      data_descontinuacao,
      qtd_restante_informada,
      qtd_restante_confirmada,
      confirmar_consumo_eventos_anteriores,
      compra_oferecida_evento_id,
      motivo_nao_aplicar_compra,
      motivo_nao_aplicar_compra_texto
    } = req.body;

    // 👇 NOVO: compra oferecida e não aplicada precisa de motivo (vai pra auditoria).
    const erroMotivoCompra = validarMotivoNaoAplicarCompra(req.body);
    if (erroMotivoCompra) return res.status(400).json({ error: erroMotivoCompra });

    // 👇 CORREÇÃO DE BUG: essa combinação só é realmente contraditória quando
    // a nova compra é do MESMO medicamento (substituindo o ciclo atual) — aí
    // sim não faz sentido "descontinuar" e "aplicar nova compra" ao mesmo
    // tempo, porque seriam a mesma linha de tratamento. Quando é uso em
    // CONJUNTO (medicamento adicional, diferente do atual), são duas ações
    // válidas e independentes: descontinuar o medicamento atual E começar a
    // acompanhar o novo em paralelo.
    if (descontinuar_medicamento && aplicar_nova_compra && !ehSolicitandoUsoConjunto(dados_nova_compra, modo_novo_medicamento)) {
      return res.status(400).json({ error: 'Não é possível descontinuar o medicamento e aplicar uma nova compra ao mesmo tempo.' });
    }
    if (contato_efetivo !== false && !descontinuar_medicamento && aplicar_nova_compra && ehSolicitandoUsoConjunto(dados_nova_compra, modo_novo_medicamento)) {
      if (!data_inicio_nova_caixa || !posologia_nova_caixa) {
        return res.status(400).json({ error: 'Data de início e posologia do medicamento adicional são obrigatórias para uso em conjunto.' });
      }
    }

    try {
      const resultado = await MonitoramentoMedicamento.sequelize.transaction(async (transaction) => {
        const monitoramentoAtual = await MonitoramentoMedicamento.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!monitoramentoAtual) {
          const erro = new Error('Monitoramento não encontrado.');
          erro.status = 404;
          throw erro;
        }

        // ---- Contato NÃO efetivado ----
        if (contato_efetivo === false) {
          await monitoramentoAtual.update({
            contato_efetivo,
            nivel_adesao: null,
            qtd_informada_caixa,
            data_abertura_nova_caixa,
            is_reacao: false,
            status: 'CONCLUIDO',
            observacao,
            data_telemonitoramento_efetivado: new Date(),
            mudou_posologia: false,
            nova_posologia: null,
            data_mudanca_posologia: null,
            motivo_falha_contato_id
          }, { transaction });
          await monitoramentoAtual.setReacoesAdversas([], { transaction });

          const proximaData = obterProximoDiaUtil(new Date());
          await MonitoramentoMedicamento.create({
            paciente_id: monitoramentoAtual.paciente_id, patient_evaluation_id: monitoramentoAtual.patient_evaluation_id,
            medicamento_id: monitoramentoAtual.medicamento_id, posologia_diaria: monitoramentoAtual.posologia_diaria,
            tipo_posologia: monitoramentoAtual.tipo_posologia, ...extrairParametrosPosologia(monitoramentoAtual),
            data_entrega: monitoramentoAtual.data_entrega, data_administracao: monitoramentoAtual.data_administracao,
            data_calculada_fim_caixa: monitoramentoAtual.data_calculada_fim_caixa, data_proximo_contato: proximaData,
            status: 'PENDENTE', qtd_caixas: monitoramentoAtual.qtd_caixas, qtd_total_capsulas: monitoramentoAtual.qtd_total_capsulas,
            evento_externo_id: monitoramentoAtual.evento_externo_id,
            grupo_medicamentos_id: monitoramentoAtual.grupo_medicamentos_id
          }, { transaction });

          return { mensagem: 'Contato sem sucesso. Reagendado para o próximo dia útil.' };
        }

        // ---- Descontinuar medicamento — fecha o registro e NÃO cria próximo ciclo ----
        if (descontinuar_medicamento) {
          // 👇 NOVO: data em que parou + comprimidos restantes (projeção do
          // sistema confirmada ou corrigida pelo paciente).
          const parada = resolverRestanteNaParada(monitoramentoAtual, { data_parada: data_descontinuacao, qtd_restante_informada, qtd_restante_confirmada });
          if (parada.erro) { const erro = new Error(parada.erro); erro.status = 400; throw erro; }
          await monitoramentoAtual.update({
            contato_efetivo,
            nivel_adesao,
            qtd_informada_caixa,
            is_reacao,
            status: 'DESCONTINUADO',
            observacao,
            data_telemonitoramento_efetivado: new Date(),
            motivo_encerramento: motivo_encerramento || null,
            motivo_encerramento_id: motivo_encerramento_id || null,
            motivo_falha_contato_id: null,
            data_abertura_nova_caixa: null,
            data_descontinuacao: data_descontinuacao,
            qtd_restante_projetada: parada.projecao.qtd_restante_projetada,
            qtd_restante_informada: parada.qtd_restante_informada,
            qtd_restante_confirmada: parada.qtd_restante_confirmada
          }, { transaction });

          if (is_reacao && reacoes_adversas && reacoes_adversas.length > 0) {
            await monitoramentoAtual.setReacoesAdversas(reacoes_adversas, { transaction });
          } else {
            await monitoramentoAtual.setReacoesAdversas([], { transaction });
          }

          let descricaoMotivo = motivo_encerramento || 'não informado';
          if (motivo_encerramento_id) {
            const motivoRegistrado = await MotivoPausaTratamento.findByPk(motivo_encerramento_id, { transaction });
            if (motivoRegistrado) descricaoMotivo = motivoRegistrado.descricao;
          }
          await AuditService.log(req.userId, 'Edição', 'Monitoramento', monitoramentoAtual.id, `Medicamento descontinuado. Motivo: ${descricaoMotivo}. Parou de tomar em ${formatarDataBR(data_descontinuacao)}; sobra na caixa: ${parada.qtd_restante_informada} comprimido(s) (${parada.qtd_restante_confirmada ? 'confirmou a projeção' : `projeção era ${parada.projecao.qtd_restante_projetada}, paciente informou outra quantidade`}).`);
          // 👇 NOVO: a compra oferecida fica registrada como não aplicada por descontinuação.
          if (compra_oferecida_evento_id && !aplicar_nova_compra) {
            await registrarCompraNaoAplicada({ monitoramentoAtual, compraOferecidaId: compra_oferecida_evento_id, motivo: 'MEDICAMENTO_DESCONTINUADO', texto: null, userId: req.userId, transaction });
          }

          return { mensagem: 'Medicamento descontinuado com sucesso. Nenhum novo ciclo será agendado.' };
        }

        // ---- Revalida a nova compra contra o banco ----
        let compraRevalidada = null;
        if (aplicar_nova_compra) {
          compraRevalidada = await revalidarDadosNovaCompra(monitoramentoAtual, dados_nova_compra, modo_novo_medicamento, { transaction }, { confirmarConsumoAnteriores: !!confirmar_consumo_eventos_anteriores });
        }
        const ehUsoConjunto = !!(compraRevalidada && compraRevalidada.ehUsoConjunto);

        let grupoMedicamentosId = monitoramentoAtual.grupo_medicamentos_id;
        if (ehUsoConjunto && !grupoMedicamentosId) {
          grupoMedicamentosId = `grp-${monitoramentoAtual.paciente_id}-${Date.now()}`;
        }

        await monitoramentoAtual.update({
          contato_efetivo,
          nivel_adesao,
          qtd_informada_caixa,
          data_abertura_nova_caixa,
          is_reacao,
          status: 'CONCLUIDO',
          observacao,
          data_telemonitoramento_efetivado: new Date(),
          mudou_posologia: mudou_posologia || false,
          nova_posologia: mudou_posologia ? nova_posologia : null,
          data_mudanca_posologia: mudou_posologia ? data_mudanca_posologia : null,
          motivo_falha_contato_id: null,
          grupo_medicamentos_id: grupoMedicamentosId
        }, { transaction });

        if (is_reacao && reacoes_adversas && reacoes_adversas.length > 0) {
          await monitoramentoAtual.setReacoesAdversas(reacoes_adversas, { transaction });
        } else {
          await monitoramentoAtual.setReacoesAdversas([], { transaction });
        }

        let proximoMedicamentoId = monitoramentoAtual.medicamento_id;
        let proximasCaixas = monitoramentoAtual.qtd_caixas;
        let proximasCapsulasTotais = monitoramentoAtual.qtd_total_capsulas;
        let proximaDataEntrega = monitoramentoAtual.data_entrega;
        let proximaDataFimCaixa = monitoramentoAtual.data_calculada_fim_caixa;
        let proximaDataAdministracao = monitoramentoAtual.data_administracao;
        let proximoEventoExternoId = monitoramentoAtual.evento_externo_id;
        let proximaPosologia = (mudou_posologia && nova_posologia) ? nova_posologia : monitoramentoAtual.posologia_diaria;
        // 👇 NOVO: se a posologia mudou E veio com um padrão diferente do
        // diário (cíclico, intervalo, etc.), usa esse padrão novo daqui pra
        // frente — tanto no cálculo quanto no que fica gravado pro próximo
        // ciclo. Sem padrão novo informado, mantém o que já estava valendo
        // (ex: só mudou a quantidade de comprimidos, o ritmo continua igual).
        const proximoPadraoPosologia = (mudou_posologia && tipo_posologia_nova)
          ? {
              tipo_posologia: tipo_posologia_nova,
              posologia_ciclo_dias_toma: posologia_ciclo_dias_toma_nova,
              posologia_ciclo_dias_pausa: posologia_ciclo_dias_pausa_nova,
              posologia_intervalo_dias: posologia_intervalo_dias_nova,
              posologia_datas_personalizadas: posologia_datas_personalizadas_nova
            }
          : { tipo_posologia: monitoramentoAtual.tipo_posologia, ...extrairParametrosPosologia(monitoramentoAtual) };
        // 👇 PADRÃO DA NOVA CAIXA: ao aplicar uma reposição o operador pode definir
        // o padrão (diário/cíclico/intervalo/personalizado) do ciclo novo; sem
        // informar, o ciclo herda o padrão atual.
        if (aplicar_nova_compra && req.body.tipo_posologia_nova_caixa) {
          proximoPadraoPosologia.tipo_posologia = req.body.tipo_posologia_nova_caixa;
          Object.assign(proximoPadraoPosologia, extrairParametrosPosologia({
            posologia_ciclo_dias_toma: req.body.posologia_ciclo_dias_toma_nova_caixa,
            posologia_ciclo_dias_pausa: req.body.posologia_ciclo_dias_pausa_nova_caixa,
            posologia_intervalo_dias: req.body.posologia_intervalo_dias_nova_caixa,
            posologia_datas_personalizadas: req.body.posologia_datas_personalizadas_nova_caixa
          }));
        }

        // 👇 A cada contato em que o paciente informa quanto lhe resta,
        // 👇 REGRA DEFINITIVA: qtd_total_capsulas (o total real da caixa,
        // vem do questionário/compra) e data_administracao (quando essa
        // caixa começou a ser usada) são IMUTÁVEIS — só mudam quando um
        // evento de compra novo de verdade chega (evento_externo_id
        // diferente, tratado no bloco de nova compra abaixo) ou pelo botão
        // "Corrigir". qtd_informada_caixa nunca alimenta os dois — serve só
        // pra classificar a adesão deste contato (comparando informado x
        // projetado), sem virar a nova base de cálculo dos próximos dias.
        if (qtd_informada_caixa != null && proximaPosologia > 0) {
          proximaDataFimCaixa = calcularDataFimCaixa(new Date(), qtd_informada_caixa, proximaPosologia, proximoPadraoPosologia.tipo_posologia, proximoPadraoPosologia, obterPeriodosPausa(monitoramentoAtual));
        }

        if (aplicar_nova_compra && compraRevalidada && !ehUsoConjunto) {
          proximoMedicamentoId = compraRevalidada.medicamentoNovoId;
          proximasCaixas = compraRevalidada.qtdCaixas;
          proximaDataEntrega = parseISO(compraRevalidada.dataEntrega);
          proximoEventoExternoId = compraRevalidada.eventoExternoId;
          proximaPosologia = posologia_nova_caixa || monitoramentoAtual.posologia_diaria;
          proximaDataAdministracao = data_inicio_nova_caixa ? parseISO(data_inicio_nova_caixa) : proximaDataAdministracao;
          proximasCapsulasTotais = compraRevalidada.totalCapsulasNovas;
          proximaDataFimCaixa = calcularDataFimCaixa(proximaDataAdministracao, proximasCapsulasTotais, proximaPosologia, proximoPadraoPosologia.tipo_posologia, proximoPadraoPosologia, obterPeriodosPausa(monitoramentoAtual));

          if (compraRevalidada.mudouMedicamento) {
            await HistoricoTrocaMedicamento.create({
              paciente_id: monitoramentoAtual.paciente_id,
              medicamento_antigo_id: compraRevalidada.medicamentoAtualId,
              medicamento_novo_id: proximoMedicamentoId,
              data_troca: proximaDataEntrega,
              monitoramento_id: monitoramentoAtual.id
            }, { transaction });
          }
        }
        let proximoCicloAtual = null;
        if (data_abertura_nova_caixa) {
          const dataProximoContatoEnviada = parseISO(data_abertura_nova_caixa);
          proximoCicloAtual = await MonitoramentoMedicamento.create({
            paciente_id: monitoramentoAtual.paciente_id, patient_evaluation_id: monitoramentoAtual.patient_evaluation_id,
            medicamento_id: proximoMedicamentoId, posologia_diaria: proximaPosologia,
            tipo_posologia: proximoPadraoPosologia.tipo_posologia, ...proximoPadraoPosologia,
            data_entrega: proximaDataEntrega,
            data_administracao: proximaDataAdministracao, data_calculada_fim_caixa: proximaDataFimCaixa, data_proximo_contato: dataProximoContatoEnviada,
            status: 'PENDENTE', qtd_caixas: proximasCaixas, qtd_total_capsulas: proximasCapsulasTotais, evento_externo_id: proximoEventoExternoId,
            grupo_medicamentos_id: grupoMedicamentosId
          }, { transaction });
        }

        // 👇 NOVO: capturamos o registro criado aqui pra devolver o id no
        // final — é isso que permite o front encadear o registro completo
        // (comprimidos/adesão/reação) do medicamento adicional na mesma sessão,
        // em vez de deixá-lo esperando um contato futuro sem nenhum dado.
        let novoMonitoramentoAdicional = null;
        if (ehUsoConjunto) {
          if (!data_inicio_nova_caixa || !posologia_nova_caixa) {
            const erro = new Error('Data de início e posologia do medicamento adicional são obrigatórias para uso em conjunto.');
            erro.status = 400;
            throw erro;
          }
          const dataAdministracaoNovoMed = parseISO(data_inicio_nova_caixa);
          const totalCapsulasNovoMed = compraRevalidada.totalCapsulasNovas;
          const tipoPosologiaNovoMed = req.body.tipo_posologia_novo_medicamento || 'diaria';
          const parametrosPosologiaNovoMed = extrairParametrosPosologia(req.body.parametros_posologia_novo_medicamento || {});
          const dataFimCaixaNovoMed = calcularDataFimCaixa(dataAdministracaoNovoMed, totalCapsulasNovoMed, posologia_nova_caixa, tipoPosologiaNovoMed, parametrosPosologiaNovoMed);
          const dataProximoContatoNovoMed = calcularDataTelemonitoramento(dataAdministracaoNovoMed);

          novoMonitoramentoAdicional = await MonitoramentoMedicamento.create({
            paciente_id: monitoramentoAtual.paciente_id,
            patient_evaluation_id: monitoramentoAtual.patient_evaluation_id,
            medicamento_id: compraRevalidada.medicamentoNovoId,
            posologia_diaria: posologia_nova_caixa,
            tipo_posologia: tipoPosologiaNovoMed, ...parametrosPosologiaNovoMed,
            data_entrega: parseISO(compraRevalidada.dataEntrega),
            data_administracao: dataAdministracaoNovoMed,
            data_calculada_fim_caixa: dataFimCaixaNovoMed,
            data_proximo_contato: dataProximoContatoNovoMed,
            status: 'PENDENTE',
            qtd_caixas: compraRevalidada.qtdCaixas,
            qtd_total_capsulas: totalCapsulasNovoMed,
            evento_externo_id: compraRevalidada.eventoExternoId,
            grupo_medicamentos_id: grupoMedicamentosId
          }, { transaction });
        }

        // 👇 NOVO: rastro de processamento da compra no próprio evento + auditoria.
        if (compraRevalidada) {
          await registrarProcessamentoCompra({
            compraRevalidada, monitoramentoAtual, userId: req.userId, transaction,
            novoCiclo: ehUsoConjunto ? novoMonitoramentoAdicional : proximoCicloAtual
          });
        } else if (compra_oferecida_evento_id) {
          await registrarCompraNaoAplicada({ monitoramentoAtual, compraOferecidaId: compra_oferecida_evento_id, motivo: motivo_nao_aplicar_compra, texto: motivo_nao_aplicar_compra_texto, userId: req.userId, transaction });
        }

        // 👇 AUDITORIA: a mudança de posologia sai com os valores (de → para, a partir de quando)
        const descricaoPosologia = mudou_posologia
          ? `sim (${monitoramentoAtual.posologia_diaria} → ${nova_posologia} por dose a partir de ${formatarDataBR(data_mudanca_posologia)}${tipo_posologia_nova ? `, padrão ${tipo_posologia_nova}` : ''})`
          : 'não';
        await AuditService.log(req.userId, 'Edição', 'Monitoramento', monitoramentoAtual.id, `Registrou contato. Mudou posologia: ${descricaoPosologia}. Uso em conjunto: ${ehUsoConjunto}. Nova compra aplicada: ${compraRevalidada ? `#${compraRevalidada.eventoExternoId}` : 'não'}`);

        return {
          mensagem: 'Contato registrado e ciclo atualizado com sucesso!',
          monitoramentoAdicionalId: ehUsoConjunto ? novoMonitoramentoAdicional.id : null,
          proximoCicloAtualId: proximoCicloAtual ? proximoCicloAtual.id : null // 👈 NOVO
        };
      });

      // 👇 NOVO: devolve o id pro front
      return res.json({
        message: resultado.mensagem,
        monitoramento_adicional_id: resultado.monitoramentoAdicionalId,
        proximo_ciclo_atual_id: resultado.proximoCicloAtualId // 👈 NOVO
      });
    } catch (error) {
      const status = error.status || 500;
      return res.status(status).json({ error: status === 500 ? 'Erro ao registrar contato' : error.message, details: error.message });
    }
  }


  // [VINCULAR AVALIAÇÃO, TIMELINE E INFORMAR ADMINISTRAÇÃO MANTIDOS INTACTOS]
  async timeline(req, res) {
    try {
      const operadoraQueryId = req.query.operadora_id;
      const permission = await getOperadoraFilter(req.userId, operadoraQueryId);
      if (!permission.authorized) return res.json([]);
      const monitoramentos = await MonitoramentoMedicamento.findAll({
        include: [
          { model: Pacientes, as: 'paciente', where: permission.whereClause, attributes: ['id', 'nome', 'sobrenome'] },
          { model: Medicamentos, as: 'medicamento', attributes: ['nome'] }
        ],
        order: [['createdAt', 'DESC']]
      });
      return res.json(monitoramentos);
    } catch (error) { return res.status(500).json({ error: 'Erro na timeline' }); }
  }

  async vincularAvaliacaoSilencioso(req, res) {
    const { paciente_id, patient_evaluation_id } = req.body;
    try {
      const [updatedRows] = await MonitoramentoMedicamento.update({ patient_evaluation_id }, { where: { paciente_id, status: 'PENDENTE' } });
      return res.status(200).json({ message: 'Vinculado.', registros_atualizados: updatedRows });
    } catch (error) { return res.status(500).json({ error: 'Erro ao vincular', details: error.message }); }
  }

  // MonitoramentoMedicamentoController.js
  async informarDataAdministracao(req, res) {
    const { id } = req.params;
    const { data_administracao } = req.body;
    if (!data_administracao) {
      return res.status(400).json({ error: 'Data de administração é obrigatória.' });
    }
    try {
      const monitoramento = await MonitoramentoMedicamento.findByPk(id);
      if (!monitoramento) {
        return res.status(404).json({ error: 'Monitoramento não encontrado.' });
      }
      const dataAdminParsed = parseISO(data_administracao);
      const novaDataFimCaixa = calcularDataFimCaixa(dataAdminParsed, monitoramento.qtd_total_capsulas, monitoramento.posologia_diaria, monitoramento.tipo_posologia, monitoramento, obterPeriodosPausa(monitoramento));
      await monitoramento.update({ data_administracao: dataAdminParsed, data_calculada_fim_caixa: novaDataFimCaixa });
      return res.json({ message: 'Sucesso!', monitoramento });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao informar data de administração', details: error.message });
    }
  }


  async verificarNovaCompra(req, res) {
    const { id } = req.params;
    // 👇 LINHA DE TRATAMENTO: novas_linhas=0 (etapas 2+ do contato em conjunto)
    // só oferece compras do medicamento desta etapa; o medicamento novo de
    // verdade (linha sem acompanhamento ativo) é oferecido UMA vez, na primeira
    // etapa / no contato individual, onde o operador decide conjunto ou substituição.
    const { excluir_eventos, novas_linhas } = req.query;
    const permitirNovasLinhas = String(novas_linhas ?? '1') !== '0';
    const eventosExcluidos = excluir_eventos
      ? String(excluir_eventos).split(',').map(v => parseInt(v, 10)).filter(v => !isNaN(v))
      : [];
    try {
      const monitoramento = await MonitoramentoMedicamento.findByPk(id, {
        include: [
          { model: Pacientes, as: 'paciente', attributes: ['id', 'external_id', 'nome'] },
          { model: Medicamentos, as: 'medicamento', attributes: ATRIBUTOS_MEDICAMENTO_LINHA }
        ]
      });
      if (!monitoramento || !monitoramento.evento_externo_id) return res.json({ novaCompraDetectada: false });

      let medicamentosDoGrupoIds = [monitoramento.medicamento_id];
      if (monitoramento.grupo_medicamentos_id) {
        const irmaos = await MonitoramentoMedicamento.findAll({
          where: {
            grupo_medicamentos_id: monitoramento.grupo_medicamentos_id,
            status: { [Op.notIn]: ['CANCELADO', 'DESCONTINUADO'] },
            id: { [Op.ne]: monitoramento.id }
          }
        });
        medicamentosDoGrupoIds = [...new Set([monitoramento.medicamento_id, ...irmaos.map(i => i.medicamento_id)])];
      }
      const linhasDoGrupo = new Set(Object.values(await mapaChavesLinha(medicamentosDoGrupoIds)));
      // linhas em acompanhamento ativo em QUALQUER ciclo do paciente
      const linhasAtivas = await chavesLinhasAtivasDoPaciente(monitoramento.paciente_id);

      // Ordem ASC (mais antigo primeiro); evento já processado nunca volta.
      const eventos = await EventosPaciente.findAll({
        where: { paciente_id: monitoramento.paciente.id, recebido: true, processado: false, excluido_externo: false }, // 👈 NOVO: excluído no externo não conta
        order: [['external_id', 'ASC']],
        include: [{ model: Medicamentos, as: 'medicamento' }]
      });
      if (eventos.length === 0) return res.json({ novaCompraDetectada: false });

      const eventoAtualId = parseInt(monitoramento.evento_externo_id, 10);
      // "é posterior ao ciclo atual" por DATA (ver dataAncoraDoCiclo), não por external_id.
      const ancora = await dataAncoraDoCiclo(monitoramento);

      // 👇 LINHA DE TRATAMENTO:
      //  - mesma linha (qualquer apresentação do mesmo princípio ativo) → compra
      //    deste medicamento, oferecida nesta etapa (com seletor se houver mais de uma);
      //  - linha ativa em outro ciclo do paciente → pertence à etapa daquele
      //    medicamento, não entra aqui;
      //  - linha nova (sem acompanhamento ativo) → "novo medicamento", só com
      //    novas_linhas permitido, com prioridade sobre a reposição (é evento
      //    raro e precisa de decisão; a reposição fica avisada e é aplicada no
      //    próximo contato).
      const posteriores = eventos.filter(e => ehPosteriorAoCicloAtual(e, ancora, eventoAtualId) && !eventosExcluidos.includes(parseInt(e.external_id, 10)));
      const candidatosMesmaLinha = posteriores.filter(e => mesmaLinha(e.medicamento, monitoramento.medicamento));
      const candidatosNovaLinha = permitirNovasLinhas
        ? posteriores.filter(e => {
            const chave = chaveLinhaTratamento(e.medicamento);
            return !mesmaLinha(e.medicamento, monitoramento.medicamento) && !linhasDoGrupo.has(chave) && !linhasAtivas.has(chave);
          })
        : [];

      const pegarMaisAntigoPorData = (lista) => {
        if (lista.length === 0) return null;
        return [...lista].sort(compararEventosPorData)[0];
      };

      const novoEventoMesmaLinha = pegarMaisAntigoPorData(candidatosMesmaLinha);
      // uma compra por linha nova: a mais antiga de cada princípio ativo
      const maisAntigoPorLinhaNova = {};
      [...candidatosNovaLinha].sort(compararEventosPorData).forEach(e => {
        const chave = chaveLinhaTratamento(e.medicamento);
        if (!maisAntigoPorLinhaNova[chave]) maisAntigoPorLinhaNova[chave] = e;
      });
      const novasLinhas = Object.values(maisAntigoPorLinhaNova).sort(compararEventosPorData);
      const novoEventoNovaLinha = novasLinhas[0] || null;

      // 👇 PRIORIDADE (regra de negócio): a reposição do medicamento desta etapa
      // vem SEMPRE primeiro. O medicamento novo (linha sem acompanhamento) só é
      // oferecido aqui quando não há compra pendente da própria linha; quando
      // há, ele vai em "novas_linhas_pendentes" e, logo após o contato ser
      // registrado, a tela oferece iniciar o acompanhamento dele (endpoint
      // novasLinhasPendentes + store entrando no grupo).
      let novoEvento = null;
      let ehMedicamentoDiferente = false;
      if (novoEventoMesmaLinha) {
        novoEvento = novoEventoMesmaLinha;
      } else if (novoEventoNovaLinha) {
        novoEvento = novoEventoNovaLinha;
        ehMedicamentoDiferente = true;
      }
      // compatibilidade com o bloco de resposta abaixo
      const candidatosMesmoMedicamento = candidatosMesmaLinha;
      const candidatosMedicamentoDiferente = candidatosNovaLinha;
      const novoEventoMesmoMedicamento = novoEventoMesmaLinha;
      const novoEventoMedicamentoDiferente = novoEventoNovaLinha;
      if (!novoEvento) return res.json({ novaCompraDetectada: false });

      // 👇 NOVO (múltiplos eventos pendentes): antes, quando existiam DOIS candidatos
      // simultâneos (ex: evento B de medicamento diferente E evento C de reposição do
      // medicamento atual), o sistema escolhia um e descartava o outro silenciosamente
      // — quem operava o contato nunca ficava sabendo que havia um segundo evento
      // esperando logo atrás. Isso importa principalmente pra decisão de troca vs. uso
      // em conjunto: se tem uma reposição do medicamento atual chegando junto com um
      // medicamento novo, é forte indício de uso em conjunto, não substituição.
      const outroCandidatoImediato = novoEvento === novoEventoMesmoMedicamento
        ? novoEventoMedicamentoDiferente
        : novoEventoMesmoMedicamento;

      const totalCandidatosRestantes =
        candidatosMesmoMedicamento.filter(e => e.id !== novoEvento.id).length +
        candidatosMedicamentoDiferente.filter(e => e.id !== novoEvento.id).length;

      // 👇 NOVO: cada candidato pendente vira um bloco de detalhes com a MESMA
      // forma do evento escolhido, pra tela poder listar todos e deixar o
      // operador trocar a seleção (ex: paciente já está numa compra mais
      // recente) sem nova consulta. Inclui também:
      //  - dias_desde_previsao / evento_antigo: previsão de uso há mais de
      //    DIAS_EVENTO_ANTIGO dias (campo que o front já esperava);
      //  - existe_mais_recente_mesmo_medicamento: há compra posterior do
      //    mesmo medicamento pendente — a mais antiga pode estar defasada;
      //  - eventos_anteriores: o que fica "pulado" se este for aplicado.
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const diasDesdePrevisao = (evento) => {
        const referencia = dataDeReferenciaEvento(evento);
        if (!referencia) return null;
        return Math.floor((hoje - new Date(`${referencia}T00:00:00`)) / (1000 * 60 * 60 * 24));
      };
      const todosCandidatos = [...candidatosMesmoMedicamento, ...candidatosMedicamentoDiferente].sort(compararEventosPorData);
      const montarDetalhesEvento = (evento) => {
        // 👇 LINHA DE TRATAMENTO: "mesmo medicamento" = mesmo princípio ativo; o
        // seletor/anteriores agrupam pela linha (todas as apresentações).
        const mesmoMedicamento = mesmaLinha(evento.medicamento, monitoramento.medicamento);
        const mudouApresentacao = mesmoMedicamento && evento.medicamento_id !== monitoramento.medicamento_id;
        const dataAdmin = evento.data_administracao_prevista;
        const totalCapsulas = (evento.medicamento?.qtd_capsula || 0) * evento.qtd_caixas;
        const chaveDaLinha = chaveLinhaTratamento(evento.medicamento);
        const doMesmoMedicamento = todosCandidatos.filter(e => chaveLinhaTratamento(e.medicamento) === chaveDaLinha && e.id !== evento.id);
        const dias = diasDesdePrevisao(evento);
        return {
          evento_externo_id: evento.external_id,
          medicamento_id: evento.medicamento_id,
          mudou_apresentacao: mudouApresentacao,
          linha_tratamento: chaveDaLinha,
          medicamento_nome: evento.medicamento?.nome,
          mesmo_medicamento_atual: mesmoMedicamento,
          data_entrega: evento.data_entrega_real || evento.data_entrega_prevista,
          data_previsao_administracao: dataAdmin,
          data_novo_inicio: dataAdmin ? addDays(parseISO(dataAdmin), 5) : null,
          qtd_caixas: evento.qtd_caixas,
          total_capsulas_novas: totalCapsulas,
          sobra_comprimidos: 0,
          total_estoque_calculado: totalCapsulas,
          mudou_medicamento: !mesmoMedicamento,
          pode_ser_conjunto: !mesmoMedicamento && medicamentosDoGrupoIds.length < 10,
          medicamento_novo: { id: evento.medicamento_id, nome: evento.medicamento?.nome },
          dias_desde_previsao: dias,
          evento_antigo: dias !== null && dias > DIAS_EVENTO_ANTIGO,
          existe_mais_recente_mesmo_medicamento: doMesmoMedicamento.some(e => compararEventosPorData(e, evento) > 0),
          eventos_anteriores: doMesmoMedicamento.filter(e => compararEventosPorData(e, evento) < 0).map(e => e.external_id)
        };
      };
      // o seletor de compras é dentro da linha do evento escolhido
      const pendentesDaLinhaEscolhida = todosCandidatos.filter(e => chaveLinhaTratamento(e.medicamento) === chaveLinhaTratamento(novoEvento.medicamento));

      return res.json({
        novaCompraDetectada: true,
        detalhes: {
          ...montarDetalhesEvento(novoEvento),
          medicamento_atual: { id: monitoramento.medicamento_id, nome: monitoramento.medicamento.nome },
          eventos_pendentes: pendentesDaLinhaEscolhida.map(montarDetalhesEvento),
          // 👇 LINHA DE TRATAMENTO: medicamentos novos recebidos que NÃO estão sendo
          // oferecidos nesta etapa (quando a reposição tem prioridade, são todos) — só informativo
          novas_linhas_pendentes: novasLinhas.filter(e => e.id !== novoEvento.id).map(e => ({ evento_externo_id: e.external_id, medicamento_nome: e.medicamento?.nome, data_entrega: e.data_entrega_real || e.data_entrega_prevista })),
          existe_outro_evento_pendente: !!outroCandidatoImediato || totalCandidatosRestantes > 0,
          outro_evento_pendente: outroCandidatoImediato ? {
            evento_externo_id: outroCandidatoImediato.external_id,
            medicamento_nome: outroCandidatoImediato.medicamento.nome,
            data_previsao_administracao: outroCandidatoImediato.data_administracao_prevista,
            mesmo_medicamento_atual: outroCandidatoImediato === novoEventoMesmoMedicamento
          } : null,
          total_eventos_pendentes_adicionais: totalCandidatosRestantes
        }
      });
    } catch (error) {
      console.error("ERRO NO VERIFICAR NOVA COMPRA:", error);
      return res.status(500).json({ error: 'Erro ao verificar nova compra.', details: error.message });
    }
  }

  async sincronizarEventoAtual(req, res) {
    const { id } = req.params;
    try {
      const monitoramento = await MonitoramentoMedicamento.findByPk(id, {
        include: [
          { model: Pacientes, as: 'paciente', attributes: ['id', 'external_id'] },
          { model: Medicamentos, as: 'medicamento', attributes: ['id', 'external_id', 'qtd_capsula'] }
        ]
      });

      if (!monitoramento || !monitoramento.evento_externo_id) return res.json({ atualizado: false });

      const eventoLocal = await EventosPaciente.findOne({
        where: { external_id: monitoramento.evento_externo_id },
        include: [{ model: Medicamentos, as: 'medicamento' }]
      });

      if (!eventoLocal) return res.json({ atualizado: false });

      let houveMudanca = false;
      let novoMedicamentoId = monitoramento.medicamento_id;

      // Verifica mudança de medicamento
      if (eventoLocal.medicamento_id !== monitoramento.medicamento_id) {
        houveMudanca = true;
        novoMedicamentoId = eventoLocal.medicamento_id;
      } else {
        // Verifica mudança silenciosa na quantidade de capsulas do medicamento local
        if (eventoLocal.medicamento.qtd_capsula !== monitoramento.medicamento.qtd_capsula) {
          houveMudanca = true;
        }
      }

      // Verifica se a quantidade de caixas mudou
      if (eventoLocal.qtd_caixas !== monitoramento.qtd_caixas) houveMudanca = true;

      if (!houveMudanca) return res.json({ atualizado: false });

      const novaQtdTotalCapsulas = (eventoLocal.medicamento.qtd_capsula || 0) * eventoLocal.qtd_caixas;

      let novaDataFimCaixa = monitoramento.data_calculada_fim_caixa;
      if (novaQtdTotalCapsulas > 0 && monitoramento.posologia_diaria > 0) {
        const baseDate = monitoramento.data_administracao || monitoramento.data_entrega || monitoramento.createdAt;
        novaDataFimCaixa = calcularDataFimCaixa(new Date(baseDate), novaQtdTotalCapsulas, monitoramento.posologia_diaria, monitoramento.tipo_posologia, monitoramento, obterPeriodosPausa(monitoramento));
      }

      await monitoramento.update({
        medicamento_id: novoMedicamentoId,
        qtd_caixas: eventoLocal.qtd_caixas,
        qtd_total_capsulas: novaQtdTotalCapsulas,
        data_calculada_fim_caixa: novaDataFimCaixa
      });

      const monitoramentoAtualizado = await MonitoramentoMedicamento.findByPk(id, {
        include: [{ model: Pacientes, as: 'paciente' }, { model: Medicamentos, as: 'medicamento' }]
      });

      return res.json({ atualizado: true, monitoramento: monitoramentoAtualizado });
    } catch (error) {
      console.error("ERRO AO SINCRONIZAR EVENTO ATUAL:", error);
      return res.status(500).json({ error: 'Erro ao sincronizar', details: error.message });
    }
  }

  async verificarSincronizacaoAtual(req, res) {
    const { id } = req.params;
    try {
      const monitoramento = await MonitoramentoMedicamento.findByPk(id, {
        include: [{ model: Medicamentos, as: 'medicamento' }]
      });

      if (!monitoramento || !monitoramento.evento_externo_id) return res.json({ requiresConfirmation: false });

      const eventoLocal = await EventosPaciente.findOne({
        where: { external_id: monitoramento.evento_externo_id },
        include: [{ model: Medicamentos, as: 'medicamento' }]
      });

      if (!eventoLocal) return res.json({ requiresConfirmation: false });

      // 👇 LINHA DE TRATAMENTO: outra apresentação do mesmo princípio ativo não é troca
      let mudouMedicamento = !mesmaLinha(eventoLocal.medicamento, monitoramento.medicamento);
      let mudouQtd = eventoLocal.qtd_caixas !== monitoramento.qtd_caixas || eventoLocal.medicamento.qtd_capsula !== monitoramento.medicamento.qtd_capsula;

      if (mudouMedicamento || mudouQtd) {
        return res.json({
          requiresConfirmation: true,
          details: {
            medicamentoAntigo: monitoramento.medicamento.nome,
            medicamentoNovo: eventoLocal.medicamento.nome,
            novoMedicamentoId: eventoLocal.medicamento_id,
            qtdCaixasAntiga: monitoramento.qtd_caixas,
            qtdCaixasNova: eventoLocal.qtd_caixas,
            novaQtdCapsulaPorCaixa: eventoLocal.medicamento.qtd_capsula,
            mudouMedicamento: mudouMedicamento
          }
        });
      }

      return res.json({ requiresConfirmation: false });
    } catch (error) {
      console.error("ERRO AO VERIFICAR SINCRONIZAÇÃO ATUAL:", error);
      return res.status(500).json({ error: 'Erro ao verificar', details: error.message });
    }
  }

  async confirmarSincronizacaoAtual(req, res) {
    const { id } = req.params;
    const { novo_medicamento_id, nova_qtd_caixas, nova_qtd_capsula_por_caixa, mudou_medicamento } = req.body;

    try {
      const monitoramento = await MonitoramentoMedicamento.findByPk(id);
      if (!monitoramento) return res.status(404).json({ error: 'Monitoramento não encontrado' });

      const novaQtdTotalCapsulas = nova_qtd_capsula_por_caixa * nova_qtd_caixas;
      const updateData = {
        medicamento_id: novo_medicamento_id,
        qtd_caixas: nova_qtd_caixas,
        qtd_total_capsulas: novaQtdTotalCapsulas
      };

      if (mudou_medicamento) updateData.data_administracao = null;

      if (novaQtdTotalCapsulas > 0 && monitoramento.posologia_diaria > 0) {
        const baseDate = updateData.data_administracao === null ? monitoramento.data_entrega : (monitoramento.data_administracao || monitoramento.data_entrega);
        updateData.data_calculada_fim_caixa = calcularDataFimCaixa(new Date(baseDate), novaQtdTotalCapsulas, monitoramento.posologia_diaria, monitoramento.tipo_posologia, monitoramento, obterPeriodosPausa(monitoramento));
      }

      await monitoramento.update(updateData);

      const monitoramentoAtualizado = await MonitoramentoMedicamento.findByPk(id, {
        include: [
          { model: Pacientes, as: 'paciente', attributes: ['id', 'nome', 'sobrenome'] },
          { model: Medicamentos, as: 'medicamento', attributes: ATRIBUTOS_MEDICAMENTO_LINHA },
          { model: PatientEvaluation, as: 'avaliacao', attributes: ['id', 'total_score'] }
        ]
      });

      return res.json({ monitoramento: monitoramentoAtualizado });
    } catch (error) { return res.status(500).json({ error: 'Erro ao aplicar atualização' }); }
  }

  async show(req, res) {
    const { id } = req.params;
    try {
      const monitoramento = await MonitoramentoMedicamento.findByPk(id, {
        include: [
          { model: Pacientes, as: 'paciente', attributes: ['id', 'nome', 'sobrenome'] },
          { model: Medicamentos, as: 'medicamento', attributes: ATRIBUTOS_MEDICAMENTO_LINHA }, // 👈 NOVO: qtd_capsula
          { model: ReacaoAdversa, as: 'reacoesAdversas', through: { attributes: [] } }
        ]
      });
      if (!monitoramento) return res.status(404).json({ error: 'Não encontrado.' });
      const resposta = monitoramento.toJSON();
      resposta.reacoes_adversas = resposta.reacoesAdversas;
      return res.json(resposta);
    } catch (error) { return res.status(500).json({ error: 'Erro', details: error.message }); }
  }

  async updateRetroativo(req, res) {
    // [MANTIDO INTACTO]
    const schema = Yup.object().shape({
      qtd_informada_caixa: Yup.number().integer().nullable(),
      is_reacao: Yup.boolean().nullable(),
      reacoes_adversas: Yup.array().of(Yup.number().integer()).nullable(),
      observacao: Yup.string().nullable()
    });
    try { await schema.validate(req.body, { abortEarly: false }); } catch (err) { return res.status(400).json({ error: 'Falha na validação', messages: err.inner }); }

    const { id } = req.params;
    const { qtd_informada_caixa, is_reacao, reacoes_adversas, observacao } = req.body;

    try {
      const monitoramentoAtual = await MonitoramentoMedicamento.findByPk(id);
      if (!monitoramentoAtual) return res.status(404).json({ error: 'Monitoramento não encontrado.' });
      if (monitoramentoAtual.status !== 'CONCLUIDO') return res.status(400).json({ error: 'Apenas concluídos podem sofrer edição retroativa.' });

      await monitoramentoAtual.update({ qtd_informada_caixa, is_reacao, observacao });
      if (is_reacao && reacoes_adversas && reacoes_adversas.length > 0) await monitoramentoAtual.setReacoesAdversas(reacoes_adversas);
      else await monitoramentoAtual.setReacoesAdversas([]);

      await AuditService.log(req.userId, 'Edição Retroativa', 'Monitoramento', monitoramentoAtual.id, `Editou informações (ID: ${monitoramentoAtual.id}).`);
      return res.json({ message: 'Histórico de contato atualizado com sucesso!' });
    } catch (error) { return res.status(500).json({ error: 'Erro', details: error.message }); }
  }

  async historicoCompras(req, res) {
    try {
      const { id } = req.params;

      const monitoramento = await MonitoramentoMedicamento.findByPk(id);
      if (!monitoramento) {
        return res.status(404).json({ error: 'Monitoramento não encontrado.' });
      }

      const eventos = await EventosPaciente.findAll({
        where: { paciente_id: monitoramento.paciente_id },
        include: [
          { model: Pacientes, as: 'paciente', attributes: ['nome', 'sobrenome'] },
          { model: Medicamentos, as: 'medicamento', attributes: ['nome', 'qtd_capsula'] }
        ],
        order: [['external_id', 'DESC']]
      });

      return res.json(eventos);
    } catch (error) {
      console.error("Erro ao buscar histórico de compras:", error);
      return res.status(500).json({ error: 'Erro ao buscar histórico de compras.', details: error.message });
    }
  }

  async historicoAberturas(req, res) {
    try {
      const { id } = req.params;

      const monitoramentoAtual = await MonitoramentoMedicamento.findByPk(id);
      if (!monitoramentoAtual) {
        return res.status(404).json({ error: 'Monitoramento não encontrado.' });
      }

      // Busca todos os monitoramentos do paciente que tenham a data de administração preenchida ou evento vinculado
      const historico = await MonitoramentoMedicamento.findAll({
        where: {
          paciente_id: monitoramentoAtual.paciente_id,
          evento_externo_id: { [Op.not]: null }
        },
        include: [
          { model: Medicamentos, as: 'medicamento', attributes: ['nome'] }
        ],
        attributes: ['id', 'evento_externo_id', 'data_administracao', 'createdAt'],
        order: [['data_administracao', 'DESC NULLS LAST'], ['createdAt', 'DESC']]
      });

      return res.json(historico);
    } catch (error) {
      console.error("Erro ao buscar histórico de aberturas:", error);
      return res.status(500).json({ error: 'Erro ao buscar histórico de aberturas.', details: error.message });
    }
  }



  async registrarContatoConjunto(req, res) {
    const schema = Yup.object().shape({
      grupo_medicamentos_id: Yup.string().nullable(),
      contato_efetivo: Yup.boolean().required(),
      data_proximo_contato: Yup.date().nullable(),
      motivo_falha_contato_id: Yup.number().integer().nullable(),
      registros: Yup.array().of(
        Yup.object().shape({
          monitoramento_id: Yup.number().integer().required(),
          qtd_informada_caixa: Yup.number().integer().nullable(),
          nivel_adesao: Yup.string().oneOf(['COMPLETAMENTE', 'PARCIALMENTE', 'NAO_ADERE']).nullable(),
          is_reacao: Yup.boolean().nullable(),
          reacoes_adversas: Yup.array().of(Yup.number().integer()).nullable(),
          observacao: Yup.string().nullable(),
          mudou_posologia: Yup.boolean().nullable(),
          nova_posologia: Yup.number().integer().nullable(),
          data_mudanca_posologia: Yup.date().nullable(),
          tipo_posologia_nova: Yup.string().oneOf(['diaria', 'ciclica', 'intervalo', 'personalizada']).nullable(),
          posologia_ciclo_dias_toma_nova: Yup.number().integer().positive().nullable(),
          posologia_ciclo_dias_pausa_nova: Yup.number().integer().min(0).nullable(),
          posologia_intervalo_dias_nova: Yup.number().integer().positive().nullable(),
          posologia_datas_personalizadas_nova: Yup.array().of(Yup.date()).nullable(),
          aplicar_nova_compra: Yup.boolean().nullable(),
          dados_nova_compra: Yup.object().nullable(),
          data_inicio_nova_caixa: Yup.date().nullable(),
          posologia_nova_caixa: Yup.number().integer().nullable(),
          // 👇 PADRÃO DA NOVA CAIXA (reposição)
          tipo_posologia_nova_caixa: Yup.string().oneOf(['diaria', 'ciclica', 'intervalo', 'personalizada']).nullable(),
          posologia_ciclo_dias_toma_nova_caixa: Yup.number().integer().positive().nullable(),
          posologia_ciclo_dias_pausa_nova_caixa: Yup.number().integer().min(0).nullable(),
          posologia_intervalo_dias_nova_caixa: Yup.number().integer().positive().nullable(),
          posologia_datas_personalizadas_nova_caixa: Yup.array().of(Yup.string()).nullable(),
          modo_novo_medicamento: Yup.string().oneOf(['CONJUNTO', 'SUBSTITUICAO']).nullable(),
          // 👇 NOVO
          descontinuar_medicamento: Yup.boolean().nullable(),
          motivo_encerramento: Yup.string().nullable(),
          motivo_encerramento_id: Yup.number().integer().nullable(),
          // 👇 NOVO: descontinuação com data em que parou + comprimidos restantes
          data_descontinuacao: Yup.string().nullable(),
          qtd_restante_informada: Yup.number().integer().min(0).nullable(),
          qtd_restante_confirmada: Yup.boolean().nullable(),
          // 👇 LINHA DE TRATAMENTO: medicamento novo oferecido na 1ª etapa pode
          // substituir OUTRO medicamento do grupo — este é o ciclo substituído.
          substitui_monitoramento_id: Yup.number().integer().nullable(),
          // 👇 NOVO: rastreio de processamento da compra oferecida (mesmos campos do registro individual)
          confirmar_consumo_eventos_anteriores: Yup.boolean().nullable(),
          compra_oferecida_evento_id: Yup.number().integer().nullable(),
          motivo_nao_aplicar_compra: Yup.string().oneOf(Object.keys(MOTIVOS_NAO_APLICAR_COMPRA)).nullable(),
          motivo_nao_aplicar_compra_texto: Yup.string().nullable()
        })
      ).min(1).required()
    });
    try { await schema.validate(req.body, { abortEarly: false }); }
    catch (err) { return res.status(400).json({ error: 'Falha na validação', messages: err.inner }); }

    const { contato_efetivo, data_proximo_contato, motivo_falha_contato_id, registros } = req.body;

    // 👇 LINHA DE TRATAMENTO: a oferta de medicamento novo acontece uma vez, na
    // primeira etapa. Se o operador disse que ele SUBSTITUI outro medicamento
    // do grupo, a compra é movida pro registro daquele medicamento — o laço
    // abaixo já sabe substituir "o medicamento deste registro"; a etapa que
    // ofereceu segue como contato normal, sem compra e sem exigir motivo.
    for (const registro of registros) {
      const alvoId = registro.substitui_monitoramento_id;
      if (!registro.aplicar_nova_compra || registro.modo_novo_medicamento !== 'SUBSTITUICAO' || !alvoId || Number(alvoId) === Number(registro.monitoramento_id)) continue;
      const alvo = registros.find(r => Number(r.monitoramento_id) === Number(alvoId));
      if (!alvo) return res.status(400).json({ error: `O medicamento substituído (monitoramento ${alvoId}) não está neste contato.` });
      if (alvo.aplicar_nova_compra) return res.status(400).json({ error: 'O medicamento substituído não pode receber uma reposição no mesmo contato em que é substituído.' });
      if (alvo.descontinuar_medicamento) return res.status(400).json({ error: 'O medicamento substituído não pode ser descontinuado e substituído no mesmo contato.' });
      ['aplicar_nova_compra', 'dados_nova_compra', 'data_inicio_nova_caixa', 'posologia_nova_caixa', 'modo_novo_medicamento', 'confirmar_consumo_eventos_anteriores'].forEach(campo => {
        alvo[campo] = registro[campo];
        registro[campo] = campo === 'aplicar_nova_compra' ? false : null;
      });
      registro.compra_oferecida_evento_id = null; // decisão foi tomada: não é "não aplicada"
    }

    if (contato_efetivo) {
      const todosDescontinuados = registros.every(r => r.descontinuar_medicamento);
      if (!todosDescontinuados && !data_proximo_contato) {
        return res.status(400).json({ error: 'Data do próximo contato é obrigatória.' });
      }
      for (const registro of registros) {
        const erroMotivoCompra = validarMotivoNaoAplicarCompra({ ...registro, contato_efetivo: true });
        if (erroMotivoCompra) return res.status(400).json({ error: erroMotivoCompra });
        if (registro.descontinuar_medicamento && registro.aplicar_nova_compra && !ehSolicitandoUsoConjunto(registro.dados_nova_compra, registro.modo_novo_medicamento)) {
          return res.status(400).json({ error: 'Não é possível descontinuar um medicamento e aplicar uma nova compra para ele ao mesmo tempo.' });
        }
        if (!registro.descontinuar_medicamento && registro.aplicar_nova_compra && ehSolicitandoUsoConjunto(registro.dados_nova_compra, registro.modo_novo_medicamento)) {
          if (!registro.data_inicio_nova_caixa || !registro.posologia_nova_caixa) {
            return res.status(400).json({ error: 'Data de início e posologia do medicamento adicional são obrigatórias para uso em conjunto.' });
          }
        }
      }
    }

    try {
      const resultado = await MonitoramentoMedicamento.sequelize.transaction(async (transaction) => {
        const agora = new Date();

        if (contato_efetivo === false) {
          for (const registro of registros) {
            const monitoramentoAtual = await MonitoramentoMedicamento.findByPk(registro.monitoramento_id, { transaction, lock: transaction.LOCK.UPDATE });
            if (!monitoramentoAtual) continue;
            await monitoramentoAtual.update({
              contato_efetivo: false,
              nivel_adesao: null,
              status: 'CONCLUIDO',
              data_telemonitoramento_efetivado: agora,
              motivo_falha_contato_id: motivo_falha_contato_id || null
            }, { transaction });

            const proximaData = obterProximoDiaUtil(new Date());
            await MonitoramentoMedicamento.create({
              paciente_id: monitoramentoAtual.paciente_id,
              patient_evaluation_id: monitoramentoAtual.patient_evaluation_id,
              medicamento_id: monitoramentoAtual.medicamento_id,
              posologia_diaria: monitoramentoAtual.posologia_diaria,
              tipo_posologia: monitoramentoAtual.tipo_posologia,
              ...extrairParametrosPosologia(monitoramentoAtual),
              data_entrega: monitoramentoAtual.data_entrega,
              data_administracao: monitoramentoAtual.data_administracao,
              data_calculada_fim_caixa: monitoramentoAtual.data_calculada_fim_caixa,
              data_proximo_contato: proximaData,
              status: 'PENDENTE',
              qtd_caixas: monitoramentoAtual.qtd_caixas,
              qtd_total_capsulas: monitoramentoAtual.qtd_total_capsulas,
              evento_externo_id: monitoramentoAtual.evento_externo_id,
              grupo_medicamentos_id: monitoramentoAtual.grupo_medicamentos_id
            }, { transaction });
          }
          return { mensagem: 'Contato sem sucesso. Ambos os medicamentos foram reagendados para o próximo dia útil.', registros: [] };
        }

        const dataProximoContatoCompartilhada = data_proximo_contato ? parseISO(data_proximo_contato) : null;

        const monitoramentosCarregados = [];
        for (const registro of registros) {
          const monitoramentoAtual = await MonitoramentoMedicamento.findByPk(registro.monitoramento_id, { transaction, lock: transaction.LOCK.UPDATE });
          if (!monitoramentoAtual) {
            const erro = new Error(`Monitoramento ${registro.monitoramento_id} não encontrado.`);
            erro.status = 404;
            throw erro;
          }
          monitoramentosCarregados.push({ registro, monitoramentoAtual });
        }

        let grupoMedicamentosId = monitoramentosCarregados
          .map(m => m.monitoramentoAtual.grupo_medicamentos_id)
          .find(Boolean) || `grp-${monitoramentosCarregados[0].monitoramentoAtual.paciente_id}-${Date.now()}`;

        const resultados = [];
        let pacienteIdDoContato = null; // 👈 AUDITORIA: log do grupo não tem entity_id, então leva o paciente explícito
        for (const { registro, monitoramentoAtual } of monitoramentosCarregados) {
          pacienteIdDoContato = monitoramentoAtual.paciente_id;
          const {
            qtd_informada_caixa, nivel_adesao, is_reacao, reacoes_adversas, observacao,
            mudou_posologia, nova_posologia, data_mudanca_posologia,
            tipo_posologia_nova, posologia_ciclo_dias_toma_nova, posologia_ciclo_dias_pausa_nova,
            posologia_intervalo_dias_nova, posologia_datas_personalizadas_nova,
            aplicar_nova_compra, dados_nova_compra, data_inicio_nova_caixa, posologia_nova_caixa, modo_novo_medicamento,
            descontinuar_medicamento, motivo_encerramento, motivo_encerramento_id, // 👈 NOVO
            data_descontinuacao, qtd_restante_informada, qtd_restante_confirmada,
            confirmar_consumo_eventos_anteriores, compra_oferecida_evento_id, motivo_nao_aplicar_compra, motivo_nao_aplicar_compra_texto
          } = registro;

          // ---- 👇 NOVO: descontinuar este medicamento específico ----
          if (descontinuar_medicamento) {
            // 👇 NOVO: data em que parou + comprimidos restantes (projeção confirmada ou corrigida)
            const parada = resolverRestanteNaParada(monitoramentoAtual, { data_parada: data_descontinuacao, qtd_restante_informada, qtd_restante_confirmada });
            if (parada.erro) { const erro = new Error(`${monitoramentoAtual.medicamento?.nome || 'Medicamento'}: ${parada.erro}`); erro.status = 400; throw erro; }
            if (compra_oferecida_evento_id && !aplicar_nova_compra) {
              await registrarCompraNaoAplicada({ monitoramentoAtual, compraOferecidaId: compra_oferecida_evento_id, motivo: 'MEDICAMENTO_DESCONTINUADO', texto: null, userId: req.userId, transaction });
            }
            await monitoramentoAtual.update({
              contato_efetivo: true,
              nivel_adesao,
              qtd_informada_caixa,
              is_reacao,
              status: 'DESCONTINUADO',
              observacao,
              data_telemonitoramento_efetivado: agora,
              motivo_encerramento: motivo_encerramento || null,
              motivo_encerramento_id: motivo_encerramento_id || null,
              grupo_medicamentos_id: grupoMedicamentosId,
              data_descontinuacao: data_descontinuacao,
              qtd_restante_projetada: parada.projecao.qtd_restante_projetada,
              qtd_restante_informada: parada.qtd_restante_informada,
              qtd_restante_confirmada: parada.qtd_restante_confirmada
            }, { transaction });
            await AuditService.log(req.userId, 'Edição', 'Monitoramento', monitoramentoAtual.id, `Medicamento descontinuado (contato em conjunto). Parou de tomar em ${formatarDataBR(data_descontinuacao)}; sobra na caixa: ${parada.qtd_restante_informada} comprimido(s) (${parada.qtd_restante_confirmada ? 'confirmou a projeção' : `projeção era ${parada.projecao.qtd_restante_projetada}, paciente informou outra quantidade`}).`);

            if (is_reacao && reacoes_adversas && reacoes_adversas.length > 0) {
              await monitoramentoAtual.setReacoesAdversas(reacoes_adversas, { transaction });
            } else {
              await monitoramentoAtual.setReacoesAdversas([], { transaction });
            }
            resultados.push(monitoramentoAtual);
            continue; // não cria próximo ciclo pra este medicamento
          }

          let compraRevalidada = null;
          if (aplicar_nova_compra) {
            compraRevalidada = await revalidarDadosNovaCompra(monitoramentoAtual, dados_nova_compra, modo_novo_medicamento, { transaction }, { confirmarConsumoAnteriores: !!confirmar_consumo_eventos_anteriores });
          }
          const ehUsoConjunto = !!(compraRevalidada && compraRevalidada.ehUsoConjunto);

          await monitoramentoAtual.update({
            contato_efetivo: true,
            nivel_adesao,
            qtd_informada_caixa,
            data_abertura_nova_caixa: data_proximo_contato,
            is_reacao,
            status: 'CONCLUIDO',
            observacao,
            data_telemonitoramento_efetivado: agora,
            mudou_posologia: mudou_posologia || false,
            nova_posologia: mudou_posologia ? nova_posologia : null,
            data_mudanca_posologia: mudou_posologia ? data_mudanca_posologia : null,
            grupo_medicamentos_id: grupoMedicamentosId
          }, { transaction });

          if (is_reacao && reacoes_adversas && reacoes_adversas.length > 0) {
            await monitoramentoAtual.setReacoesAdversas(reacoes_adversas, { transaction });
          } else {
            await monitoramentoAtual.setReacoesAdversas([], { transaction });
          }

          let proximoMedicamentoId = monitoramentoAtual.medicamento_id;
          let proximasCaixas = monitoramentoAtual.qtd_caixas;
          let proximasCapsulasTotais = monitoramentoAtual.qtd_total_capsulas;
          let proximaDataEntrega = monitoramentoAtual.data_entrega;
          let proximaDataFimCaixa = monitoramentoAtual.data_calculada_fim_caixa;
          let proximaDataAdministracao = monitoramentoAtual.data_administracao;
          let proximoEventoExternoId = monitoramentoAtual.evento_externo_id;
          let proximaPosologia = (mudou_posologia && nova_posologia) ? nova_posologia : monitoramentoAtual.posologia_diaria;
          // 👇 NOVO: mesmo critério da versão única — usa o padrão novo se
          // veio junto com a mudança de posologia, senão mantém o vigente.
          const proximoPadraoPosologia = (mudou_posologia && tipo_posologia_nova)
            ? {
                tipo_posologia: tipo_posologia_nova,
                posologia_ciclo_dias_toma: posologia_ciclo_dias_toma_nova,
                posologia_ciclo_dias_pausa: posologia_ciclo_dias_pausa_nova,
                posologia_intervalo_dias: posologia_intervalo_dias_nova,
                posologia_datas_personalizadas: posologia_datas_personalizadas_nova
              }
            : { tipo_posologia: monitoramentoAtual.tipo_posologia, ...extrairParametrosPosologia(monitoramentoAtual) };
          // 👇 PADRÃO DA NOVA CAIXA (reposição) informado pelo operador neste registro
          if (aplicar_nova_compra && registro.tipo_posologia_nova_caixa) {
            proximoPadraoPosologia.tipo_posologia = registro.tipo_posologia_nova_caixa;
            Object.assign(proximoPadraoPosologia, extrairParametrosPosologia({
              posologia_ciclo_dias_toma: registro.posologia_ciclo_dias_toma_nova_caixa,
              posologia_ciclo_dias_pausa: registro.posologia_ciclo_dias_pausa_nova_caixa,
              posologia_intervalo_dias: registro.posologia_intervalo_dias_nova_caixa,
              posologia_datas_personalizadas: registro.posologia_datas_personalizadas_nova_caixa
            }));
          }

          // 👇 Mesmo raciocínio da versão única — ver comentário lá.
          // qtd_total_capsulas e data_administracao são imutáveis.
          if (qtd_informada_caixa != null && proximaPosologia > 0) {
            proximaDataFimCaixa = calcularDataFimCaixa(new Date(), qtd_informada_caixa, proximaPosologia, proximoPadraoPosologia.tipo_posologia, proximoPadraoPosologia, obterPeriodosPausa(monitoramentoAtual));
          }

          if (aplicar_nova_compra && compraRevalidada && !ehUsoConjunto) {
            proximoMedicamentoId = compraRevalidada.medicamentoNovoId;
            proximasCaixas = compraRevalidada.qtdCaixas;
            proximaDataEntrega = parseISO(compraRevalidada.dataEntrega);
            proximoEventoExternoId = compraRevalidada.eventoExternoId;
            proximaPosologia = posologia_nova_caixa || monitoramentoAtual.posologia_diaria;
            proximaDataAdministracao = data_inicio_nova_caixa ? parseISO(data_inicio_nova_caixa) : proximaDataAdministracao;
            proximasCapsulasTotais = compraRevalidada.totalCapsulasNovas;
            proximaDataFimCaixa = calcularDataFimCaixa(proximaDataAdministracao, proximasCapsulasTotais, proximaPosologia, proximoPadraoPosologia.tipo_posologia, proximoPadraoPosologia, obterPeriodosPausa(monitoramentoAtual));

            if (compraRevalidada.mudouMedicamento) {
              await HistoricoTrocaMedicamento.create({
                paciente_id: monitoramentoAtual.paciente_id,
                medicamento_antigo_id: compraRevalidada.medicamentoAtualId,
                medicamento_novo_id: proximoMedicamentoId,
                data_troca: proximaDataEntrega,
                monitoramento_id: monitoramentoAtual.id
              }, { transaction });
            }
          }

          const novoRegistro = await MonitoramentoMedicamento.create({
            paciente_id: monitoramentoAtual.paciente_id,
            patient_evaluation_id: monitoramentoAtual.patient_evaluation_id,
            medicamento_id: proximoMedicamentoId,
            posologia_diaria: proximaPosologia,
            tipo_posologia: proximoPadraoPosologia.tipo_posologia,
            ...proximoPadraoPosologia,
            data_entrega: proximaDataEntrega,
            data_administracao: proximaDataAdministracao,
            data_calculada_fim_caixa: proximaDataFimCaixa,
            data_proximo_contato: dataProximoContatoCompartilhada,
            status: 'PENDENTE',
            qtd_caixas: proximasCaixas,
            qtd_total_capsulas: proximasCapsulasTotais,
            evento_externo_id: proximoEventoExternoId,
            grupo_medicamentos_id: grupoMedicamentosId
          }, { transaction });

          let novoRegistroAdicional = null;
          if (ehUsoConjunto) {
            if (!data_inicio_nova_caixa || !posologia_nova_caixa) {
              const erro = new Error('Data de início e posologia do medicamento adicional são obrigatórias para uso em conjunto.');
              erro.status = 400;
              throw erro;
            }
            const dataAdministracaoNovoMed = parseISO(data_inicio_nova_caixa);
            const totalCapsulasNovoMed = compraRevalidada.totalCapsulasNovas;
            const tipoPosologiaNovoMed = req.body.tipo_posologia_novo_medicamento || 'diaria';
            const parametrosPosologiaNovoMed = extrairParametrosPosologia(req.body.parametros_posologia_novo_medicamento || {});
            const dataFimCaixaNovoMed = calcularDataFimCaixa(dataAdministracaoNovoMed, totalCapsulasNovoMed, posologia_nova_caixa, tipoPosologiaNovoMed, parametrosPosologiaNovoMed);

            novoRegistroAdicional = await MonitoramentoMedicamento.create({
              paciente_id: monitoramentoAtual.paciente_id,
              patient_evaluation_id: monitoramentoAtual.patient_evaluation_id,
              medicamento_id: compraRevalidada.medicamentoNovoId,
              posologia_diaria: posologia_nova_caixa,
              tipo_posologia: tipoPosologiaNovoMed, ...parametrosPosologiaNovoMed,
              data_entrega: parseISO(compraRevalidada.dataEntrega),
              data_administracao: dataAdministracaoNovoMed,
              data_calculada_fim_caixa: dataFimCaixaNovoMed,
              data_proximo_contato: calcularDataTelemonitoramento(dataAdministracaoNovoMed),
              status: 'PENDENTE',
              qtd_caixas: compraRevalidada.qtdCaixas,
              qtd_total_capsulas: totalCapsulasNovoMed,
              evento_externo_id: compraRevalidada.eventoExternoId,
              grupo_medicamentos_id: grupoMedicamentosId
            }, { transaction });
          }

          // 👇 NOVO: rastro de processamento da compra no próprio evento + auditoria.
          if (compraRevalidada) {
            await registrarProcessamentoCompra({
              compraRevalidada, monitoramentoAtual, userId: req.userId, transaction,
              novoCiclo: ehUsoConjunto ? novoRegistroAdicional : novoRegistro
            });
          } else if (compra_oferecida_evento_id) {
            await registrarCompraNaoAplicada({ monitoramentoAtual, compraOferecidaId: compra_oferecida_evento_id, motivo: motivo_nao_aplicar_compra, texto: motivo_nao_aplicar_compra_texto, userId: req.userId, transaction });
          }

          // 👇 AUDITORIA: um log por medicamento do contato em conjunto (antes só
          // existia o log do grupo, sem dizer o que mudou em cada medicamento)
          await AuditService.log(req.userId, 'Edição', 'Monitoramento', monitoramentoAtual.id,
            `Registrou contato (em conjunto, grupo ${grupoMedicamentosId}). Mudou posologia: ${mudou_posologia ? `sim (${monitoramentoAtual.posologia_diaria} → ${nova_posologia} por dose a partir de ${formatarDataBR(data_mudanca_posologia)}${tipo_posologia_nova ? `, padrão ${tipo_posologia_nova}` : ''})` : 'não'}. Nova compra aplicada: ${compraRevalidada ? `#${compraRevalidada.eventoExternoId}` : 'não'}.`);

          novoRegistro.setDataValue('origem_monitoramento_id', monitoramentoAtual.id); // 👈 pro front localizar o ciclo novo (pausa com compra)
          resultados.push(novoRegistro);
        }

        await AuditService.log(
          req.userId, 'Edição', 'Monitoramento', null,
          `Registrou contato em conjunto para o grupo ${grupoMedicamentosId}. Data do próximo contato: ${data_proximo_contato || 'N/A (medicamentos descontinuados)'}`,
          pacienteIdDoContato
        );

        return { mensagem: `Contato registrado para os ${resultados.length} medicamentos com sucesso!`, registros: resultados };
      });

      return res.json({ message: resultado.mensagem, registros: resultado.registros });
    } catch (error) {
      const status = error.status || 500;
      return res.status(status).json({ error: status === 500 ? 'Erro ao registrar contato em conjunto' : error.message, details: error.message });
    }
  }

  // 👇 LINHA DE TRATAMENTO: medicamentos novos recebidos (compra pendente de
  // uma linha SEM acompanhamento ativo), um por linha, no mesmo formato dos
  // candidatos de retomada — a tela abre o "Iniciar Tratamento" com isso logo
  // após o contato ser registrado (a reposição do medicamento atual tem
  // prioridade na etapa; o novo entra em seguida, em conjunto).
  async novasLinhasPendentes(req, res) {
    const { pacienteId } = req.params;
    try {
      const linhasAtivas = await chavesLinhasAtivasDoPaciente(pacienteId);
      const eventos = await EventosPaciente.findAll({
        where: { paciente_id: pacienteId, recebido: true, processado: false, excluido_externo: false },
        include: [{ model: Medicamentos, as: 'medicamento' }]
      });
      const porLinha = {};
      eventos
        .filter(e => e.medicamento && !linhasAtivas.has(chaveLinhaTratamento(e.medicamento)))
        .sort(compararEventosPorData)
        .forEach(e => {
          const chave = chaveLinhaTratamento(e.medicamento);
          if (!porLinha[chave]) porLinha[chave] = [];
          porLinha[chave].push(e);
        });
      const candidatos = Object.values(porLinha).map(lista => {
        const evento = lista[0]; // a mais antiga; a lista inteira vai pro seletor
        const dataAdminExterna = evento.data_administracao_prevista;
        return {
          eventos_pendentes: lista.map(resumirEventoPendente), // 👈 SELETOR DE COMPRA-BASE
          evento_externo_id: evento.external_id,
          medicamento_id: evento.medicamento_id,
          linha_tratamento: chaveLinhaTratamento(evento.medicamento),
          medicamento_nome: evento.medicamento?.nome,
          qtd_capsula_conhecida: evento.medicamento?.qtd_capsula != null,
          qtd_caixas: evento.qtd_caixas,
          data_entrega: evento.data_entrega_real || evento.data_entrega_prevista,
          data_previsao_administracao: dataAdminExterna,
          data_sugerida_primeiro_contato: dataAdminExterna ? calcularDataTelemonitoramento(parseISO(dataAdminExterna)) : null
        };
      });
      return res.json({ candidatos });
    } catch (err) {
      console.error('Erro ao listar medicamentos novos pendentes:', err);
      return res.status(500).json({ error: 'Erro ao listar medicamentos novos pendentes.' });
    }
  }

  async candidatosRetomada(req, res) {
    const { paciente_ids } = req.query;
    if (!paciente_ids) return res.json({ candidatos: {} });
    const idsArray = String(paciente_ids).split(',').map(v => parseInt(v, 10)).filter(v => !isNaN(v));
    if (idsArray.length === 0) return res.json({ candidatos: {} });

    try {
      // 👇 regra extraída pra calcularCandidatosRetomada (reusada pelo index)
      const candidatos = await calcularCandidatosRetomada(idsArray);
      return res.json({ candidatos });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao buscar candidatos de retomada.', details: error.message });
    }
  }


  async criarEventoReembolso(req, res) {
    const schema = Yup.object().shape({
      qtd_caixas_reembolsadas: Yup.number().integer().min(1).required(),
      data_inicio_medicamento: Yup.date().required(),
      posologia: Yup.number().integer().min(1).nullable(), // 👈 NOVO
      qtd_capsula_manual: Yup.number().integer().min(1).nullable()
    });
    try { await schema.validate(req.body, { abortEarly: false }); }
    catch (err) { return res.status(400).json({ error: 'Falha na validação', messages: err.inner }); }

    const { id } = req.params;
    const { qtd_caixas_reembolsadas, data_inicio_medicamento, posologia, qtd_capsula_manual } = req.body;

    try {
      const resultado = await MonitoramentoMedicamento.sequelize.transaction(async (transaction) => {
        const monitoramentoAtual = await MonitoramentoMedicamento.findByPk(id, {
          transaction,
          lock: transaction.LOCK.UPDATE
        });
        if (!monitoramentoAtual) {
          const erro = new Error('Monitoramento não encontrado.');
          erro.status = 404;
          throw erro;
        }
        if (monitoramentoAtual.status !== 'PENDENTE') {
          const erro = new Error('Só é possível criar um evento de reembolso a partir de um monitoramento pendente.');
          erro.status = 400;
          throw erro;
        }

        const medicamento = await Medicamentos.findByPk(monitoramentoAtual.medicamento_id, { transaction });

        const qtdPorCaixa = medicamento?.qtd_capsula || qtd_capsula_manual;
        if (!qtdPorCaixa) {
          const erro = new Error(`Informe a quantidade de comprimidos por caixa de ${medicamento?.nome} para calcular o ciclo.`);
          erro.status = 400;
          erro.payload = { needs_qtd_capsula: true, medicamento_id: monitoramentoAtual.medicamento_id };
          throw erro;
        }
        if (qtd_capsula_manual && !medicamento.qtd_capsula) {
          await medicamento.update({ qtd_capsula: qtd_capsula_manual }, { transaction });
        }

        const dataInicio = parseISO(data_inicio_medicamento);
        // 👇 NOVO: a posologia informada na tela tem prioridade — a dosagem
        // pode ter mudado desde o último ciclo sincronizado.
        const posologiaVigente = posologia || monitoramentoAtual.posologia_diaria;
        const qtdTotalCapsulas = qtdPorCaixa * qtd_caixas_reembolsadas;
        const dataFimCaixa = calcularDataFimCaixa(dataInicio, qtdTotalCapsulas, posologiaVigente, monitoramentoAtual.tipo_posologia, monitoramentoAtual, obterPeriodosPausa(monitoramentoAtual));
        const dataProximoContatoSugerida = calcularDataTelemonitoramento(dataInicio);

        // Cancela o registro pendente antigo — ele fica sem uma compra
        // sincronizada disponível e é substituído pelo ciclo de reembolso.
        await monitoramentoAtual.update({ status: 'CANCELADO' }, { transaction });

        const novoMonitoramentoReembolso = await MonitoramentoMedicamento.create({
          paciente_id: monitoramentoAtual.paciente_id,
          patient_evaluation_id: monitoramentoAtual.patient_evaluation_id,
          medicamento_id: monitoramentoAtual.medicamento_id,
          posologia_diaria: posologiaVigente,
          tipo_posologia: monitoramentoAtual.tipo_posologia,
          ...extrairParametrosPosologia(monitoramentoAtual),
          data_entrega: dataInicio,
          data_administracao: dataInicio,
          data_calculada_fim_caixa: dataFimCaixa,
          data_proximo_contato: dataProximoContatoSugerida,
          status: 'PENDENTE',
          qtd_caixas: qtd_caixas_reembolsadas,
          qtd_total_capsulas: qtdTotalCapsulas,
          evento_externo_id: monitoramentoAtual.evento_externo_id,
          eh_reembolso: true,
          grupo_medicamentos_id: monitoramentoAtual.grupo_medicamentos_id
        }, { transaction });

        await AuditService.log(
          req.userId, 'Criação', 'Monitoramento', novoMonitoramentoReembolso.id,
          `Evento de reembolso criado para ${medicamento?.nome} (paciente ${monitoramentoAtual.paciente_id}). Caixas reembolsadas: ${qtd_caixas_reembolsadas}. Posologia: ${posologiaVigente}/dia. Início: ${data_inicio_medicamento}. Substitui o monitoramento #${monitoramentoAtual.id} (cancelado).`
        );

        return novoMonitoramentoReembolso;
      });

      return res.status(201).json({
        message: 'Evento de reembolso criado com sucesso. Prossiga com o registro de contato normalmente.',
        monitoramento: resultado
      });
    } catch (error) {
      const status = error.status || 500;
      return res.status(status).json({
        error: status === 500 ? 'Erro ao criar evento de reembolso' : error.message,
        ...(error.payload || {}),
        details: error.message
      });
    }
  }

  // ============================================================
// FUNÇÃO NOVA: atualizarDataProximoContato()
// Reagenda a data_proximo_contato de um monitoramento PENDENTE. Usada pelo
// fluxo de uso conjunto imediato pra alinhar a data do medicamento ATUAL
// (já fechado) com a data escolhida na resolução de divergência de adesão
// do medicamento adicional — sem isso os dois ficam com datas diferentes.
// ============================================================
async atualizarDataProximoContato(req, res) {
  const schema = Yup.object().shape({
    data_proximo_contato: Yup.date().required()
  });
  try { await schema.validate(req.body, { abortEarly: false }); }
  catch (err) { return res.status(400).json({ error: 'Falha na validação', messages: err.inner }); }

  const { id } = req.params;
  const { data_proximo_contato } = req.body;

  try {
    const monitoramento = await MonitoramentoMedicamento.findByPk(id);
    if (!monitoramento) return res.status(404).json({ error: 'Monitoramento não encontrado.' });
    if (monitoramento.status !== 'PENDENTE') {
      return res.status(400).json({ error: 'Só é possível reagendar um monitoramento pendente.' });
    }
    await monitoramento.update({ data_proximo_contato: parseISO(data_proximo_contato) });
    return res.json({ message: 'Data do próximo contato atualizada com sucesso.' });
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao atualizar data do próximo contato', details: error.message });
  }
}

  // ============================================================
  // RECÁLCULO — aba "Atendimento"
  // Corrige posologia/data de início quando foram cadastradas erradas na
  // configuração de uso contínuo, sem passar pelo fluxo de "Registrar
  // Contato". Só é permitido no PRIMEIRO CICLO de um medicamento — ou seja,
  // quando não existe NENHUM outro registro (de qualquer status) pra esse
  // mesmo par paciente+medicamento. Depois do primeiro ciclo, qualquer
  // ajuste tem que vir do fluxo normal de telemonitoramento.
  // ============================================================
  async listarRecalculaveis(req, res) {
    try {
      const { operadora_id, search = '' } = req.query;
      const permission = await getOperadoraFilter(req.userId, operadora_id);
      if (!permission.authorized) {
        if (permission.emptyResult) return res.json([]);
        return res.status(permission.status).json({ error: permission.error });
      }

      let pacienteWhere = { ...permission.whereClause };
      if (search) {
        const termosPesquisa = search.trim().split(/\s+/);
        const condicoesBusca = termosPesquisa.map(termo => ({
          [Op.or]: [{ nome: { [Op.iLike]: `%${termo}%` } }, { sobrenome: { [Op.iLike]: `%${termo}%` } }]
        }));
        pacienteWhere = { ...pacienteWhere, [Op.and]: condicoesBusca };
      }

      const pendentes = await MonitoramentoMedicamento.findAll({
        where: { status: 'PENDENTE' },
        include: [
          { model: Pacientes, as: 'paciente', attributes: ['id', 'nome', 'sobrenome'], where: pacienteWhere, required: true },
          { model: Medicamentos, as: 'medicamento', attributes: ATRIBUTOS_MEDICAMENTO_LINHA }
        ],
        order: [['createdAt', 'DESC']]
      });

      if (pendentes.length === 0) return res.json([]);

      // Conta, pra cada par (paciente, medicamento) que aparece nos pendentes,
      // QUANTOS registros existem no total (qualquer status). Se der 1, é o
      // próprio pendente — logo, primeiro ciclo, elegível pro recálculo.
      const paresUnicos = [...new Set(pendentes.map(p => `${p.paciente_id}-${p.medicamento_id}`))];
      const contagens = await MonitoramentoMedicamento.findAll({
        attributes: ['paciente_id', 'medicamento_id', [fn('COUNT', col('id')), 'total']],
        where: {
          [Op.or]: paresUnicos.map(par => {
            const [paciente_id, medicamento_id] = par.split('-').map(Number);
            return { paciente_id, medicamento_id };
          })
        },
        group: ['paciente_id', 'medicamento_id'],
        raw: true
      });
      const totalPorPar = {};
      contagens.forEach(c => { totalPorPar[`${c.paciente_id}-${c.medicamento_id}`] = parseInt(c.total, 10); });

      const elegiveis = pendentes.filter(p => totalPorPar[`${p.paciente_id}-${p.medicamento_id}`] === 1);

      return res.json(elegiveis);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao buscar monitoramentos recalculáveis.', details: error.message });
    }
  }

  async recalcular(req, res) {
    const schema = Yup.object().shape({
      posologia_diaria: Yup.number().integer().positive().required(),
      data_administracao: Yup.date().required(),
      // 👇 NOVO: padrão de posologia fora do padrão diário. Se omitido,
      // assume 'diaria' — comportamento idêntico ao de antes.
      tipo_posologia: Yup.string().oneOf(['diaria', 'ciclica', 'intervalo', 'personalizada']).nullable(),
      posologia_ciclo_dias_toma: Yup.number().integer().positive().nullable(),
      posologia_ciclo_dias_pausa: Yup.number().integer().min(0).nullable(),
      posologia_intervalo_dias: Yup.number().integer().positive().nullable(),
      posologia_datas_personalizadas: Yup.array().of(Yup.date()).nullable()
    });
    try { await schema.validate(req.body, { abortEarly: false }); }
    catch (err) { return res.status(400).json({ error: 'Falha na validação', messages: err.inner }); }

    const { id } = req.params;
    const { posologia_diaria, data_administracao } = req.body;
    const tipoPosologia = req.body.tipo_posologia || 'diaria';
    const parametrosPosologia = extrairParametrosPosologia(req.body);

    try {
      const monitoramento = await MonitoramentoMedicamento.findByPk(id, {
        include: [
          { model: Pacientes, as: 'paciente', attributes: ['id', 'nome', 'sobrenome'] },
          { model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome'] }
        ]
      });
      if (!monitoramento) return res.status(404).json({ error: 'Monitoramento não encontrado.' });

      if (monitoramento.status !== 'PENDENTE') {
        return res.status(400).json({ error: 'Só é possível recalcular um monitoramento pendente. Ciclos concluídos não podem ser alterados.' });
      }

      // Revalida no servidor que é mesmo o primeiro ciclo — não confia só no
      // que a listagem mandou pro front, a regra vale sempre.
      const outrosCiclos = await MonitoramentoMedicamento.count({
        where: { paciente_id: monitoramento.paciente_id, medicamento_id: monitoramento.medicamento_id, id: { [Op.ne]: monitoramento.id } }
      });
      if (outrosCiclos > 0) {
        return res.status(400).json({ error: 'Este medicamento já teve ciclo(s) anterior(es) — o recálculo só é permitido no primeiro ciclo.' });
      }

      const posologiaAnterior = monitoramento.posologia_diaria;
      const tipoPosologiaAnterior = monitoramento.tipo_posologia || 'diaria';
      const dataInicioAnterior = monitoramento.data_administracao || monitoramento.data_entrega;

      const novaDataInicio = parseISO(data_administracao);
      const totalCapsulas = monitoramento.qtd_total_capsulas || 0;
      const novaDataFimCaixa = calcularDataFimCaixa(novaDataInicio, totalCapsulas, posologia_diaria, tipoPosologia, parametrosPosologia);
      const novaDataProximoContato = calcularDataTelemonitoramento(novaDataInicio);

      await monitoramento.update({
        posologia_diaria,
        tipo_posologia: tipoPosologia,
        ...parametrosPosologia,
        data_administracao: novaDataInicio,
        data_calculada_fim_caixa: novaDataFimCaixa,
        data_proximo_contato: novaDataProximoContato
      });

      const descricaoPadrao = (tp, p) => {
        if (tp === 'ciclica') return `cíclica (toma ${p.posologia_ciclo_dias_toma}, pausa ${p.posologia_ciclo_dias_pausa})`;
        if (tp === 'intervalo') return `a cada ${p.posologia_intervalo_dias} dias`;
        if (tp === 'personalizada') return `datas personalizadas`;
        return 'diária';
      };

      await AuditService.log(
        req.userId, 'Edição', 'Monitoramento', monitoramento.id,
        `Recálculo do primeiro ciclo de ${monitoramento.medicamento?.nome} para ${monitoramento.paciente?.nome} ${monitoramento.paciente?.sobrenome}: posologia ${posologiaAnterior} → ${posologia_diaria} cp/dia, padrão ${descricaoPadrao(tipoPosologiaAnterior, monitoramento)} → ${descricaoPadrao(tipoPosologia, parametrosPosologia)}, início ${dataInicioAnterior ? new Date(dataInicioAnterior).toLocaleDateString('pt-BR') : 'N/A'} → ${novaDataInicio.toLocaleDateString('pt-BR')}.`
      );

      return res.json({ message: 'Recálculo aplicado com sucesso.', monitoramento });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao recalcular monitoramento.', details: error.message });
    }
  }

  // Pausa TEMPORARIAMENTE um medicamento específico (diferente de "Pausar
  // Tratamento", que pausa o paciente inteiro sem prazo). O registro sai da
  // fila normal (status PAUSADO) até alguém destravar, e a data prevista
  // de retomada alimenta o alerta de "pausa terminando em breve".
  async pausarMedicamento(req, res) {
    const { id } = req.params;
    // 👇 NOVO: compra_oferecida_evento_id — quando a tela estava oferecendo
    // uma compra e o operador pausou em vez de aplicar, fica registrado na
    // auditoria que ela foi oferecida e não aplicada por causa da pausa.
    // 👇 NOVO: data_parada (primeiro dia sem tomar) + comprimidos restantes
    // confirmados/informados — antes a pausa começava sempre "agora" (hora da
    // ligação), e a contagem na retomada saía errada pelos dias de atraso.
    const { motivo_id, data_fim_prevista, observacao, compra_oferecida_evento_id, data_parada, qtd_restante_informada, qtd_restante_confirmada } = req.body;

    if (!motivo_id || !data_fim_prevista) {
      return res.status(400).json({ error: 'Informe o motivo e a data prevista de retomada.' });
    }

    try {
      const monitoramento = await MonitoramentoMedicamento.findByPk(id, {
        include: [
          { model: Pacientes, as: 'paciente', attributes: ['id', 'nome', 'sobrenome'] },
          { model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome'] }
        ]
      });
      if (!monitoramento) return res.status(404).json({ error: 'Monitoramento não encontrado.' });
      if (monitoramento.status !== 'PENDENTE') {
        return res.status(400).json({ error: 'Só é possível pausar um monitoramento pendente.' });
      }
      const parada = resolverRestanteNaParada(monitoramento, { data_parada, qtd_restante_informada, qtd_restante_confirmada });
      if (parada.erro) return res.status(400).json({ error: parada.erro });
      if (parseISO(data_parada) > parseISO(data_fim_prevista)) {
        return res.status(400).json({ error: 'A data prevista de retomada não pode ser antes da data em que parou de tomar.' });
      }

      await monitoramento.update({
        status: 'PAUSADO',
        data_pausa_inicio: parseISO(data_parada),
        data_pausa_fim_prevista: parseISO(data_fim_prevista),
        motivo_pausa_medicamento_id: motivo_id,
        motivo_pausa_medicamento_observacao: observacao || null,
        qtd_restante_projetada: parada.projecao.qtd_restante_projetada,
        qtd_restante_informada: parada.qtd_restante_informada,
        qtd_restante_confirmada: parada.qtd_restante_confirmada
      });

      await AuditService.log(
        req.userId, 'Edição', 'Monitoramento', monitoramento.id,
        `Pausou temporariamente o acompanhamento de ${monitoramento.medicamento?.nome} para ${monitoramento.paciente?.nome} ${monitoramento.paciente?.sobrenome}: parou de tomar em ${formatarDataBR(data_parada)}, retomada prevista para ${parseISO(data_fim_prevista).toLocaleDateString('pt-BR')}; comprimidos na caixa: ${parada.qtd_restante_informada} (${parada.qtd_restante_confirmada ? 'confirmou a projeção' : `projeção era ${parada.projecao.qtd_restante_projetada}, paciente informou outra quantidade`}).`
      );
      if (compra_oferecida_evento_id) {
        await registrarCompraNaoAplicada({ monitoramentoAtual: monitoramento, compraOferecidaId: compra_oferecida_evento_id, motivo: 'MEDICAMENTO_PAUSADO', texto: null, userId: req.userId });
      }

      return res.json({ message: 'Medicamento pausado com sucesso.', monitoramento });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao pausar medicamento.' });
    }
  }

  // Destrava a pausa — move o período pro histórico (com a data real de
  // fim = hoje, que pode ser diferente da prevista), recalcula a data de
  // fim de caixa considerando esse período parado, e volta status PENDENTE.
  async destravarPausaMedicamento(req, res) {
    const { id } = req.params;
    // 👇 NOVO: aceita a data REAL em que o paciente voltou a tomar, que pode
    // ser diferente de hoje (ex: pausa venceu ontem, mas o operador só
    // processa no sistema 3 dias depois — sem isso, esses 3 dias de atraso
    // administrativo seriam contados como se o paciente ainda estivesse
    // parado, quando na real ele já tinha voltado a tomar).
    const { data_retomada_real } = req.body;

    try {
      const monitoramento = await MonitoramentoMedicamento.findByPk(id, {
        include: [
          { model: Pacientes, as: 'paciente', attributes: ['id', 'nome', 'sobrenome'] },
          { model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome'] }
        ]
      });
      if (!monitoramento) return res.status(404).json({ error: 'Monitoramento não encontrado.' });
      if (monitoramento.status !== 'PAUSADO') {
        return res.status(400).json({ error: 'Este medicamento não está pausado.' });
      }

      const hoje = new Date();
      const fimRealPausa = data_retomada_real ? parseISO(data_retomada_real) : hoje;

      if (fimRealPausa > hoje) {
        return res.status(400).json({ error: 'A data real de retomada não pode ser no futuro.' });
      }
      if (monitoramento.data_pausa_inicio && fimRealPausa < new Date(monitoramento.data_pausa_inicio)) {
        return res.status(400).json({ error: 'A data real de retomada não pode ser antes do início da pausa.' });
      }

      const historicoAtualizado = [
        ...(Array.isArray(monitoramento.pausas_historico) ? monitoramento.pausas_historico : []),
        {
          inicio: monitoramento.data_pausa_inicio,
          // 👇 CORREÇÃO: o motor trata `fim` como dia pausado (inclusivo); o dia
          // da retomada é dia de toma, então o período guardado vai até a
          // véspera. Antes o dia da retomada era contado como pausado.
          fim: addDays(fimRealPausa, -1).toISOString(),
          qtd_restante_projetada: monitoramento.qtd_restante_projetada ?? null,
          qtd_restante_informada: monitoramento.qtd_restante_informada ?? null
        }
      ];

      const dataInicioCiclo = monitoramento.data_administracao || monitoramento.data_entrega;
      // 👇 NOVO: se na pausa o paciente informou quantos comprimidos tinha
      // (e esse número difere da projeção), a retomada parte dessa quantidade:
      // o "total efetivo" da caixa vira o informado + o que o sistema contou
      // até a parada — assim o padrão de posologia e as pausas anteriores
      // continuam valendo e o fim de caixa sai da quantidade real.
      let totalParaRecalculo = monitoramento.qtd_total_capsulas;
      let notaRestante = '';
      if (monitoramento.qtd_restante_informada !== null && monitoramento.qtd_restante_informada !== undefined && monitoramento.data_pausa_inicio) {
        const projecao = projetarRestanteNaParada(monitoramento, new Date(monitoramento.data_pausa_inicio).toISOString().split('T')[0]);
        totalParaRecalculo = monitoramento.qtd_restante_informada + projecao.consumidos;
        notaRestante = ` Comprimidos na pausa: ${monitoramento.qtd_restante_informada} (projeção ${projecao.qtd_restante_projetada}).`;
      }
      const novaDataFimCaixa = calcularDataFimCaixa(
        new Date(dataInicioCiclo), totalParaRecalculo, monitoramento.posologia_diaria,
        monitoramento.tipo_posologia, monitoramento, historicoAtualizado
      );

      await monitoramento.update({
        status: 'PENDENTE',
        pausas_historico: historicoAtualizado,
        data_pausa_inicio: null,
        data_pausa_fim_prevista: null,
        motivo_pausa_medicamento_id: null,
        motivo_pausa_medicamento_observacao: null,
        data_calculada_fim_caixa: novaDataFimCaixa
      });

      await AuditService.log(
        req.userId, 'Edição', 'Monitoramento', monitoramento.id,
        `Destravou a pausa de ${monitoramento.medicamento?.nome} para ${monitoramento.paciente?.nome} ${monitoramento.paciente?.sobrenome} — retomando o acompanhamento normal. Data real de retomada considerada: ${fimRealPausa.toLocaleDateString('pt-BR')}${data_retomada_real ? ' (informada manualmente)' : ' (hoje)'}.${notaRestante} Novo fim de caixa: ${formatarDataBR(novaDataFimCaixa)}.`
      );

      return res.json({ message: 'Pausa destravada, acompanhamento retomado.', monitoramento });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao destravar pausa.' });
    }
  }

  // Estende o prazo de uma pausa já em andamento — pro caso de a data
  // prevista vencer mas o paciente ainda não poder retomar (ex: médico
  // ainda não liberou). Só muda a data prevista, não mexe em status nem
  // em cálculo — o medicamento continua PAUSADO, sem contagem.
  async estenderPausaMedicamento(req, res) {
    const { id } = req.params;
    const { nova_data_fim_prevista } = req.body;

    if (!nova_data_fim_prevista) {
      return res.status(400).json({ error: 'Informe a nova data prevista de retomada.' });
    }

    try {
      const monitoramento = await MonitoramentoMedicamento.findByPk(id, {
        include: [
          { model: Pacientes, as: 'paciente', attributes: ['id', 'nome', 'sobrenome'] },
          { model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome'] }
        ]
      });
      if (!monitoramento) return res.status(404).json({ error: 'Monitoramento não encontrado.' });
      if (monitoramento.status !== 'PAUSADO') {
        return res.status(400).json({ error: 'Este medicamento não está pausado.' });
      }

      const novaData = parseISO(nova_data_fim_prevista);
      if (monitoramento.data_pausa_inicio && novaData < new Date(monitoramento.data_pausa_inicio)) {
        return res.status(400).json({ error: 'A nova data prevista não pode ser antes do início da pausa.' });
      }

      await monitoramento.update({ data_pausa_fim_prevista: novaData });

      await AuditService.log(
        req.userId, 'Edição', 'Monitoramento', monitoramento.id,
        `Estendeu a pausa de ${monitoramento.medicamento?.nome} para ${monitoramento.paciente?.nome} ${monitoramento.paciente?.sobrenome} — nova retomada prevista: ${novaData.toLocaleDateString('pt-BR')}.`
      );

      return res.json({ message: 'Prazo da pausa estendido com sucesso.', monitoramento });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao estender a pausa.' });
    }
  }

  // Lista todo medicamento atualmente pausado — alimenta a aba "Pausados"
  // do Telemonitoramento e a checagem de alerta de pausas vencendo em breve.
  async listarPausados(req, res) {
    try {
      const { operadora_id } = req.query;
      const permission = await getOperadoraFilter(req.userId, operadora_id);
      if (!permission.authorized) {
        if (permission.emptyResult) return res.json([]);
        return res.status(permission.status).json({ error: permission.error });
      }

      const pausados = await MonitoramentoMedicamento.findAll({
        where: { status: 'PAUSADO' },
        include: [
          {
            model: Pacientes, as: 'paciente', attributes: ['id', 'nome', 'sobrenome', 'cpf'],
            where: permission.whereClause, required: true, include: ['operadoras']
          },
          { model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome'] },
          { model: MotivoPausaTratamento, as: 'motivoPausaMedicamento', attributes: ['id', 'descricao'] }
        ],
        order: [['data_pausa_fim_prevista', 'ASC']]
      });
      return res.json(pausados);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao listar medicamentos pausados.' });
    }
  }

  // Gera a prévia de "toma"/"pausa" pra tela de confirmação (calendário)
  // antes de salvar qualquer padrão de posologia. Não grava nada — é só
  // cálculo, usado tanto na configuração inicial quanto no Recálculo e no
  // Registrar Contato.
  // 👇 NOVO: projeção de comprimidos restantes numa data de parada — alimenta
  // a confirmação "com essa pausa o paciente deve ter X comprimidos" na pausa
  // temporária e na descontinuação. Sem `base`, usa o ciclo; com `base`
  // (data_inicio, qtd_total, posologia, tipo_posologia, parametros), projeta
  // uma caixa ainda não gravada (ex: compra nova aplicada no mesmo contato).
  async projecaoRestante(req, res) {
    const { id } = req.params;
    const { data_parada, base } = req.body;
    if (!data_parada) return res.status(400).json({ error: 'Informe a data em que o paciente parou de tomar.' });
    try {
      const monitoramento = await MonitoramentoMedicamento.findByPk(id);
      if (!monitoramento) return res.status(404).json({ error: 'Monitoramento não encontrado.' });
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      const parada = parseISO(data_parada);
      if (isNaN(parada.getTime())) return res.status(400).json({ error: 'Data em que parou de tomar inválida.' });
      if (parada > hoje) return res.status(400).json({ error: 'A data em que parou de tomar não pode ser no futuro.' });
      return res.json(projetarRestanteNaParada(monitoramento, data_parada, base || null));
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao projetar comprimidos restantes.', details: error.message });
    }
  }

  async previewPosologia(req, res) {
    const { data_inicio, tipo_posologia, num_dias } = req.body;
    if (!data_inicio) {
      return res.status(400).json({ error: 'Informe a data de início.' });
    }
    try {
      const parametros = extrairParametrosPosologia(req.body);
      const dias = gerarPreviewPosologia(parseISO(data_inicio), tipo_posologia || 'diaria', parametros, num_dias || 35);
      return res.json({ dias });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao gerar prévia da posologia.', details: error.message });
    }
  }
}

export default new MonitoramentoMedicamentoController();