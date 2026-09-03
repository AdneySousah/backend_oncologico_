import { Op, Sequelize } from 'sequelize';
import Pacientes from '../models/Pacientes.js';
import PatientEvaluation from '../models/PatientEvaluation.js';
import EvaluationTemplate from '../models/EvaluationTemplate.js';
import MonitoramentoMedicamento from '../models/MonitoramentoMedicamento.js';
import ReacaoAdversa from '../models/ReacaoAdversa.js';
import Operadora from '../models/Operadora.js';
import NpsResponse from '../models/NpsResponse.js';
import EventosPaciente from '../models/EventosPaciente.js';
import { getOperadoraFilter } from '../../utils/permissionUtils.js';
import AuditService from '../../services/AuditService.js';
import HistoricoTrocaMedicamento from '../models/HistoricoTrocaMedicamento.js';
import Medicamentos from '../models/Medicamentos.js';
import MotivosFalhaContato from '../models/MotivoFalhaContato.js';
import DashboardSnapshot from '../models/DashboardSnapshot.js';

const OFFSET_BRASILIA_MS = 3 * 60 * 60 * 1000;

// ============================================================================
// Se data_inicio/data_fim cobrirem EXATAMENTE um mês fechado de calendário
// (dia 1 até o último dia do mesmo mês/ano), devolve { ano, mes }. Caso
// contrário (período parcial, múltiplos meses, etc.) devolve null — esse
// período nunca é elegível a snapshot, sempre calcula ao vivo.
// ============================================================================
function identificarMesCompleto(data_inicio, data_fim) {
  if (!data_inicio || !data_fim) return null;
  const partesIni = String(data_inicio).split('-').map(Number);
  const partesFim = String(data_fim).split('-').map(Number);
  if (partesIni.length !== 3 || partesFim.length !== 3) return null;

  const [anoIni, mesIni, diaIni] = partesIni;
  const [anoFim, mesFim, diaFim] = partesFim;
  if (!anoIni || !mesIni || !diaIni || !anoFim || !mesFim || !diaFim) return null;
  if (anoIni !== anoFim || mesIni !== mesFim || diaIni !== 1) return null;

  const ultimoDiaDoMes = new Date(anoFim, mesFim, 0).getDate();
  if (diaFim !== ultimoDiaDoMes) return null;

  return { ano: anoIni, mes: mesIni };
}

// "Hoje" no horário de Brasília (-03:00), só a parte de data.
function hojeBrasil() {
  const agoraUtc = new Date();
  const agoraBrasil = new Date(agoraUtc.getTime() - OFFSET_BRASILIA_MS);
  return {
    ano: agoraBrasil.getUTCFullYear(),
    mes: agoraBrasil.getUTCMonth() + 1,
    dia: agoraBrasil.getUTCDate(),
  };
}

// Um mês só é elegível a fechamento/snapshot se ele já terminou de verdade
// (é estritamente anterior ao mês/ano atual em Brasília). O mês em curso
// nunca usa snapshot, sempre calcula ao vivo — isso é esperado e correto.
function mesJaTerminou(ano, mes) {
  const hoje = hojeBrasil();
  if (ano < hoje.ano) return true;
  if (ano === hoje.ano && mes < hoje.mes) return true;
  return false;
}

// Mesmo cálculo usado pelo job automático (DashboardCloseService) — o mês
// imediatamente anterior ao atual (Brasília).
function mesAnterior(ano, mes) {
  if (mes === 1) return { ano: ano - 1, mes: 12 };
  return { ano, mes: mes - 1 };
}

function primeiroEUltimoDia(ano, mes) {
  const data_inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const data_fim = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
  return { data_inicio, data_fim };
}

async function calcularPayloadDashboard({ permission, data_inicio, data_fim }) {
    let includePacienteWhere = { ...permission.whereClause };
    let dateFilterEfetivado = {};
    let dateFilterCreatedAt = {};
    let dateFilterTroca = {};
    let start = null;
    let end = null;

    if (data_inicio && data_fim) {
      // CORREÇÃO DE FUSO HORÁRIO APLICADA AQUI (-03:00)
      start = new Date(`${data_inicio}T00:00:00.000-03:00`);
      end = new Date(`${data_fim}T23:59:59.999-03:00`);

      dateFilterEfetivado.data_telemonitoramento_efetivado = { [Op.between]: [start, end] };
      dateFilterCreatedAt.createdAt = { [Op.between]: [start, end] };
      dateFilterTroca.data_troca = { [Op.between]: [data_inicio, data_fim] };

      includePacienteWhere[Op.or] = [
        { createdAt: { [Op.between]: [start, end] } },
        { status_termo: 'Aceito', termo_data_aceite: { [Op.between]: [start, end] } }
      ];
    }

    // ====================================================================
    // REGRA DE NEGÓCIO: PACIENTES SINCRONIZADOS (ONBOARDING COM COALESCE)
    // ====================================================================
    const todosEventos = await EventosPaciente.findAll({
      attributes: ['paciente_id'],
      group: ['paciente_id'],
      raw: true
    });

    const pacientesEntrantesNoPeriodo = new Set(todosEventos.map(e => e.paciente_id));

    // DADOS GERAIS DE PACIENTES
    const pacientes = await Pacientes.findAll({
      attributes: ['id', 'nome', 'sobrenome', 'status_termo', 'is_active', 'createdAt', 'termo_data_aceite'],
      include: [{ model: Operadora, as: 'operadoras', attributes: ['nome'] }],
      where: { ...permission.whereClause }
    });

    const pacientesCadastro = pacientes.filter(p => pacientesEntrantesNoPeriodo.has(p.id));

    const pacientesTermos = pacientes.filter(p => {
      if (!start || !end) return true;
      if (p.status_termo === 'Aceito') {
        if (!p.termo_data_aceite) return false;
        return p.termo_data_aceite >= start && p.termo_data_aceite <= end;
      }
      return p.createdAt >= start && p.createdAt <= end;
    });

    const allActivePatientIds = pacientes.filter(p => p.is_active).map(p => p.id);
    const safeActiveIds = allActivePatientIds.length > 0 ? allActivePatientIds : [-1];

    const elegiveisIds = pacientesTermos.filter(p => p.is_active && p.status_termo === 'Aceito').map(p => p.id);
    const safeElegiveisIds = elegiveisIds.length > 0 ? elegiveisIds : [-1];

    const pacientesAtivosTermo = pacientesTermos.filter(p => p.is_active);
    const basePatientsListActive = pacientesAtivosTermo.map(p => ({
      paciente_id: p.id,
      nome_paciente: `${p.nome} ${p.sobrenome || ''}`.trim(),
      operadora: p.operadoras?.nome || 'N/A',
      data_registro: p.createdAt ? p.createdAt.toLocaleDateString('pt-BR') : 'N/A'
    }));

    const basePatientsListElegiveis = basePatientsListActive.filter(p => elegiveisIds.includes(p.paciente_id));

    // ==========================================
    // STATUS DOS TERMOS E CONTAGEM DE ELEGÍVEIS
    // ==========================================
    let termosCount = { Aceito: 0, Recusado: 0, Pendente: 0 };
    let elegiveisCount = 0;
    let termosReport = [];

    pacientesAtivosTermo.forEach(p => {
      const statusTermo = p.status_termo || 'Pendente';
      if (termosCount[statusTermo] !== undefined) termosCount[statusTermo]++;

      if (statusTermo === 'Aceito') {
        elegiveisCount++;
      }

      termosReport.push({
        paciente_id: p.id,
        nome_paciente: `${p.nome} ${p.sobrenome || ''}`.trim(),
        operadora: p.operadoras?.nome || 'N/A',
        data_registro: p.createdAt ? p.createdAt.toLocaleDateString('pt-BR') : 'N/A',
        status_termo: statusTermo
      });
    });

    // ==========================================
    // INDICADOR: PACIENTES SINCRONIZADOS
    // ==========================================
    let ativosCount = 0;
    const basePatientsListSincronizados = [];

    pacientesCadastro.forEach(p => {
      if (p.is_active) {
        ativosCount++;
        basePatientsListSincronizados.push({
          paciente_id: p.id,
          nome_paciente: `${p.nome} ${p.sobrenome || ''}`.trim(),
          operadora: p.operadoras?.nome || 'N/A',
          data_registro: p.createdAt ? p.createdAt.toLocaleDateString('pt-BR') : 'N/A'
        });
      }
    });

    // ==========================================
    // PACIENTES MONITORADOS
    // ==========================================
    const monitoramentos = await MonitoramentoMedicamento.findAll({
      attributes: ['paciente_id', 'data_telemonitoramento_efetivado'],
      where: {
        paciente_id: { [Op.in]: safeElegiveisIds },
        status: 'CONCLUIDO',
        contato_efetivo: true,
        ...dateFilterEfetivado
      }
    });

    let monitoradosMap = new Map();
    monitoramentos.forEach(mon => {
      if (!monitoradosMap.has(mon.paciente_id)) {
        monitoradosMap.set(mon.paciente_id, mon.data_telemonitoramento_efetivado ? mon.data_telemonitoramento_efetivado.toLocaleDateString('pt-BR') : 'N/A');
      }
    });

    const totalMonitorados = monitoradosMap.size;
    const naoMonitorados = basePatientsListElegiveis.length - totalMonitorados;

    let monitoradosReport = [];
    basePatientsListElegiveis.forEach(bp => {
      const isMonitored = monitoradosMap.has(bp.paciente_id);
      monitoradosReport.push({
        ...bp,
        foi_monitorado: isMonitored ? 'Sim' : 'Não',
        ultimo_monitoramento: isMonitored ? monitoradosMap.get(bp.paciente_id) : 'N/A'
      });
    });

    // PONTUAÇÃO DE ADERÊNCIA / ADESÃO SCORE
    const avaliacoes = await PatientEvaluation.findAll({
      include: [{ model: EvaluationTemplate, as: 'template', attributes: ['title'] }],
      where: { paciente_id: { [Op.in]: safeElegiveisIds }, total_score: { [Op.not]: null }, ...dateFilterCreatedAt },
      order: [['createdAt', 'DESC']]
    });

    let categoriasMap = {};
    let adesaoAlta = 0, adesaoMedia = 0, adesaoBaixa = 0;
    let avaliacoesData = {};
    let pacientesAvaliados = new Set();

    avaliacoes.forEach(av => {
      const categoria = av.template?.title || 'Sem Categoria';
      const score = Number(av.total_score);

      if (!categoriasMap[categoria]) categoriasMap[categoria] = { total: 0, count: 0 };
      categoriasMap[categoria].total += score;
      categoriasMap[categoria].count += 1;

      let nivel = '';
      if (score >= 0 && score <= 9) { nivel = 'Alta Adesão'; }
      else if (score >= 10 && score <= 12) { nivel = 'Média Adesão'; }
      else { nivel = 'Baixa Adesão'; }

      if (!avaliacoesData[av.paciente_id]) {
        avaliacoesData[av.paciente_id] = [];
        if (!pacientesAvaliados.has(av.paciente_id)) {
          pacientesAvaliados.add(av.paciente_id);
          if (nivel === 'Alta Adesão') adesaoAlta++;
          else if (nivel === 'Média Adesão') adesaoMedia++;
          else adesaoBaixa++;
        }
      }

      avaliacoesData[av.paciente_id].push({
        categoria: categoria, score_total: score, nivel_classificado: nivel,
        data_avaliacao: av.createdAt ? av.createdAt.toLocaleDateString('pt-BR') : 'N/A'
      });
    });

    let semAvaliacao = elegiveisCount - pacientesAvaliados.size;
    if (semAvaliacao < 0) semAvaliacao = 0;

    const aderenciaCategoriaChart = Object.keys(categoriasMap).map(key => ({
      name: key, value: Number((categoriasMap[key].total / categoriasMap[key].count).toFixed(2))
    }));

    let adesaoScoreReport = [];
    let categoriaReport = [];

    basePatientsListActive.forEach(bp => {
      if (avaliacoesData[bp.paciente_id]) {
        avaliacoesData[bp.paciente_id].forEach(av => {
          adesaoScoreReport.push({ ...bp, score_total: av.score_total, nivel_classificado: av.nivel_classificado, data_avaliacao: av.data_avaliacao });
          categoriaReport.push({ ...bp, categoria: av.categoria, score: av.score_total, data_avaliacao: av.data_avaliacao });
        });
      } else {
        adesaoScoreReport.push({ ...bp, score_total: 'N/A', nivel_classificado: 'Sem Avaliação', data_avaliacao: 'N/A' });
        categoriaReport.push({ ...bp, categoria: 'Sem Avaliação', score: 'N/A', data_avaliacao: 'N/A' });
      }
    });

    // ==========================================
    // NÍVEL DE ADERÊNCIA
    // ==========================================
    const monitoramentosAderencia = await MonitoramentoMedicamento.findAll({
      attributes: ['paciente_id', 'nivel_adesao', 'data_telemonitoramento_efetivado'],
      where: {
        paciente_id: { [Op.in]: safeElegiveisIds },
        nivel_adesao: { [Op.not]: null },
        status: 'CONCLUIDO',
        ...dateFilterEfetivado
      },
      order: [['data_telemonitoramento_efetivado', 'DESC']]
    });

    let aderenciaOpcoesCount = { COMPLETAMENTE: 0, PARCIALMENTE: 0, NAO_ADERE: 0 };
    let aderenciaMapData = {};
    let pacientesComAderencia = new Set();

    monitoramentosAderencia.forEach(mon => {
      const nivel = mon.nivel_adesao;
      if (!aderenciaMapData[mon.paciente_id]) {
        aderenciaMapData[mon.paciente_id] = [];
        if (!pacientesComAderencia.has(mon.paciente_id)) {
          pacientesComAderencia.add(mon.paciente_id);
          if (aderenciaOpcoesCount[nivel] !== undefined) aderenciaOpcoesCount[nivel]++;
        }
      }
      aderenciaMapData[mon.paciente_id].push({
        nivel_adesao_informado: nivel ? nivel.replace('_', ' ') : 'Não Informado',
        data_monitoramento: mon.data_telemonitoramento_efetivado ? mon.data_telemonitoramento_efetivado.toLocaleDateString('pt-BR') : 'N/A'
      });
    });

    let aderenciaPendente = totalMonitorados - pacientesComAderencia.size;
    if (aderenciaPendente < 0) aderenciaPendente = 0;

    let aderenciaOpcoesReport = [];
    basePatientsListElegiveis.forEach(bp => {
      if (aderenciaMapData[bp.paciente_id]) {
        aderenciaMapData[bp.paciente_id].forEach(ad => aderenciaOpcoesReport.push({ ...bp, ...ad }));
      } else {
        aderenciaOpcoesReport.push({ ...bp, nivel_adesao_informado: 'Sem Registro', data_monitoramento: 'N/A' });
      }
    });

    // ==========================================
    // FICHAS RAM
    // ==========================================
    // Usa a mesma população da Aderência (safeElegiveisIds), não safeActiveIds —
    // as duas contagens vêm do mesmo universo de "contatos efetivos concluídos
    // no período" e o total de CPFs únicos de um bate com o do outro.
    let ramWhere = {
      paciente_id: { [Op.in]: safeElegiveisIds },
      status: 'CONCLUIDO',
      contato_efetivo: true
    };

    if (start && end) {
      ramWhere[Op.or] = [
        { data_telemonitoramento_efetivado: { [Op.between]: [start, end] } },
        { '$reacoesAdversas.monitoramento_reacoes_adversas.created_at$': { [Op.between]: [start, end] } }
      ];
    }

    const monitoramentosRam = await MonitoramentoMedicamento.findAll({
      include: [{
        model: ReacaoAdversa, as: 'reacoesAdversas', attributes: ['name'], required: false,
        through: { attributes: ['createdAt', 'created_at'] }
      }],
      where: ramWhere,
      subQuery: false
    });

    let ramChartMap = {};
    let ramPatientData = {};
    // Set, não contador simples — igual ramChartMap já faz pras outras reações,
    // pra "Nenhuma Reação" contar pacientes distintos, não visitas repetidas
    // do mesmo paciente dentro do período.
    let pacientesSemReacao = new Set();

    monitoramentosRam.forEach(mon => {
      if (!ramPatientData[mon.paciente_id]) {
        ramPatientData[mon.paciente_id] = [];
      }

      let teveReacaoValidaNoPeriodo = false;

      if (mon.is_reacao && mon.reacoesAdversas && mon.reacoesAdversas.length > 0) {
        mon.reacoesAdversas.forEach(reacaoObj => {
          const dataCriacaoRamStr = reacaoObj.monitoramento_reacoes_adversas?.createdAt || reacaoObj.monitoramento_reacoes_adversas?.created_at;

          if (start && end && dataCriacaoRamStr) {
            const dataReacao = new Date(dataCriacaoRamStr);
            if (dataReacao < start || dataReacao > end) {
              return;
            }
          }

          teveReacaoValidaNoPeriodo = true;
          const reacao = reacaoObj.name;

          if (!ramChartMap[reacao]) ramChartMap[reacao] = new Set();
          ramChartMap[reacao].add(mon.paciente_id);

          ramPatientData[mon.paciente_id].push({
            reacao_adversa: reacao,
            data_registro: dataCriacaoRamStr ? new Date(dataCriacaoRamStr).toLocaleDateString('pt-BR') : 'N/A'
          });
        });
      }

      if (!teveReacaoValidaNoPeriodo) {
        let monitoramentoNoPeriodo = true;

        if (start && end && mon.data_telemonitoramento_efetivado) {
          const dataMonitoramento = new Date(mon.data_telemonitoramento_efetivado);
          if (dataMonitoramento < start || dataMonitoramento > end) {
            monitoramentoNoPeriodo = false;
          }
        }

        if (monitoramentoNoPeriodo) {
          pacientesSemReacao.add(mon.paciente_id);
          ramPatientData[mon.paciente_id].push({
            reacao_adversa: 'Nenhuma Reação',
            data_registro: mon.data_telemonitoramento_efetivado ? new Date(mon.data_telemonitoramento_efetivado).toLocaleDateString('pt-BR') : 'N/A'
          });
        }
      }
    });

    const fichaRamChart = Object.keys(ramChartMap).map(key => ({
      name: key, value: ramChartMap[key].size
    })).sort((a, b) => b.value - a.value);

    if (pacientesSemReacao.size > 0) {
      fichaRamChart.push({ name: 'Nenhuma Reação', value: pacientesSemReacao.size });
    }

    // ==========================================
    // GERAÇÃO DO RELATÓRIO DA PLANILHA (FICHAS RAM)
    // ==========================================
    const dictPacientes = {};
    pacientes.forEach(p => {
      dictPacientes[p.id] = {
        paciente_id: p.id,
        nome_paciente: `${p.nome} ${p.sobrenome || ''}`.trim(),
        operadora: p.operadoras?.nome || 'N/A',
        data_registro: p.createdAt ? p.createdAt.toLocaleDateString('pt-BR') : 'N/A'
      };
    });

    let ramReport = [];

    Object.keys(ramPatientData).forEach(pacienteIdStr => {
      const pId = Number(pacienteIdStr);
      const dadosPaciente = dictPacientes[pId];

      if (dadosPaciente && ramPatientData[pId].length > 0) {
        ramPatientData[pId].forEach(ram => {
          ramReport.push({ ...dadosPaciente, ...ram });
        });
      }
    });

    // NPS
    const npsResponses = await NpsResponse.findAll({
      where: { paciente_id: { [Op.in]: safeActiveIds }, ...dateFilterCreatedAt },
      order: [['createdAt', 'DESC']]
    });

    let npsChart = [];
    let npsPatientData = {};
    npsResponses.forEach(nps => {
      npsChart.push({ nota: nps.nota, paciente_id: nps.paciente_id });
      if (!npsPatientData[nps.paciente_id]) npsPatientData[nps.paciente_id] = [];
      npsPatientData[nps.paciente_id].push({
        nota: nps.nota, data_nps: nps.createdAt ? nps.createdAt.toLocaleDateString('pt-BR') : 'N/A'
      });
    });

    let npsReport = [];
    basePatientsListActive.forEach(bp => {
      if (npsPatientData[bp.paciente_id]) {
        npsPatientData[bp.paciente_id].forEach(nps => npsReport.push({ ...bp, ...nps }));
      } else {
        npsReport.push({ ...bp, nota: 'Sem Resposta', data_nps: 'N/A' });
      }
    });

    // HISTÓRICO TROCAS
    const trocasMedicamentos = await HistoricoTrocaMedicamento.findAll({
      include: [
        { model: Medicamentos, as: 'medicamentoAntigo', attributes: ['nome'] },
        { model: Medicamentos, as: 'medicamentoNovo', attributes: ['nome'] }
      ],
      where: { paciente_id: { [Op.in]: safeActiveIds }, ...dateFilterTroca },
      order: [['data_troca', 'DESC']]
    });

    let trocasPatientData = {};
    trocasMedicamentos.forEach(troca => {
      if (!trocasPatientData[troca.paciente_id]) trocasPatientData[troca.paciente_id] = [];
      trocasPatientData[troca.paciente_id].push({
        medicamento_antigo: troca.medicamentoAntigo?.nome || 'Não informado',
        medicamento_novo: troca.medicamentoNovo?.nome || 'Não informado',
        data_troca: troca.data_troca ? new Date(troca.data_troca + 'T12:00:00Z').toLocaleDateString('pt-BR') : 'N/A'
      });
    });

    let historicoTrocasReport = [];
    basePatientsListActive.forEach(bp => {
      if (trocasPatientData[bp.paciente_id]) {
        trocasPatientData[bp.paciente_id].forEach(troca => historicoTrocasReport.push({ ...bp, ...troca }));
      } else {
        historicoTrocasReport.push({ ...bp, medicamento_antigo: 'N/A', medicamento_novo: 'Sem Trocas Registradas', data_troca: 'N/A' });
      }
    });

    // ==========================================
    // PROBLEMAS DE CONTATO (FALHAS)
    // ==========================================
    let contatoWhere = {
      paciente_id: { [Op.in]: safeActiveIds },
      contato_efetivo: false
    };

    if (start && end) {
      contatoWhere.createdAt = { [Op.between]: [start, end] };
    }

    const monitoramentosFalha = await MonitoramentoMedicamento.findAll({
      include: [{
        model: MotivosFalhaContato,
        as: 'motivoFalhaContato',
        attributes: ['descricao'],
        required: false
      }],
      where: contatoWhere,
      subQuery: false
    });

    let problemasChartMap = {};
    let problemasPatientData = {};

    monitoramentosFalha.forEach(mon => {
      if (!problemasPatientData[mon.paciente_id]) {
        problemasPatientData[mon.paciente_id] = [];
      }

      const motivoDescricao = mon.motivoFalhaContato?.descricao || 'Motivo Não Informado';

      if (!problemasChartMap[motivoDescricao]) problemasChartMap[motivoDescricao] = new Set();
      problemasChartMap[motivoDescricao].add(mon.paciente_id);

      problemasPatientData[mon.paciente_id].push({
        motivo_falha: motivoDescricao,
        data_registro: mon.createdAt ? new Date(mon.createdAt).toLocaleDateString('pt-BR') : 'N/A'
      });
    });

    const problemasContatoChart = Object.keys(problemasChartMap).map(key => ({
      name: key, value: problemasChartMap[key].size
    })).sort((a, b) => b.value - a.value);

    let problemasContatoReport = [];

    Object.keys(problemasPatientData).forEach(pacienteIdStr => {
      const pId = Number(pacienteIdStr);
      const dadosPaciente = dictPacientes[pId];

      if (dadosPaciente && problemasPatientData[pId].length > 0) {
        problemasPatientData[pId].forEach(problema => {
          problemasContatoReport.push({ ...dadosPaciente, ...problema });
        });
      }
    });

    return {
      pacientesSincronizados: {
        total: ativosCount,
        chart: [{ name: 'Ativos', value: ativosCount }],
        report: basePatientsListSincronizados
      },
      pacientesMonitorados: { total: totalMonitorados, chart: [{ name: 'Monitorados', value: totalMonitorados }, { name: 'Não Monitorados', value: naoMonitorados < 0 ? 0 : naoMonitorados }], report: monitoradosReport },
      termos: { chart: [{ name: 'Aceito', value: termosCount.Aceito }, { name: 'Pendente', value: termosCount.Pendente }, { name: 'Recusado', value: termosCount.Recusado }], report: termosReport },
      aderenciaCategoria: { chart: aderenciaCategoriaChart, report: categoriaReport },
      adesaoScore: { chart: [{ name: 'Alta Adesão', value: adesaoAlta }, { name: 'Média Adesão', value: adesaoMedia }, { name: 'Baixa Adesão', value: adesaoBaixa }, { name: 'Sem Avaliação', value: semAvaliacao }], report: adesaoScoreReport },
      aderenciaOpcoes: { chart: [{ name: 'Completamente', value: aderenciaOpcoesCount.COMPLETAMENTE }, { name: 'Parcialmente', value: aderenciaOpcoesCount.PARCIALMENTE }, { name: 'Não Adere', value: aderenciaOpcoesCount.NAO_ADERE }, { name: 'Sem Registro', value: aderenciaPendente }], report: aderenciaOpcoesReport },
      fichaRam: { chart: fichaRamChart, report: ramReport },
      nps: { chart: npsChart, report: npsReport },
      historicoTrocas: { table: historicoTrocasReport, report: historicoTrocasReport },
      problemasContato: { chart: problemasContatoChart, report: problemasContatoReport },
    };
}

async function fecharMesInterno({ ano, mes, operadoraId = null, userId = null }) {
    const { data_inicio, data_fim } = primeiroEUltimoDia(ano, mes);

    const permission = operadoraId
      ? { authorized: true, whereClause: { operadora_id: operadoraId } }
      : { authorized: true, whereClause: {} };

    const payload = await calcularPayloadDashboard({ permission, data_inicio, data_fim });

    // Não usamos DashboardSnapshot.upsert() aqui de propósito: por padrão o
    // upsert do Sequelize resolve conflito pela PRIMARY KEY (id), não pela
    // nossa chave de negócio (ano, mes, operadora_id) — então, ao tentar
    // FECHAR DE NOVO um mês que já tem snapshot (o caso normal de recongelar
    // depois de corrigir um dado), o INSERT esbarra na constraint única e
    // quebra, em vez de atualizar. Aqui resolvemos manualmente pela chave real.
    const existente = await DashboardSnapshot.findOne({
      where: { ano, mes, operadora_id: operadoraId || null }
    });

    if (existente) {
      await existente.update({
        dados: payload,
        fechado_por: userId,
        fechado_em: new Date(),
      });
    } else {
      await DashboardSnapshot.create({
        ano,
        mes,
        operadora_id: operadoraId || null,
        dados: payload,
        fechado_por: userId,
        fechado_em: new Date(),
      });
    }

    return payload;
}

class DashboardController {

  async index(req, res) {
    try {
      const { operadora_id, data_inicio, data_fim } = req.query;

      const permission = await getOperadoraFilter(req.userId, operadora_id);

      const emptyDashboard = {
        termos: { chart: [], report: [] },
        aderenciaCategoria: { chart: [], report: [] },
        adesaoScore: { chart: [], report: [] },
        aderenciaOpcoes: { chart: [], report: [] },
        fichaRam: { chart: [], report: [] },
        pacientesSincronizados: { chart: [], report: [], total: 0 },
        pacientesMonitorados: { chart: [], report: [], total: 0 },
        nps: { chart: [], report: [] },
        historicoTrocas: { table: [], report: [] }
      };

      if (!permission.authorized) {
        if (permission.emptyResult) return res.json(emptyDashboard);
        return res.status(permission.status).json({ error: permission.error });
      }

      const periodoOperadoraId = operadora_id || (permission.whereClause && permission.whereClause.operadora_id) || null;

      // ================================================================
      // NOVO: se o período pedido é um mês fechado de calendário E esse
      // mês já terminou, tenta servir o snapshot congelado em vez de
      // recalcular em cima de dado vivo. Isso é o que garante que um mês
      // já apresentado NUNCA mais muda sozinho.
      // ================================================================
      const mesCompleto = identificarMesCompleto(data_inicio, data_fim);

      if (mesCompleto && mesJaTerminou(mesCompleto.ano, mesCompleto.mes)) {
        const snapshot = await DashboardSnapshot.findOne({
          where: {
            ano: mesCompleto.ano,
            mes: mesCompleto.mes,
            operadora_id: periodoOperadoraId,
          }
        });

        if (snapshot) {
          return res.json({ ...snapshot.dados, fechado: true, fechado_em: snapshot.fechado_em });
        }
        // Mês já terminou mas ainda não foi fechado (ex: job automático
        // ainda não rodou, ou mês antigo de antes dessa mudança existir) —
        // cai no cálculo ao vivo abaixo, normalmente.
      }

      const payload = await calcularPayloadDashboard({ permission, data_inicio, data_fim });

      let nomeOperadoraLog = 'Cic Oncologia (Todas)';
      if (periodoOperadoraId) {
        const operadoraBusca = await Operadora.findOne({ where: { id: periodoOperadoraId }, attributes: ['nome'] });
        if (operadoraBusca) nomeOperadoraLog = operadoraBusca.nome;
      }

      await AuditService.log(
        req.userId, 'Emissão', 'Dashboard', null,
        `Gerou relatório do dashboard para o período ${data_inicio || 'Início'} a ${data_fim || 'Fim'} - Operadora: ${nomeOperadoraLog}`
      );

      return res.json({ ...payload, fechado: false });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao gerar dados do dashboard', details: error.message });
    }
  }

  async fecharMes(req, res) {
    try {
      const { ano, mes, operadora_id } = req.body;
      if (!ano || !mes) {
        return res.status(400).json({ error: 'Informe ano e mes.' });
      }

      const operadoraId = operadora_id ? Number(operadora_id) : null;
      await fecharMesInterno({ ano: Number(ano), mes: Number(mes), operadoraId, userId: req.userId });

      await AuditService.log(
        req.userId, 'Edição', 'Dashboard', null,
        `Fechou (congelou) manualmente o mês ${mes}/${ano}${operadoraId ? ` - operadora ${operadoraId}` : ' - todas operadoras'}.`
      );

      return res.json({ message: `Mês ${mes}/${ano} fechado com sucesso.` });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao fechar o mês', details: error.message });
    }
  }

  // Diz se o mês anterior (ao atual, em Brasília) já foi fechado — usado
  // pelo botão do Dashboard pra decidir se fica habilitado ou só informativo.
  // Usa a visão consolidada (todas as operadoras) como referência de "já foi
  // fechado" — é a mesma que o job automático sempre fecha por último.
  async statusFechamentoMesAnterior(req, res) {
    try {
      const hoje = hojeBrasil();
      const alvo = mesAnterior(hoje.ano, hoje.mes);

      const snapshot = await DashboardSnapshot.findOne({
        where: { ano: alvo.ano, mes: alvo.mes, operadora_id: null }
      });

      return res.json({
        ano: alvo.ano,
        mes: alvo.mes,
        fechado: !!snapshot,
        fechado_em: snapshot ? snapshot.fechado_em : null
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao verificar status do fechamento.' });
    }
  }

  // Fecha especificamente o mês anterior (nunca um mês arbitrário) — é o
  // que o botão do Dashboard chama. Fecha a visão consolidada E cada
  // operadora individualmente, igual o job automático do dia 3 já faz,
  // pulando o que já estiver fechado (não sobrescreve à toa). Se a visão
  // consolidada já estiver fechada, recusa de saída — o botão já vem
  // desabilitado nesse caso, mas valida de novo aqui pra não sobrescrever
  // sem querer se alguém chamar a rota diretamente.
  async fecharMesAnterior(req, res) {
    try {
      const hoje = hojeBrasil();
      const alvo = mesAnterior(hoje.ano, hoje.mes);

      const consolidadoJaFechado = await DashboardSnapshot.findOne({
        where: { ano: alvo.ano, mes: alvo.mes, operadora_id: null }
      });
      if (consolidadoJaFechado) {
        return res.status(400).json({ error: `O mês ${alvo.mes}/${alvo.ano} já foi fechado.` });
      }

      const operadoras = await Operadora.findAll({ attributes: ['id'], raw: true });
      const alvos = [null, ...operadoras.map(o => o.id)];

      for (const operadoraId of alvos) {
        const jaExiste = await DashboardSnapshot.findOne({
          where: { ano: alvo.ano, mes: alvo.mes, operadora_id: operadoraId }
        });
        if (jaExiste) continue;
        await fecharMesInterno({ ano: alvo.ano, mes: alvo.mes, operadoraId, userId: req.userId });
      }

      await AuditService.log(
        req.userId, 'Edição', 'Dashboard', null,
        `Fechou (congelou) manualmente o mês anterior ${alvo.mes}/${alvo.ano} (consolidado + todas as operadoras), antes do fechamento automático do dia 3.`
      );

      return res.json({ message: `Mês ${alvo.mes}/${alvo.ano} fechado com sucesso.`, ano: alvo.ano, mes: alvo.mes });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao fechar o mês anterior', details: error.message });
    }
  }
}

export default new DashboardController();
export { fecharMesInterno };
