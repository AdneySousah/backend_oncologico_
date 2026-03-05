import MonitoramentoMedicamento from '../models/MonitoramentoMedicamento.js';
import Medicamentos from '../models/Medicamentos.js';
import Pacientes from '../models/Pacientes.js';
import PatientEvaluation from '../models/PatientEvaluation.js';
import Operadora from '../models/Operadora.js';
import { addDays, subDays, parseISO } from 'date-fns';
import { Op } from 'sequelize';
import { getOperadoraFilter } from '../../utils/permissionUtils.js';
import * as Yup from 'yup';

const obterProximoDiaUtil = (dataBase) => {
  const proximoDia = addDays(dataBase, 1);
  const diaDaSemana = proximoDia.getDay(); 

  if (diaDaSemana === 6) { 
    return addDays(proximoDia, 2);
  }
  if (diaDaSemana === 0) { 
    return addDays(proximoDia, 1);
  }
  
  return proximoDia;
};

class MonitoramentoMedicamentoController {
  
  async store(req, res) {
    const schema = Yup.object().shape({
      paciente_id: Yup.number().integer().required('O ID do paciente é obrigatório.'),
      entrevista_profissional_id: Yup.number().integer().nullable(),
      patient_evaluation_id: Yup.number().integer().nullable(),
      medicamentos_confirmados: Yup.array().of(
        Yup.object().shape({
          medicamento_id: Yup.number().integer().required('ID do medicamento é obrigatório.'),
          posologia_diaria: Yup.number().integer().required('A posologia é obrigatória.')
        })
      ).min(1, 'É necessário enviar pelo menos um medicamento.').required('A lista de medicamentos é obrigatória.')
    });

    try {
      await schema.validate(req.body, { abortEarly: false });
    } catch (err) {
      return res.status(400).json({ error: 'Falha na validação', messages: err.inner });
    }

    const { paciente_id, entrevista_profissional_id, patient_evaluation_id, medicamentos_confirmados } = req.body;

    try {
      const agendamentos = [];

      for (let item of medicamentos_confirmados) {
        const medicamento = await Medicamentos.findByPk(item.medicamento_id);
        
        if (!medicamento || !medicamento.qtd_capsula) continue; 

        const diasDuracao = Math.floor(medicamento.qtd_capsula / item.posologia_diaria);
        const dataFimCaixa = addDays(new Date(), diasDuracao);
        const dataProximoContato = subDays(dataFimCaixa, 10); 

        const novoMonitoramento = await MonitoramentoMedicamento.create({
          paciente_id,
          entrevista_profissional_id,
          patient_evaluation_id,
          medicamento_id: item.medicamento_id,
          posologia_diaria: item.posologia_diaria,
          data_calculada_fim_caixa: dataFimCaixa,
          data_proximo_contato: dataProximoContato,
          status: 'PENDENTE'
        });

        agendamentos.push(novoMonitoramento);
      }

      return res.status(201).json(agendamentos);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao gerar monitoramento', details: error.message });
    }
  }

  async index(req, res) {
    try {
      const { operadora_id, page = 1, limit = 20, search = '' } = req.query;
      const offset = (page - 1) * limit;

      const permission = await getOperadoraFilter(req.userId, operadora_id);

      if (!permission.authorized) {
        if (permission.emptyResult) return res.json({ data: [], total: 0, totalPages: 0, currentPage: 1 });
        return res.status(permission.status).json({ error: permission.error });
      }

      // LÓGICA DE BUSCA CORRIGIDA: Quebra o texto por espaços e exige que todos os pedaços existam no nome ou sobrenome
      let pacienteWhere = { ...permission.whereClause };
      if (search) {
        const termosPesquisa = search.trim().split(/\s+/); // Pega "Ana Costa" e vira ["Ana", "Costa"]
        
        const condicoesBusca = termosPesquisa.map(termo => ({
          [Op.or]: [
            { nome: { [Op.iLike]: `%${termo}%` } },
            { sobrenome: { [Op.iLike]: `%${termo}%` } }
          ]
        }));

        pacienteWhere = {
          ...pacienteWhere,
          [Op.and]: condicoesBusca // Junta as regras obrigando a ter 'Ana' E 'Costa'
        };
      }

      const { count, rows: pendentesPagina } = await MonitoramentoMedicamento.findAndCountAll({
        where: { status: 'PENDENTE' },
        include: [
          { 
            model: Pacientes, 
            as: 'paciente', 
            attributes: ['id', 'nome', 'sobrenome', 'operadora_id'],
            where: pacienteWhere, 
            required: true,
            include: [{ model: Operadora, as: 'operadoras', attributes: ['id', 'nome'] }]
          }
        ],
        order: [['data_proximo_contato', 'ASC']],
        limit: parseInt(limit),
        offset: parseInt(offset)
      });

      if (pendentesPagina.length === 0) {
        return res.json({ data: [], total: 0, totalPages: 0, currentPage: parseInt(page) });
      }

      const uniquePairs = [];
      const map = new Set();
      for (const p of pendentesPagina) {
         const key = `${p.paciente_id}_${p.medicamento_id}`;
         if (!map.has(key)) {
             map.add(key);
             uniquePairs.push({ paciente_id: p.paciente_id, medicamento_id: p.medicamento_id });
         }
      }

      const allRecordsForPage = await MonitoramentoMedicamento.findAll({
        where: {
          [Op.or]: uniquePairs,
          status: { [Op.ne]: 'CANCELADO' }
        },
        include: [
          { 
            model: Pacientes, 
            as: 'paciente', 
            attributes: ['id', 'nome', 'sobrenome', 'operadora_id'],
            include: [{ model: Operadora, as: 'operadoras', attributes: ['id', 'nome'] }]
          },
          { model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome', 'qtd_capsula'] },
          { model: PatientEvaluation, as: 'avaliacao', attributes: ['id', 'total_score'] }
        ]
      });

      return res.json({
        data: allRecordsForPage,
        total: count,
        totalPages: Math.ceil(count / limit),
        currentPage: parseInt(page)
      });

    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao buscar monitoramentos.', details: error.message });
    }
  }

  async update(req, res) {
    const schema = Yup.object().shape({
      contato_efetivo: Yup.boolean().nullable(),
      nivel_adesao: Yup.string().oneOf(['COMPLETAMENTE', 'PARCIALMENTE', 'NAO_ADERE']).nullable(),
      qtd_informada_caixa: Yup.number().integer().nullable(),
      data_abertura_nova_caixa: Yup.date().nullable(),
      is_reacao: Yup.boolean().nullable(), 
      reacoes_adversas: Yup.array().of(Yup.number().integer()).nullable() 
    });

    try {
      await schema.validate(req.body, { abortEarly: false });
    } catch (err) {
      return res.status(400).json({ error: 'Falha na validação', messages: err.inner });
    }

    const { id } = req.params;
    const { 
      contato_efetivo,
      nivel_adesao,
      qtd_informada_caixa, 
      data_abertura_nova_caixa,
      is_reacao, 
      reacoes_adversas
    } = req.body;

    try {
      const monitoramentoAtual = await MonitoramentoMedicamento.findByPk(id, {
        include: [{ model: Medicamentos, as: 'medicamento' }]
      });

      if (!monitoramentoAtual) {
        return res.status(404).json({ error: 'Monitoramento não encontrado.' });
      }

      await monitoramentoAtual.update({
        contato_efetivo,
        nivel_adesao: contato_efetivo === false ? 'NAO_ADERE' : nivel_adesao,
        qtd_informada_caixa,
        data_abertura_nova_caixa,
        is_reacao,
        status: 'CONCLUIDO'
      });

      if (is_reacao && reacoes_adversas && reacoes_adversas.length > 0) {
        await monitoramentoAtual.setReacoesAdversas(reacoes_adversas);
      } else {
        await monitoramentoAtual.setReacoesAdversas([]); 
      }

      if (contato_efetivo === false) {
        const proximaData = obterProximoDiaUtil(new Date());

        await MonitoramentoMedicamento.create({
          paciente_id: monitoramentoAtual.paciente_id,
          entrevista_profissional_id: monitoramentoAtual.entrevista_profissional_id,
          patient_evaluation_id: monitoramentoAtual.patient_evaluation_id,
          medicamento_id: monitoramentoAtual.medicamento_id,
          posologia_diaria: monitoramentoAtual.posologia_diaria,
          data_calculada_fim_caixa: monitoramentoAtual.data_calculada_fim_caixa,
          data_proximo_contato: proximaData,
          status: 'PENDENTE'
        });

        return res.json({ message: 'Contato sem sucesso. Reagendado para o próximo dia útil.' });
      }

      if (data_abertura_nova_caixa) {
        const dataAbertura = parseISO(data_abertura_nova_caixa);
        const posologia = monitoramentoAtual.posologia_diaria;
        const qtdCapsulas = monitoramentoAtual.medicamento.qtd_capsula;

        const diasDuracaoNovo = Math.floor(qtdCapsulas / posologia);
        const novaDataFimCaixa = addDays(dataAbertura, diasDuracaoNovo);
        const novaDataContato = subDays(novaDataFimCaixa, 10);

        await MonitoramentoMedicamento.create({
          paciente_id: monitoramentoAtual.paciente_id,
          entrevista_profissional_id: monitoramentoAtual.entrevista_profissional_id,
          patient_evaluation_id: monitoramentoAtual.patient_evaluation_id, 
          medicamento_id: monitoramentoAtual.medicamento_id,
          posologia_diaria: posologia,
          data_calculada_fim_caixa: novaDataFimCaixa,
          data_proximo_contato: novaDataContato,
          status: 'PENDENTE'
        });
      }

      return res.json({ message: 'Contato registrado e próximo monitoramento agendado com sucesso!' });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao registrar contato', details: error.message });
    }
  }

  async timeline(req, res) {
    try {
        const operadoraQueryId = req.query.operadora_id;
        const permission = await getOperadoraFilter(req.userId, operadoraQueryId);

        if (!permission.authorized) return res.json([]);

        const monitoramentos = await MonitoramentoMedicamento.findAll({
            include: [
                { 
                    model: Pacientes, 
                    as: 'paciente', 
                    where: permission.whereClause,
                    attributes: ['id', 'nome', 'sobrenome'] 
                },
                { model: Medicamentos, as: 'medicamento', attributes: ['nome'] }
            ],
            order: [['createdAt', 'DESC']]
        });

        return res.json(monitoramentos);
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao buscar dados da timeline' });
    }
  }
}

export default new MonitoramentoMedicamentoController();