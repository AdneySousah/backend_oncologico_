import { Op, Sequelize } from 'sequelize';
import Pacientes from '../models/Pacientes.js';
import PatientEvaluation from '../models/PatientEvaluation.js';
import EvaluationTemplate from '../models/EvaluationTemplate.js';
import MonitoramentoMedicamento from '../models/MonitoramentoMedicamento.js';
import ReacaoAdversa from '../models/ReacaoAdversa.js';
import Operadora from '../models/Operadora.js';
import { getOperadoraFilter } from '../../utils/permissionUtils.js';
import AuditService from '../../services/AuditService.js';

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
        pacientesElegiveis: { chart: [], report: [], total: 0 }
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
      // DADOS GERAIS DE PACIENTES (Total, Termos e Elegíveis)
      // =========================================================
      const pacientes = await Pacientes.findAll({
        attributes: ['id', 'nome', 'sobrenome', 'status_termo', 'is_active', 'createdAt'],
        include: [{ model: Operadora, as: 'operadoras', attributes: ['nome'] }], // CORRIGIDO PARA 'operadoras'
        where: { ...includePacienteWhere, ...dateFilterCreatedAt }
      });

      let termosCount = { Aceito: 0, Recusado: 0, Pendente: 0 };
      let ativosCount = 0, inativosCount = 0;
      let elegiveisCount = 0, naoElegiveisCount = 0;

      let termosReport = [];
      let totalPacientesReport = [];
      let elegiveisReport = [];

      pacientes.forEach(p => {
        const statusTermo = p.status_termo || 'Pendente';
        const isAtivo = p.is_active;
        const nomeOperadora = p.operadoras?.nome || 'N/A'; // CORRIGIDO AQUI TAMBÉM
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

        if (statusTermo === 'Aceito') {
          elegiveisReport.push({ ...baseReport, status_elegibilidade: 'Elegível (Termo Aceito)' });
        }
      });

      // =========================================================
      // PACIENTES MONITORADOS (Ativos com >= 1 monitoramento)
      // =========================================================
      const monitoramentos = await MonitoramentoMedicamento.findAll({
        include: [{
          model: Pacientes, as: 'paciente',
          where: { ...includePacienteWhere, is_active: true },
          attributes: ['id', 'nome', 'sobrenome'],
          include: [{ model: Operadora, as: 'operadoras', attributes: ['nome'] }] // CORRIGIDO PARA 'operadoras'
        }],
        where: { ...dateFilter }
      });

      let monitoradosSet = new Set();
      let monitoradosReport = [];

      monitoramentos.forEach(mon => {
        if (!monitoradosSet.has(mon.paciente_id)) {
          monitoradosSet.add(mon.paciente_id);
          const nomeOperadora = mon.paciente?.operadoras?.nome || 'N/A'; // CORRIGIDO

          monitoradosReport.push({
            paciente_id: mon.paciente?.id,
            nome_paciente: `${mon.paciente?.nome} ${mon.paciente?.sobrenome || ''}`.trim(),
            operadora: nomeOperadora,
            ultimo_monitoramento: mon.updatedAt ? mon.updatedAt.toLocaleDateString('pt-BR') : 'N/A'
          });
        }
      });

      const totalMonitorados = monitoradosSet.size;
      const naoMonitorados = ativosCount - totalMonitorados;

      // =========================================================
      // 2. Pontuação de aderência por categoria (Template)
      // =========================================================
      const avaliacoes = await PatientEvaluation.findAll({
        include: [
          {
            model: Pacientes, as: 'paciente', where: includePacienteWhere, attributes: ['id', 'nome', 'sobrenome'],
            include: [{ model: Operadora, as: 'operadoras', attributes: ['nome'] }] // CORRIGIDO PARA 'operadoras'
          },
          { model: EvaluationTemplate, as: 'template', attributes: ['title'] }
        ],
        where: { total_score: { [Op.not]: null }, ...dateFilterCreatedAt }
      });

      let categoriasMap = {};
      let categoriaReport = [];
      let adesaoAlta = 0, adesaoMedia = 0, adesaoBaixa = 0;
      let adesaoScoreReport = [];

      avaliacoes.forEach(av => {
        const categoria = av.template?.title || 'Sem Categoria';
        const score = Number(av.total_score);
        const nomeOperadora = av.paciente?.operadoras?.nome || 'N/A'; // CORRIGIDO
        const nomeCompleto = `${av.paciente?.nome} ${av.paciente?.sobrenome || ''}`.trim();

        if (!categoriasMap[categoria]) categoriasMap[categoria] = { total: 0, count: 0 };
        categoriasMap[categoria].total += score;
        categoriasMap[categoria].count += 1;

        categoriaReport.push({
          paciente_id: av.paciente?.id,
          nome_paciente: nomeCompleto,
          operadora: nomeOperadora,
          categoria: categoria,
          score: score,
          data_avaliacao: av.createdAt ? av.createdAt.toLocaleDateString('pt-BR') : 'N/A'
        });

        let nivel = '';
        if (score >= 0 && score <= 10) { adesaoAlta++; nivel = 'Alta Adesão'; }
        else if (score >= 11 && score <= 13) { adesaoMedia++; nivel = 'Média Adesão'; }
        else if (score >= 14) { adesaoBaixa++; nivel = 'Baixa Adesão'; }
        else { nivel = 'Não Classificado'; }

        adesaoScoreReport.push({
          paciente_id: av.paciente?.id,
          nome_paciente: nomeCompleto,
          operadora: nomeOperadora,
          score_total: score,
          nivel_classificado: nivel,
          data_avaliacao: av.createdAt ? av.createdAt.toLocaleDateString('pt-BR') : 'N/A'
        });
      });

      const aderenciaCategoriaChart = Object.keys(categoriasMap).map(key => ({
        name: key,
        value: Number((categoriasMap[key].total / categoriasMap[key].count).toFixed(2))
      }));

      // =========================================================
      // 4. % Nível de Aderência (Opções do MonitoramentoMedicamento)
      // =========================================================
      const monitoramentosAderencia = await MonitoramentoMedicamento.findAll({
        include: [{
          model: Pacientes, as: 'paciente', where: includePacienteWhere, attributes: ['id', 'nome', 'sobrenome'],
          include: [{ model: Operadora, as: 'operadoras', attributes: ['nome'] }] // CORRIGIDO PARA 'operadoras'
        }],
        where: { nivel_adesao: { [Op.not]: null }, status: 'CONCLUIDO', ...dateFilter }
      });

      let aderenciaOpcoesCount = { COMPLETAMENTE: 0, PARCIALMENTE: 0, NAO_ADERE: 0 };
      let aderenciaOpcoesReport = [];

      monitoramentosAderencia.forEach(mon => {
        const nivel = mon.nivel_adesao;
        const nomeOperadora = mon.paciente?.operadoras?.nome || 'N/A'; // CORRIGIDO

        if (aderenciaOpcoesCount[nivel] !== undefined) aderenciaOpcoesCount[nivel]++;

        aderenciaOpcoesReport.push({
          paciente_id: mon.paciente?.id,
          nome_paciente: `${mon.paciente?.nome} ${mon.paciente?.sobrenome || ''}`.trim(),
          operadora: nomeOperadora,
          nivel_adesao_informado: nivel ? nivel.replace('_', ' ') : 'Não Informado',
          data_monitoramento: mon.updatedAt ? mon.updatedAt.toLocaleDateString('pt-BR') : 'N/A'
        });
      });

      // =========================================================
      // 5. Quantidade de pacientes por Ficha RAM
      // =========================================================
      const monitoramentosRam = await MonitoramentoMedicamento.findAll({
        include: [
          {
            model: Pacientes, as: 'paciente', where: includePacienteWhere, attributes: ['id', 'nome', 'sobrenome'],
            include: [{ model: Operadora, as: 'operadoras', attributes: ['nome'] }] // CORRIGIDO PARA 'operadoras'
          },
          { model: ReacaoAdversa, as: 'reacoesAdversas', attributes: ['name'], required: true }
        ],
        where: { is_reacao: true, ...dateFilter }
      });

      let ramMap = {};
      let ramReport = [];

      monitoramentosRam.forEach(mon => {
        if (mon.reacoesAdversas && mon.reacoesAdversas.length > 0) {
          const nomeOperadora = mon.paciente?.operadoras?.nome || 'N/A'; // CORRIGIDO

          mon.reacoesAdversas.forEach(reacaoObj => {
            const reacao = reacaoObj.name;
            if (!ramMap[reacao]) ramMap[reacao] = new Set();
            ramMap[reacao].add(mon.paciente_id);

            ramReport.push({
              paciente_id: mon.paciente?.id,
              nome_paciente: `${mon.paciente?.nome} ${mon.paciente?.sobrenome || ''}`.trim(),
              operadora: nomeOperadora,
              reacao_adversa: reacao,
              data_registro: mon.updatedAt ? mon.updatedAt.toLocaleDateString('pt-BR') : 'N/A'
            });
          });
        }
      });

      const fichaRamChart = Object.keys(ramMap).map(key => ({
        name: key,
        value: ramMap[key].size
      })).sort((a, b) => b.value - a.value).slice(0, 10);

      // =========================================================
      // REGISTRO DE AUDITORIA COM NOME DA OPERADORA
      // =========================================================
      let nomeOperadoraLog = 'Cic Oncologia (Todas)';
      
      if (operadora_id) {
        console.log(operadora_id)
        const operadoraBusca = await Operadora.findByPk(operadora_id, { attributes: ['nome'] });
        if (operadoraBusca) {
          nomeOperadoraLog = operadoraBusca.nome;
        }
      }

      console.log('A operadora encontrada é ', nomeOperadoraLog, 'e o usuario é', req.userId)

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
        fichaRam: { chart: fichaRamChart, report: ramReport }
      });

    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao gerar dados do dashboard', details: error.message });
    }
  }
}

export default new DashboardController();