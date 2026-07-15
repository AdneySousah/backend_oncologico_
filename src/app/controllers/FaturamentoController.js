import MonitoramentoMedicamento from '../models/MonitoramentoMedicamento.js';
import Medicamentos from '../models/Medicamentos.js';
import Pacientes from '../models/Pacientes.js';
import Operadora from '../models/Operadora.js';
import { Op } from 'sequelize';
import { getOperadoraFilter } from '../../utils/permissionUtils.js';

class FaturamentoController {
  async index(req, res) {
    try {
      const {
        operadora_id,
        data_inicio,
        data_fim,
        search = '',
        comissao_percentual = 0
      } = req.query;

      const permission = await getOperadoraFilter(req.userId, operadora_id);

      if (!permission.authorized) {
        if (permission.emptyResult) return res.json({ data: [], total_faturado: 0 });
        return res.status(permission.status).json({ error: permission.error });
      }

      // 1. REGRA DE NEGÓCIO: Faturamento baseado na Administração
      let monitoramentoWhere = {
        data_administracao: { [Op.not]: null }
      };

      if (data_inicio && data_fim) {
        // No Postgres, passar a string YYYY-MM-DD direto no between é a forma 
        // mais segura de evitar que o Sequelize injete fusos horários errados na query.
        monitoramentoWhere.data_administracao = {
          [Op.between]: [data_inicio, data_fim] 
        };
      }

      let pacienteWhere = { ...permission.whereClause };
      if (search) {
        const termosPesquisa = search.trim().split(/\s+/);
        const condicoesBusca = termosPesquisa.map(termo => ({
          [Op.or]: [
            { nome: { [Op.iLike]: `%${termo}%` } },
            { sobrenome: { [Op.iLike]: `%${termo}%` } },
            { cpf: { [Op.iLike]: `%${termo}%` } }
          ]
        }));
        pacienteWhere = { ...pacienteWhere, [Op.and]: condicoesBusca };
      }

      const monitoramentos = await MonitoramentoMedicamento.findAll({
        where: monitoramentoWhere,
        include: [
          {
            model: Pacientes,
            as: 'paciente',
            where: pacienteWhere,
            required: true,
            attributes: ['id', 'nome', 'sobrenome', 'cpf', 'operadora_id','matricula'],
            include: [{ model: Operadora, as: 'operadoras', attributes: ['id', 'nome'] }]
          },
          {
            model: Medicamentos,
            as: 'medicamento',
            attributes: ['id', 'nome', 'price','codigo_tuss','fornecedor'], 
            required: true
          }
        ],
        order: [['data_administracao', 'ASC']]
      });

      const mapDeduplicacao = new Map();

      monitoramentos.forEach(item => {
        const chaveUnica = `${item.paciente_id}-${item.medicamento_id}`;
        if (!mapDeduplicacao.has(chaveUnica)) {
          mapDeduplicacao.set(chaveUnica, item);
        }
      });

      const registrosUnicos = Array.from(mapDeduplicacao.values());
      const taxaComissao = parseFloat(comissao_percentual) / 100;
      let totalGeralFaturado = 0;
      let totalGeralComissao = 0;

      const faturamentoFinal = registrosUnicos.map(registro => {
        const precoUnitario = Number(registro.medicamento.price) || 0;
        const quantidade = registro.qtd_caixas || 1;
        const precoTotal = precoUnitario * quantidade;
        const valorComissao = precoTotal * taxaComissao;

        totalGeralFaturado += precoTotal;
        totalGeralComissao += valorComissao;

        return {
          id_monitoramento: registro.id,
          paciente: `${registro.paciente.nome} ${registro.paciente.sobrenome}`,
          matricula: registro.paciente.matricula || 'N/A',
          cpf: registro.paciente.cpf,
          operadora: registro.paciente.operadoras?.nome || 'Sem Operadora',
          codigo_tuss: registro.medicamento.codigo_tuss || 'Sem TUSS',
          medicamento: registro.medicamento.nome,
          fornecedor: 'Não Informado', 
          data_administracao: registro.data_administracao, // REGRA APLICADA AQUI
          quantidade: quantidade,
          preco_unitario: precoUnitario,
          preco_total: precoTotal,
          comissao: valorComissao
        };
      });

      return res.json({
        data: faturamentoFinal,
        resumo: {
          total_faturado: totalGeralFaturado,
          total_comissao: totalGeralComissao,
          qtd_atendimentos: faturamentoFinal.length
        }
      });

    } catch (error) {
      console.error("Erro no FaturamentoController:", error);
      return res.status(500).json({ error: 'Erro ao gerar faturamento.', details: error.message });
    }
  }
}

export default new FaturamentoController();