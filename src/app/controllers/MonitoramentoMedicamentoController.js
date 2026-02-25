import MonitoramentoMedicamento from '../models/MonitoramentoMedicamento.js';
import Medicamentos from '../models/Medicamentos.js';
import Pacientes from '../models/Pacientes.js';
import PatientEvaluation from '../models/PatientEvaluation.js';
import Operadora from '../models/Operadora.js';
import { addDays, subDays, parseISO } from 'date-fns';
import { Op } from 'sequelize';
import { getOperadoraFilter } from '../../utils/permissionUtils.js';
import * as Yup from 'yup';

// --- NOVA FUNÇÃO AUXILIAR ---
// Calcula o próximo dia útil pulando finais de semana
const obterProximoDiaUtil = (dataBase) => {
  const proximoDia = addDays(dataBase, 1);
  const diaDaSemana = proximoDia.getDay(); // 0 = Domingo, 6 = Sábado

  if (diaDaSemana === 6) { // Caiu no Sábado, adiciona 2 dias (Segunda)
    return addDays(proximoDia, 2);
  }
  if (diaDaSemana === 0) { // Caiu no Domingo, adiciona 1 dia (Segunda)
    return addDays(proximoDia, 1);
  }
  
  return proximoDia;
};

class MonitoramentoMedicamentoController {
  
  // 1. Recebe os dados do Modal do Front-end e cria os agendamentos
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
        
        if (!medicamento || !medicamento.qtd_capsula) {
          continue; 
        }

        const diasDuracao = Math.floor(medicamento.qtd_capsula / item.posologia_diaria);
        const dataFimCaixa = addDays(new Date(), diasDuracao);
        const dataProximoContato = subDays(dataFimCaixa, 5); 

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

  // 2. Lista os pacientes que precisam de ligação hoje (ou atrasados)
  async index(req, res) {
    try {
      const operadoraQueryId = req.query.operadora_id;
      const permission = await getOperadoraFilter(req.userId, operadoraQueryId);

      if (!permission.authorized) {
        if (permission.emptyResult) return res.json([]);
        return res.status(permission.status).json({ error: permission.error });
      }

      const includePacienteWhere = permission.whereClause;

      const pendentes = await MonitoramentoMedicamento.findAll({
        where: { status: { [Op.ne]: 'CANCELADO' } },
        include: [
          { 
            model: Pacientes, 
            as: 'paciente', 
            attributes: ['id', 'nome', 'sobrenome', 'operadora_id'],
            where: includePacienteWhere, 
            required: true,
            include: [
              { model: Operadora, as: 'operadoras', attributes: ['id', 'nome'] }
            ]
          },
          { model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome', 'qtd_capsula'] },
          { model: PatientEvaluation, as: 'avaliacao', attributes: ['id', 'total_score'] }
        ],
        order: [['data_proximo_contato', 'ASC']]
      });

      return res.json(pendentes);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao buscar monitoramentos.', details: error.message });
    }
  }

  // 3. Registra as respostas do paciente na ligação e gera o próximo ciclo
  async update(req, res) {
    const schema = Yup.object().shape({
      contato_efetivo: Yup.boolean().nullable(),
      adesao_tratamento: Yup.boolean().nullable(),
      nivel_adesao: Yup.string().oneOf(['COMPLETAMENTE', 'PARCIALMENTE', 'NAO_ADERE']).nullable(),
      tomando_corretamente: Yup.boolean().nullable(),
      qtd_informada_caixa: Yup.number().integer().nullable(),
      data_abertura_nova_caixa: Yup.date().nullable(),
      is_reacao: Yup.boolean().nullable(), 
      reacao_adversa_id: Yup.number().integer().nullable()
    });

    try {
      await schema.validate(req.body, { abortEarly: false });
    } catch (err) {
      return res.status(400).json({ error: 'Falha na validação', messages: err.inner });
    }

    const { id } = req.params;
    const { 
      contato_efetivo,
      adesao_tratamento,
      nivel_adesao,
      tomando_corretamente, 
      qtd_informada_caixa, 
      data_abertura_nova_caixa,
      is_reacao, 
      reacao_adversa_id
    } = req.body;

    try {
      const monitoramentoAtual = await MonitoramentoMedicamento.findByPk(id, {
        include: [{ model: Medicamentos, as: 'medicamento' }]
      });

      if (!monitoramentoAtual) {
        return res.status(404).json({ error: 'Monitoramento não encontrado.' });
      }

      // Atualiza o registro atual informando o que aconteceu na ligação
      await monitoramentoAtual.update({
        contato_efetivo,
        adesao_tratamento,
        nivel_adesao: adesao_tratamento === false ? 'NAO_ADERE' : nivel_adesao,
        tomando_corretamente,
        qtd_informada_caixa,
        data_abertura_nova_caixa,
        is_reacao,
        reacao_adversa_id: is_reacao ? reacao_adversa_id : null, 
        status: 'CONCLUIDO'
      });

      // --- NOVA LÓGICA: SE O CONTATO NÃO FOI EFETIVO ---
      if (contato_efetivo === false) {
        const proximaData = obterProximoDiaUtil(new Date());

        // Cria um clone do monitoramento atual, empurrando para o próximo dia útil
        await MonitoramentoMedicamento.create({
          paciente_id: monitoramentoAtual.paciente_id,
          entrevista_profissional_id: monitoramentoAtual.entrevista_profissional_id,
          patient_evaluation_id: monitoramentoAtual.patient_evaluation_id,
          medicamento_id: monitoramentoAtual.medicamento_id,
          posologia_diaria: monitoramentoAtual.posologia_diaria,
          data_calculada_fim_caixa: monitoramentoAtual.data_calculada_fim_caixa, // Mantém a mesma previsão
          data_proximo_contato: proximaData, // Data empurrada pra frente
          status: 'PENDENTE'
        });

        return res.json({ message: 'Contato sem sucesso. Reagendado para o próximo dia útil.' });
      }
      // -------------------------------------------------

      // --- LÓGICA EXISTENTE: SE O CONTATO FOI BEM SUCEDIDO (contato_efetivo === true) ---
      if (data_abertura_nova_caixa) {
        const dataAbertura = parseISO(data_abertura_nova_caixa);
        const posologia = monitoramentoAtual.posologia_diaria;
        const qtdCapsulas = monitoramentoAtual.medicamento.qtd_capsula;

        const diasDuracaoNovo = Math.floor(qtdCapsulas / posologia);
        const novaDataFimCaixa = addDays(dataAbertura, diasDuracaoNovo);
        const novaDataContato = subDays(novaDataFimCaixa, 5);

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