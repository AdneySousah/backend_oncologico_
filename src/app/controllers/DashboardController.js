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

class DashboardController {
  async index(req, res) {
    try {
      const { operadora_id, data_inicio, data_fim } = req.query;

      // 1. APLICAÇÃO DO FILTRO DE OPERADORA
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
      // 1. Busca os pacientes que tiveram qualquer evento na janela de tempo informada
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
      let ramWhere = {
        paciente_id: { [Op.in]: safeActiveIds },
        status: 'CONCLUIDO',
        contato_efetivo: true
      };

      // Se houver filtro de data, busca por monitoramentos do período OU reações do período
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
      let monitoramentosSemReacao = 0;

      monitoramentosRam.forEach(mon => {
        if (!ramPatientData[mon.paciente_id]) {
          ramPatientData[mon.paciente_id] = [];
        }

        let teveReacaoValidaNoPeriodo = false;

        if (mon.is_reacao && mon.reacoesAdversas && mon.reacoesAdversas.length > 0) {
          mon.reacoesAdversas.forEach(reacaoObj => {
            const dataCriacaoRamStr = reacaoObj.monitoramento_reacoes_adversas?.createdAt || reacaoObj.monitoramento_reacoes_adversas?.created_at;

            // Verifica se a data DA REAÇÃO está dentro do período filtrado
            if (start && end && dataCriacaoRamStr) {
              const dataReacao = new Date(dataCriacaoRamStr);
              if (dataReacao < start || dataReacao > end) {
                return; // Pula esta reação específica, pois é de outro mês
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

        // Se a pessoa não teve reações no mês filtrado (ou todas foram puladas por serem de outro mês)
        // Vamos verificar se o monitoramento em si ocorreu neste mês para contabilizar "Nenhuma Reação"
        if (!teveReacaoValidaNoPeriodo) {
          let monitoramentoNoPeriodo = true;

          if (start && end && mon.data_telemonitoramento_efetivado) {
            const dataMonitoramento = new Date(mon.data_telemonitoramento_efetivado);
            if (dataMonitoramento < start || dataMonitoramento > end) {
              monitoramentoNoPeriodo = false; // Monitoramento foi de outro mês
            }
          }

          if (monitoramentoNoPeriodo) {
            monitoramentosSemReacao++;
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

      if (monitoramentosSemReacao > 0) {
        fichaRamChart.push({ name: 'Nenhuma Reação', value: monitoramentosSemReacao });
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

      let nomeOperadoraLog = 'Cic Oncologia (Todas)';
      const idParaBuscar = operadora_id || (permission.whereClause && permission.whereClause.operadora_id);
      if (idParaBuscar) {
        const operadoraBusca = await Operadora.findOne({ where: { id: idParaBuscar }, attributes: ['nome'] });
        if (operadoraBusca) nomeOperadoraLog = operadoraBusca.nome;
      }

      await AuditService.log(req.userId, 'Emissão', 'Dashboard', null, `Gerou relatório do dashboard para o período ${data_inicio || 'Início'} a ${data_fim || 'Fim'} - Operadora: ${nomeOperadoraLog}`);

      return res.json({
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
        historicoTrocas: { table: historicoTrocasReport, report: historicoTrocasReport }
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao gerar dados do dashboard', details: error.message });
    }
  }
}

export default new DashboardController();