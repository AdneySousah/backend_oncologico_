import MonitoramentoMedicamento from '../models/MonitoramentoMedicamento.js';
import Medicamentos from '../models/Medicamentos.js';
import Pacientes from '../models/Pacientes.js';
import Operadora from '../models/Operadora.js';
import { Op } from 'sequelize';
import { startOfDay, endOfDay, parseISO } from 'date-fns';
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

      // 1. Aplica a regra de permissão
      const permission = await getOperadoraFilter(req.userId, operadora_id);

      if (!permission.authorized) {
        if (permission.emptyResult) return res.json({ data: [], total_faturado: 0 });
        return res.status(permission.status).json({ error: permission.error });
      }

      // 2. Filtros de Data de Administração (Obrigatório para faturamento)
      let monitoramentoWhere = {
        data_administracao: { [Op.not]: null }
      };

      if (data_inicio && data_fim) {
        monitoramentoWhere.data_administracao = {
          [Op.between]: [startOfDay(parseISO(data_inicio)), endOfDay(parseISO(data_fim))]
        };
      }

      // 3. Filtro de Busca (Nome do Paciente)
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

      // 4. Busca todos os registros elegíveis no período
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
            attributes: ['id', 'nome', 'price','codigo_tuss','fornecedor'], // Supondo que 'price' seja o preço unitário
            required: true
          }
        ],
        order: [['data_administracao', 'ASC']]
      });

      // 5. Regra de Negócio: Deduplicar paciente + medicamento no mês
      const mapDeduplicacao = new Map();

      monitoramentos.forEach(item => {
        const chaveUnica = `${item.paciente_id}-${item.medicamento_id}`;
        // Se o paciente ainda não apareceu com este medicamento neste período, adicionamos
        if (!mapDeduplicacao.has(chaveUnica)) {
          mapDeduplicacao.set(chaveUnica, item);
        }
      });

      const registrosUnicos = Array.from(mapDeduplicacao.values());

      // 6. Formatação final e cálculos de comissão
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
          fornecedor: 'Não Informado', // Substitua caso tenha relação de fornecedor no DB
          data_administracao: registro.data_administracao,
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