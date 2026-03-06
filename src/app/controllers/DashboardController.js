import { Op, Sequelize } from 'sequelize';
import Pacientes from '../models/Pacientes.js';
import PatientEvaluation from '../models/PatientEvaluation.js';
import EvaluationTemplate from '../models/EvaluationTemplate.js';
import MonitoramentoMedicamento from '../models/MonitoramentoMedicamento.js';
import ReacaoAdversa from '../models/ReacaoAdversa.js';
import { getOperadoraFilter } from '../../utils/permissionUtils.js';

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
        fichaRam: { chart: [], report: [] }
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

      // ---------------------------------------------------------
      // 1. Termos Aceito x Pendente x Recusado
      // ---------------------------------------------------------
      const pacientesTermos = await Pacientes.findAll({
        attributes: ['id', 'nome', 'sobrenome', 'status_termo', 'createdAt'],
        where: { ...includePacienteWhere, ...dateFilterCreatedAt }
      });

      let termosCount = { Aceito: 0, Recusado: 0, Pendente: 0 };
      let termosReport = [];

      pacientesTermos.forEach(p => {
        const status = p.status_termo || 'Pendente';
        if (termosCount[status] !== undefined) termosCount[status]++;

        termosReport.push({
          paciente_id: p.id,
          nome_paciente: `${p.nome} ${p.sobrenome || ''}`.trim(),
          status_termo: status,
          data_registro: p.createdAt ? p.createdAt.toLocaleDateString('pt-BR') : 'N/A'
        });
      });

      // ---------------------------------------------------------
      // 2. Pontuação de aderência por categoria (Template)
      // ---------------------------------------------------------
      const avaliacoes = await PatientEvaluation.findAll({
        include: [
          { model: Pacientes, as: 'paciente', where: includePacienteWhere, attributes: ['id', 'nome', 'sobrenome'] },
          { model: EvaluationTemplate, as: 'template', attributes: ['title'] }
        ],
        where: { total_score: { [Op.not]: null }, ...dateFilterCreatedAt }
      });

      let categoriasMap = {};
      let categoriaReport = [];

      avaliacoes.forEach(av => {
        const categoria = av.template?.title || 'Sem Categoria';
        const score = Number(av.total_score);

        if (!categoriasMap[categoria]) {
          categoriasMap[categoria] = { total: 0, count: 0 };
        }
        categoriasMap[categoria].total += score;
        categoriasMap[categoria].count += 1;

        categoriaReport.push({
          paciente_id: av.paciente?.id,
          nome_paciente: `${av.paciente?.nome} ${av.paciente?.sobrenome || ''}`.trim(),
          categoria: categoria,
          score: score,
          data_avaliacao: av.createdAt ? av.createdAt.toLocaleDateString('pt-BR') : 'N/A'
        });
      });

      const aderenciaCategoriaChart = Object.keys(categoriasMap).map(key => ({
        name: key,
        value: Number((categoriasMap[key].total / categoriasMap[key].count).toFixed(2)) // Média
      }));

      // ---------------------------------------------------------
      // 3. % Nível de Adesão (Baseado na pontuação do questionário)
      // ---------------------------------------------------------

      let adesaoAlta = 0, adesaoMedia = 0, adesaoBaixa = 0;
      let adesaoScoreReport = [];

      avaliacoes.forEach(av => {
        const score = Number(av.total_score);
        let nivel = '';

        // Nova Regra: Quanto MAIOR a pontuação, MENOR a adesão.
        if (score >= 0 && score <= 10) { 
          adesaoAlta++; 
          nivel = 'Alta Adesão'; 
        } 
        else if (score >= 11 && score <= 13) { 
          adesaoMedia++; 
          nivel = 'Média Adesão'; 
        } 
        else if (score >= 14) { // 14 a 25+
          adesaoBaixa++; 
          nivel = 'Baixa Adesão'; 
        } else {
          nivel = 'Não Classificado';
        }

        adesaoScoreReport.push({
          paciente_id: av.paciente?.id,
          nome_paciente: `${av.paciente?.nome} ${av.paciente?.sobrenome || ''}`.trim(),
          score_total: score,
          nivel_classificado: nivel,
          data_avaliacao: av.createdAt ? av.createdAt.toLocaleDateString('pt-BR') : 'N/A'
        });
      });

      // ---------------------------------------------------------
      // 4. % Nível de Aderência (Opções do MonitoramentoMedicamento)
      // ---------------------------------------------------------
      const monitoramentosAderencia = await MonitoramentoMedicamento.findAll({
        include: [{ model: Pacientes, as: 'paciente', where: includePacienteWhere, attributes: ['id', 'nome', 'sobrenome'] }],
        where: { nivel_adesao: { [Op.not]: null }, status: 'CONCLUIDO', ...dateFilter }
      });

      let aderenciaOpcoesCount = { COMPLETAMENTE: 0, PARCIALMENTE: 0, NAO_ADERE: 0 };
      let aderenciaOpcoesReport = [];

      monitoramentosAderencia.forEach(mon => {
        const nivel = mon.nivel_adesao;
        if (aderenciaOpcoesCount[nivel] !== undefined) aderenciaOpcoesCount[nivel]++;

        aderenciaOpcoesReport.push({
          paciente_id: mon.paciente?.id,
          nome_paciente: `${mon.paciente?.nome} ${mon.paciente?.sobrenome || ''}`.trim(),
          nivel_adesao_informado: nivel ? nivel.replace('_', ' ') : 'Não Informado',
          data_monitoramento: mon.updatedAt ? mon.updatedAt.toLocaleDateString('pt-BR') : 'N/A'
        });
      });

      // ---------------------------------------------------------
      // 5. Quantidade de pacientes por Ficha RAM (Eventos Adversos)
      // ---------------------------------------------------------
      const monitoramentosRam = await MonitoramentoMedicamento.findAll({
        include: [
          {
            model: Pacientes,
            as: 'paciente',
            where: includePacienteWhere,
            attributes: ['id', 'nome', 'sobrenome']
          },
          {
            model: ReacaoAdversa,
            as: 'reacoesAdversas', // CORREÇÃO DO ALIAS
            attributes: ['name'],
            required: true // Traz apenas quem tem reação
          }
        ],
        where: {
          is_reacao: true,
          ...dateFilter
        }
      });

      let ramMap = {};
      let ramReport = [];

      monitoramentosRam.forEach(mon => {
        if (mon.reacoesAdversas && mon.reacoesAdversas.length > 0) {
          mon.reacoesAdversas.forEach(reacaoObj => {
            const reacao = reacaoObj.name;

            // Contar PACIENTES únicos por reação
            if (!ramMap[reacao]) ramMap[reacao] = new Set();
            ramMap[reacao].add(mon.paciente_id);

            ramReport.push({
              paciente_id: mon.paciente?.id,
              nome_paciente: `${mon.paciente?.nome} ${mon.paciente?.sobrenome || ''}`.trim(),
              reacao_adversa: reacao,
              data_registro: mon.updatedAt ? mon.updatedAt.toLocaleDateString('pt-BR') : 'N/A'
            });
          });
        }
      });

      const fichaRamChart = Object.keys(ramMap).map(key => ({
        name: key,
        value: ramMap[key].size // Quantidade de pacientes únicos
      })).sort((a, b) => b.value - a.value).slice(0, 10); // Top 10

      // ---------------------------------------------------------
      // RETORNO CONSOLIDADO
      // ---------------------------------------------------------
      return res.json({
        termos: {
          chart: [
            { name: 'Aceito', value: termosCount.Aceito },
            { name: 'Pendente', value: termosCount.Pendente },
            { name: 'Recusado', value: termosCount.Recusado }
          ],
          report: termosReport
        },
        aderenciaCategoria: {
          chart: aderenciaCategoriaChart,
          report: categoriaReport
        },
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
        fichaRam: {
          chart: fichaRamChart,
          report: ramReport
        }
      });

    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao gerar dados do dashboard', details: error.message });
    }
  }
}

export default new DashboardController();