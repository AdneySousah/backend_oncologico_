import MonitoramentoMedicamento from '../models/MonitoramentoMedicamento.js';
import Medicamentos from '../models/Medicamentos.js';
import Pacientes from '../models/Pacientes.js';
import Operadora from '../models/Operadora.js';
import EventosPaciente from '../models/EventosPaciente.js';
import User from '../models/User.js';
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
        comissao_percentual = 0,
        // 👇 ORIGEM: 'todos' (padrão) | 'monitorados' (só ciclos, como sempre foi)
        // | 'sem_acompanhamento' (só compras processadas sem monitoramento)
        origem = 'todos'
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

      const registrosUnicos = origem === 'sem_acompanhamento' ? [] : Array.from(mapDeduplicacao.values());
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
          comissao: valorComissao,
          origem: 'MONITORADO'
        };
      });

      // 👇 COMPRAS PROCESSADAS SEM ACOMPANHAMENTO: eventos marcados como
      // CONSUMIDO_SEM_CICLO (o operador confirmou que a caixa foi usada, mas
      // nenhum ciclo de monitoramento foi criado pra ela). Entram no relatório
      // sinalizadas, com total próprio — a regra dos ciclos não muda. A data de
      // referência é a previsão de administração da compra (o equivalente ao
      // data_administracao do ciclo); sem ela, a entrega real ou prevista.
      let totalSemAcompanhamento = 0;
      let totalComissaoSemAcompanhamento = 0;
      let semAcompanhamento = [];
      if (origem !== 'monitorados') {
        const eventos = await EventosPaciente.findAll({
          where: { processado: true, tipo_processamento: 'CONSUMIDO_SEM_CICLO', excluido_externo: false },
          include: [
            { model: Pacientes, as: 'paciente', where: pacienteWhere, required: true,
              attributes: ['id', 'nome', 'sobrenome', 'cpf', 'operadora_id', 'matricula'],
              include: [{ model: Operadora, as: 'operadoras', attributes: ['id', 'nome'] }] },
            { model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome', 'price', 'codigo_tuss', 'fornecedor'], required: true },
            { model: User, as: 'processadoPor', attributes: ['id', 'name'], required: false },
            { model: MonitoramentoMedicamento, as: 'monitoramento', attributes: ['id', 'evento_externo_id'], required: false }
          ]
        });
        const dataReferencia = (e) => e.data_administracao_prevista || e.data_entrega_real || e.data_entrega_prevista || null;
        semAcompanhamento = eventos
          .filter(e => {
            const ref = dataReferencia(e);
            if (!ref) return false;
            if (data_inicio && data_fim) return ref >= data_inicio && ref <= data_fim;
            return true;
          })
          .sort((a, b) => String(dataReferencia(a)).localeCompare(String(dataReferencia(b))))
          .map(e => {
            const precoUnitario = Number(e.medicamento.price) || 0;
            const quantidade = e.qtd_caixas || 1;
            const precoTotal = precoUnitario * quantidade;
            const valorComissao = precoTotal * taxaComissao;
            totalSemAcompanhamento += precoTotal;
            totalComissaoSemAcompanhamento += valorComissao;
            return {
              id_monitoramento: null,
              evento_externo_id: e.external_id,
              paciente: `${e.paciente.nome} ${e.paciente.sobrenome}`,
              matricula: e.paciente.matricula || 'N/A',
              cpf: e.paciente.cpf,
              operadora: e.paciente.operadoras?.nome || 'Sem Operadora',
              codigo_tuss: e.medicamento.codigo_tuss || 'Sem TUSS',
              medicamento: e.medicamento.nome,
              fornecedor: 'Não Informado',
              data_administracao: dataReferencia(e),
              quantidade,
              preco_unitario: precoUnitario,
              preco_total: precoTotal,
              comissao: valorComissao,
              origem: 'SEM_ACOMPANHAMENTO',
              processado_em: e.processado_em,
              processado_por: e.processadoPor?.name || null,
              ciclo_base_id: e.monitoramento?.id || null,
              ciclo_base_evento: e.monitoramento?.evento_externo_id || null,
              observacao_processamento: e.processamento_observacao || null
            };
          });
      }

      return res.json({
        data: [...faturamentoFinal, ...semAcompanhamento],
        resumo: {
          total_faturado: totalGeralFaturado,
          total_comissao: totalGeralComissao,
          qtd_atendimentos: faturamentoFinal.length,
          // 👇 separados de propósito: o que já foi emitido não muda de número
          total_sem_acompanhamento: totalSemAcompanhamento,
          total_comissao_sem_acompanhamento: totalComissaoSemAcompanhamento,
          qtd_sem_acompanhamento: semAcompanhamento.length,
          total_geral: totalGeralFaturado + totalSemAcompanhamento,
          total_comissao_geral: totalGeralComissao + totalComissaoSemAcompanhamento
        }
      });

    } catch (error) {
      console.error("Erro no FaturamentoController:", error);
      return res.status(500).json({ error: 'Erro ao gerar faturamento.', details: error.message });
    }
  }
}

export default new FaturamentoController();