import { Op, Sequelize } from 'sequelize';
import Pacientes from '../models/Pacientes.js';
import PatientEvaluation from '../models/PatientEvaluation.js';
import EvaluationTemplate from '../models/EvaluationTemplate.js';
import MonitoramentoMedicamento from '../models/MonitoramentoMedicamento.js';
import ReacaoAdversa from '../models/ReacaoAdversa.js';
import Operadora from '../models/Operadora.js';
import NpsResponse from '../models/NpsResponse.js';
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
        totalPacientes: { chart: [], report: [], total: 0 },
        pacientesMonitorados: { chart: [], report: [], total: 0 },
        pacientesElegiveis: { chart: [], report: [], total: 0 },
        nps: { chart: [], report: [] },
        historicoTrocas: { table: [], report: [] }
      };

      if (!permission.authorized) {
        if (permission.emptyResult) return res.json(emptyDashboard);
        return res.status(permission.status).json({ error: permission.error });
      }

      const includePacienteWhere = permission.whereClause;

      // 2. CRIANDO O FILTRO DE DATA
      let dateFilter = {};
      let dateFilterCreatedAt = {};
      if (data_inicio && data_fim) {
        const start = new Date(`${data_inicio}T00:00:00.000Z`);
        const end = new Date(`${data_fim}T23:59:59.999Z`);
        dateFilter.updated_at = { [Op.between]: [start, end] };
        dateFilterCreatedAt.createdAt = { [Op.between]: [start, end] };
      }

      // =========================================================
      // DADOS GERAIS DE PACIENTES (Lista Base para todos os relatórios)
      // =========================================================
      const pacientes = await Pacientes.findAll({
        attributes: ['id', 'nome', 'sobrenome', 'status_termo', 'is_active', 'createdAt'],
        include: [{ model: Operadora, as: 'operadoras', attributes: ['nome'] }],
        where: { ...includePacienteWhere, ...dateFilterCreatedAt }
      });

      // Lista base formatada que usaremos para fazer o "Left Join" nos relatórios
      const basePatientsList = pacientes.map(p => ({
        paciente_id: p.id,
        nome_paciente: `${p.nome} ${p.sobrenome || ''}`.trim(),
        operadora: p.operadoras?.nome || 'N/A',
        data_registro_paciente: p.createdAt ? p.createdAt.toLocaleDateString('pt-BR') : 'N/A'
      }));

      let termosCount = { Aceito: 0, Recusado: 0, Pendente: 0 };
      let ativosCount = 0, inativosCount = 0;
      let elegiveisCount = 0, naoElegiveisCount = 0;

      let termosReport = [];
      let totalPacientesReport = [];
      let elegiveisReport = [];

      pacientes.forEach(p => {
        const statusTermo = p.status_termo || 'Pendente';
        const isAtivo = p.is_active;
        const nomeOperadora = p.operadoras?.nome || 'N/A';
        const nomeCompleto = `${p.nome} ${p.sobrenome || ''}`.trim();

        if (termosCount[statusTermo] !== undefined) termosCount[statusTermo]++;
        if (statusTermo === 'Aceito') elegiveisCount++; else naoElegiveisCount++;
        if (isAtivo) ativosCount++; else inativosCount++;

        const baseReport = {
          paciente_id: p.id,
          nome_paciente: nomeCompleto,
          operadora: nomeOperadora,
          data_registro: p.createdAt ? p.createdAt.toLocaleDateString('pt-BR') : 'N/A'
        };

        termosReport.push({ ...baseReport, status_termo: statusTermo });
        totalPacientesReport.push({ ...baseReport, status_ativo: isAtivo ? 'Ativo' : 'Inativo' });
        
        // AGORA TODOS ENTRAM NO RELATÓRIO DE ELEGÍVEIS COM SIM/NÃO
        elegiveisReport.push({ 
          ...baseReport, 
          status_elegibilidade: statusTermo === 'Aceito' ? 'Sim (Termo Aceito)' : `Não (${statusTermo})` 
        });
      });

      // =========================================================
      // PACIENTES MONITORADOS (Ativos com >= 1 monitoramento)
      // =========================================================
      const monitoramentos = await MonitoramentoMedicamento.findAll({
        include: [{
          model: Pacientes, as: 'paciente',
          where: { ...includePacienteWhere, is_active: true },
          attributes: ['id']
        }],
        where: { ...dateFilter }
      });

      let monitoradosMap = new Map();
      monitoramentos.forEach(mon => {
        if (!monitoradosMap.has(mon.paciente_id)) {
          monitoradosMap.set(mon.paciente_id, mon.updatedAt ? mon.updatedAt.toLocaleDateString('pt-BR') : 'N/A');
        }
      });

      const totalMonitorados = monitoradosMap.size;
      const naoMonitorados = ativosCount - totalMonitorados;

      let monitoradosReport = [];
      // Mapeando contra TODOS os pacientes para ter Sim/Não
      basePatientsList.forEach(bp => {
        const isMonitored = monitoradosMap.has(bp.paciente_id);
        monitoradosReport.push({
          ...bp,
          foi_monitorado: isMonitored ? 'Sim' : 'Não',
          ultimo_monitoramento: isMonitored ? monitoradosMap.get(bp.paciente_id) : 'N/A'
        });
      });

      // =========================================================
      // 2. Pontuação de aderência por categoria (Template)
      // =========================================================
      const avaliacoes = await PatientEvaluation.findAll({
        include: [
          { model: Pacientes, as: 'paciente', where: includePacienteWhere, attributes: ['id'] },
          { model: EvaluationTemplate, as: 'template', attributes: ['title'] }
        ],
        where: { total_score: { [Op.not]: null }, ...dateFilterCreatedAt }
      });

      let categoriasMap = {};
      let adesaoAlta = 0, adesaoMedia = 0, adesaoBaixa = 0;
      
      let avaliacoesData = {}; // Agrupar avaliações por paciente

      avaliacoes.forEach(av => {
        const categoria = av.template?.title || 'Sem Categoria';
        const score = Number(av.total_score);

        if (!categoriasMap[categoria]) categoriasMap[categoria] = { total: 0, count: 0 };
        categoriasMap[categoria].total += score;
        categoriasMap[categoria].count += 1;

        let nivel = '';
        if (score >= 0 && score <= 9) { adesaoAlta++; nivel = 'Alta Adesão'; }
        else if (score >= 10 && score <= 12) { adesaoMedia++; nivel = 'Média Adesão'; }
        else { adesaoBaixa++; nivel = 'Baixa Adesão'; }

        if (!avaliacoesData[av.paciente_id]) avaliacoesData[av.paciente_id] = [];
        
        avaliacoesData[av.paciente_id].push({
          categoria: categoria,
          score_total: score,
          nivel_classificado: nivel,
          data_avaliacao: av.createdAt ? av.createdAt.toLocaleDateString('pt-BR') : 'N/A'
        });
      });

      const aderenciaCategoriaChart = Object.keys(categoriasMap).map(key => ({
        name: key,
        value: Number((categoriasMap[key].total / categoriasMap[key].count).toFixed(2))
      }));

      let adesaoScoreReport = [];
      let categoriaReport = [];

      basePatientsList.forEach(bp => {
        if (avaliacoesData[bp.paciente_id]) {
          avaliacoesData[bp.paciente_id].forEach(av => {
            adesaoScoreReport.push({ ...bp, score_total: av.score_total, nivel_classificado: av.nivel_classificado, data_avaliacao: av.data_avaliacao });
            categoriaReport.push({ ...bp, categoria: av.categoria, score: av.score_total, data_avaliacao: av.data_avaliacao });
          });
        } else {
          // Se não tem avaliação, exporta todos com status vazio/N/A
          adesaoScoreReport.push({ ...bp, score_total: 'N/A', nivel_classificado: 'Sem Avaliação', data_avaliacao: 'N/A' });
          categoriaReport.push({ ...bp, categoria: 'Sem Avaliação', score: 'N/A', data_avaliacao: 'N/A' });
        }
      });

      // =========================================================
      // 4. % Nível de Aderência (Opções do MonitoramentoMedicamento)
      // =========================================================
      const monitoramentosAderencia = await MonitoramentoMedicamento.findAll({
        include: [{ model: Pacientes, as: 'paciente', where: includePacienteWhere, attributes: ['id'] }],
        where: { nivel_adesao: { [Op.not]: null }, status: 'CONCLUIDO', ...dateFilter }
      });

      let aderenciaOpcoesCount = { COMPLETAMENTE: 0, PARCIALMENTE: 0, NAO_ADERE: 0 };
      let aderenciaMapData = {};

      monitoramentosAderencia.forEach(mon => {
        const nivel = mon.nivel_adesao;
        if (aderenciaOpcoesCount[nivel] !== undefined) aderenciaOpcoesCount[nivel]++;

        if (!aderenciaMapData[mon.paciente_id]) aderenciaMapData[mon.paciente_id] = [];
        aderenciaMapData[mon.paciente_id].push({
          nivel_adesao_informado: nivel ? nivel.replace('_', ' ') : 'Não Informado',
          data_monitoramento: mon.updatedAt ? mon.updatedAt.toLocaleDateString('pt-BR') : 'N/A'
        });
      });

      let aderenciaOpcoesReport = [];
      basePatientsList.forEach(bp => {
        if (aderenciaMapData[bp.paciente_id]) {
          aderenciaMapData[bp.paciente_id].forEach(ad => aderenciaOpcoesReport.push({ ...bp, ...ad }));
        } else {
          aderenciaOpcoesReport.push({ ...bp, nivel_adesao_informado: 'Sem Registro', data_monitoramento: 'N/A' });
        }
      });

      // =========================================================
      // 5. Quantidade de pacientes por Ficha RAM
      // =========================================================
      const monitoramentosRam = await MonitoramentoMedicamento.findAll({
        include: [
          { model: Pacientes, as: 'paciente', where: includePacienteWhere, attributes: ['id'] },
          { model: ReacaoAdversa, as: 'reacoesAdversas', attributes: ['name'], required: true }
        ],
        where: { is_reacao: true, ...dateFilter }
      });

      let ramChartMap = {};
      let ramPatientData = {};

      monitoramentosRam.forEach(mon => {
        if (mon.reacoesAdversas && mon.reacoesAdversas.length > 0) {
          mon.reacoesAdversas.forEach(reacaoObj => {
            const reacao = reacaoObj.name;
            if (!ramChartMap[reacao]) ramChartMap[reacao] = new Set();
            ramChartMap[reacao].add(mon.paciente_id);

            if (!ramPatientData[mon.paciente_id]) ramPatientData[mon.paciente_id] = [];
            ramPatientData[mon.paciente_id].push({
              reacao_adversa: reacao,
              data_registro_ram: mon.updatedAt ? mon.updatedAt.toLocaleDateString('pt-BR') : 'N/A'
            });
          });
        }
      });

      const fichaRamChart = Object.keys(ramChartMap).map(key => ({
        name: key, value: ramChartMap[key].size
      })).sort((a, b) => b.value - a.value).slice(0, 10);

      let ramReport = [];
      basePatientsList.forEach(bp => {
        if (ramPatientData[bp.paciente_id]) {
          ramPatientData[bp.paciente_id].forEach(ram => ramReport.push({ ...bp, ...ram }));
        } else {
          ramReport.push({ ...bp, reacao_adversa: 'Nenhuma Reação', data_registro_ram: 'N/A' });
        }
      });

      // =========================================================
      // 6. NPS - ÍNDICE DE SATISFAÇÃO
      // =========================================================
      const npsResponses = await NpsResponse.findAll({
        include: [{ model: Pacientes, as: 'paciente', where: includePacienteWhere, attributes: ['id'] }],
        where: { ...dateFilterCreatedAt },
        order: [['createdAt', 'DESC']]
      });

      let npsChart = [];
      let npsPatientData = {};

      npsResponses.forEach(nps => {
        npsChart.push({ nota: nps.nota, paciente_id: nps.paciente_id });

        if (!npsPatientData[nps.paciente_id]) npsPatientData[nps.paciente_id] = [];
        npsPatientData[nps.paciente_id].push({
          nota: nps.nota,
          data_nps: nps.createdAt ? nps.createdAt.toLocaleDateString('pt-BR') : 'N/A'
        });
      });

      let npsReport = [];
      basePatientsList.forEach(bp => {
        if (npsPatientData[bp.paciente_id]) {
          npsPatientData[bp.paciente_id].forEach(nps => npsReport.push({ ...bp, ...nps }));
        } else {
          npsReport.push({ ...bp, nota: 'Sem Resposta', data_nps: 'N/A' });
        }
      });

      // =========================================================
      // 7. HISTÓRICO DE TROCA DE MEDICAMENTOS
      // =========================================================
      let dateFilterTroca = {};
      if (data_inicio && data_fim) {
        dateFilterTroca.data_troca = { [Op.between]: [data_inicio, data_fim] };
      }

      const trocasMedicamentos = await HistoricoTrocaMedicamento.findAll({
        include: [
          { model: Pacientes, as: 'paciente', where: includePacienteWhere, attributes: ['id'] },
          { model: Medicamentos, as: 'medicamentoAntigo', attributes: ['nome'] },
          { model: Medicamentos, as: 'medicamentoNovo', attributes: ['nome'] }
        ],
        where: { ...dateFilterTroca },
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
      basePatientsList.forEach(bp => {
        if (trocasPatientData[bp.paciente_id]) {
          trocasPatientData[bp.paciente_id].forEach(troca => historicoTrocasReport.push({ ...bp, ...troca }));
        } else {
          historicoTrocasReport.push({ ...bp, medicamento_antigo: 'N/A', medicamento_novo: 'Sem Trocas Registradas', data_troca: 'N/A' });
        }
      });

      // =========================================================
      // REGISTRO DE AUDITORIA COM NOME DA OPERADORA
      // =========================================================
      let nomeOperadoraLog = 'Cic Oncologia (Todas)';
      const idParaBuscar = operadora_id || (permission.whereClause && permission.whereClause.operadora_id);

      if (idParaBuscar) {
        const operadoraBusca = await Operadora.findOne({
          where: { id: idParaBuscar },
          attributes: ['nome']
        });
        if (operadoraBusca) nomeOperadoraLog = operadoraBusca.nome;
      }

      console.log(`Auditoria -> Operadora: ${nomeOperadoraLog} | Usuário: ${req.userId}`);

      await AuditService.log(
        req.userId,
        'Emissão',
        'Dashboard',
        null,
        `Gerou relatório do dashboard para o período ${data_inicio || 'Início'} a ${data_fim || 'Fim'} - Operadora: ${nomeOperadoraLog}`
      );

      // =========================================================
      // RETORNO CONSOLIDADO
      // =========================================================
      return res.json({
        totalPacientes: {
          total: pacientes.length,
          chart: [
            { name: 'Ativos', value: ativosCount },
            { name: 'Inativos', value: inativosCount }
          ],
          report: totalPacientesReport
        },
        pacientesMonitorados: {
          total: totalMonitorados,
          chart: [
            { name: 'Monitorados', value: totalMonitorados },
            { name: 'Não Monitorados', value: naoMonitorados < 0 ? 0 : naoMonitorados }
          ],
          report: monitoradosReport
        },
        pacientesElegiveis: {
          total: elegiveisCount,
          chart: [
            { name: 'Elegíveis', value: elegiveisCount },
            { name: 'Não Elegíveis', value: naoElegiveisCount }
          ],
          report: elegiveisReport
        },
        termos: {
          chart: [
            { name: 'Aceito', value: termosCount.Aceito },
            { name: 'Pendente', value: termosCount.Pendente },
            { name: 'Recusado', value: termosCount.Recusado }
          ],
          report: termosReport
        },
        aderenciaCategoria: { chart: aderenciaCategoriaChart, report: categoriaReport },
        adesaoScore: {
          chart: [
            { name: 'Alta Adesão', value: adesaoAlta },
            { name: 'Média Adesão', value: adesaoMedia },
            { name: 'Baixa Adesão', value: adesaoBaixa }
          ],
          report: adesaoScoreReport
        },
        aderenciaOpcoes: {
          chart: [
            { name: 'Completamente', value: aderenciaOpcoesCount.COMPLETAMENTE },
            { name: 'Parcialmente', value: aderenciaOpcoesCount.PARCIALMENTE },
            { name: 'Não Adere', value: aderenciaOpcoesCount.NAO_ADERE }
          ],
          report: aderenciaOpcoesReport
        },
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