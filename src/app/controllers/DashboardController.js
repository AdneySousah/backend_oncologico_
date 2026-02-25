import { Op, Sequelize } from 'sequelize';
import MonitoramentoMedicamento from '../models/MonitoramentoMedicamento.js';
import EntrevistaMedica from '../models/EntrevistaMedica.js';
import PatientEvaluation from '../models/PatientEvaluation.js';
import ReacaoAdversa from '../models/ReacaoAdversa.js';
import Pacientes from '../models/Pacientes.js';
import Diagnostico from '../models/Diagnostico.js';
import { getOperadoraFilter } from '../../utils/permissionUtils.js';

class DashboardController {
  async index(req, res) {
    try {
      const { operadora_id, data_inicio, data_fim } = req.query;
      
      // 1. APLICAÇÃO DO FILTRO DE OPERADORA
      const permission = await getOperadoraFilter(req.userId, operadora_id);
      const emptyDashboard = { adesao: [], contato: [], cid: [], reacoes: [], perfilRisco: [] };

      if (!permission.authorized) {
        if (permission.emptyResult) return res.json(emptyDashboard);
        return res.status(permission.status).json({ error: permission.error });
      }

      const includePacienteWhere = permission.whereClause;

      // 2. CRIANDO O FILTRO DE DATA (updated_at)
      let dateFilter = {};
      if (data_inicio && data_fim) {
        // Ajusta para o início do dia inicial e fim do dia final
        dateFilter.updated_at = {
          [Op.between]: [
            new Date(`${data_inicio}T00:00:00.000Z`),
            new Date(`${data_fim}T23:59:59.999Z`)
          ]
        };
      }

      // 3. BUSCAS COM O FILTRO APLICADO

      // 3.1 Adesão ao Tratamento
      const adesaoData = await MonitoramentoMedicamento.findAll({
        attributes: [
          'nivel_adesao',
          [Sequelize.fn('COUNT', Sequelize.col('MonitoramentoMedicamento.id')), 'quantidade']
        ],
        include: [{ 
          model: Pacientes, as: 'paciente', where: includePacienteWhere, attributes: [] 
        }],
        where: { 
          status: 'CONCLUIDO',
          nivel_adesao: { [Op.not]: null },
          ...dateFilter // Aplicando o filtro de data
        },
        group: ['nivel_adesao']
      });

      // 3.2 Taxa de Contato Efetivo
      const contatoData = await MonitoramentoMedicamento.findAll({
        attributes: [
          'contato_efetivo',
          [Sequelize.fn('COUNT', Sequelize.col('MonitoramentoMedicamento.id')), 'quantidade']
        ],
        include: [{ model: Pacientes, as: 'paciente', where: includePacienteWhere, attributes: [] }],
        where: { 
          status: 'CONCLUIDO',
          ...dateFilter // Aplicando o filtro de data
        },
        group: ['contato_efetivo']
      });

      // 3.3 CID Preenchido
      const totalEntrevistas = await EntrevistaMedica.count({
        include: [{ model: Pacientes, as: 'paciente', where: includePacienteWhere, required: true }],
        where: { ...dateFilter } // Aplicando o filtro de data
      });
      const cidPreenchido = await EntrevistaMedica.count({
        include: [{ model: Pacientes, as: 'paciente', where: includePacienteWhere, required: true }],
        where: { diagnostico_id: { [Op.not]: null }, ...dateFilter } // Aplicando o filtro de data
      });
      const cidNaoPreenchido = totalEntrevistas - cidPreenchido;

      // 3.4 Eventos Adversos (Reações mais comuns)
      const reacoesData = await MonitoramentoMedicamento.findAll({
        attributes: [
          [Sequelize.col('reacaoAdversa.name'), 'nome_reacao'],
          [Sequelize.fn('COUNT', Sequelize.col('MonitoramentoMedicamento.id')), 'quantidade']
        ],
        include: [
          { model: ReacaoAdversa, as: 'reacaoAdversa', attributes: [] },
          { model: Pacientes, as: 'paciente', where: includePacienteWhere, attributes: [] }
        ],
        where: { 
          is_reacao: true,
          reacao_adversa_id: { [Op.not]: null },
          ...dateFilter // Aplicando o filtro de data
        },
        group: ['reacaoAdversa.name', 'reacaoAdversa.id'],
        order: [[Sequelize.fn('COUNT', Sequelize.col('MonitoramentoMedicamento.id')), 'DESC']],
        limit: 5
      });

      // 3.5 Perfil de Risco (Baseado no score da PatientEvaluation)
      const avaliacoes = await PatientEvaluation.findAll({
        attributes: ['total_score'],
        include: [{ model: Pacientes, as: 'paciente', where: includePacienteWhere, attributes: [] }],
        where: { 
          total_score: { [Op.not]: null },
          ...dateFilter // Aplicando o filtro de data
        }
      });

      let riscoBaixo = 0, riscoMedio = 0, riscoAlto = 0;
      avaliacoes.forEach(av => {
        const score = Number(av.total_score);
        if (score >= 8) riscoBaixo++; 
        else if (score >= 5) riscoMedio++;
        else riscoAlto++;
      });

      // 4. RETORNO
      return res.json({
        adesao: adesaoData.map(item => ({
          name: item.nivel_adesao.replace('_', ' '),
          value: Number(item.getDataValue('quantidade'))
        })),
        contato: contatoData.map(item => ({
          name: item.contato_efetivo ? 'Efetivado' : 'Não Efetivado',
          value: Number(item.getDataValue('quantidade'))
        })),
        cid: [
          { name: 'Preenchido', value: cidPreenchido },
          { name: 'Não Preenchido', value: cidNaoPreenchido }
        ],
        reacoes: reacoesData.map(item => ({
          name: item.getDataValue('nome_reacao'),
          value: Number(item.getDataValue('quantidade'))
        })),
        perfilRisco: [
          { name: 'Baixo Risco', value: riscoBaixo },
          { name: 'Médio Risco', value: riscoMedio },
          { name: 'Alto Risco', value: riscoAlto }
        ]
      });

    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao gerar dados do dashboard', details: error.message });
    }
  }
}

export default new DashboardController();