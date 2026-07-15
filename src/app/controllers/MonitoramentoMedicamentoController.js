import MonitoramentoMedicamento from '../models/MonitoramentoMedicamento.js';
import Medicamentos from '../models/Medicamentos.js';
import Pacientes from '../models/Pacientes.js';
import PatientEvaluation from '../models/PatientEvaluation.js';
import Operadora from '../models/Operadora.js';
import EventosPaciente from '../models/EventosPaciente.js'; // NOVO IMPORT AQUI
import HistoricoTrocaMedicamento from '../models/HistoricoTrocaMedicamento.js';
import ReacaoAdversa from '../models/ReacaoAdversa.js';
import { addDays, subDays, parseISO } from 'date-fns';
import { Op } from 'sequelize';
import { getOperadoraFilter } from '../../utils/permissionUtils.js';
import * as Yup from 'yup';
import AuditService from '../../services/AuditService.js';

const obterProximoDiaUtil = (dataBase) => {
  const proximoDia = addDays(dataBase, 1);
  const diaDaSemana = proximoDia.getDay();
  if (diaDaSemana === 6) return addDays(proximoDia, 2);
  if (diaDaSemana === 0) return addDays(proximoDia, 1);
  return proximoDia;
};

class MonitoramentoMedicamentoController {
  async store(req, res) {
    const schema = Yup.object().shape({
      paciente_id: Yup.number().integer().required(),
      patient_evaluation_id: Yup.number().integer().nullable(),
      medicamentos_confirmados: Yup.array().of(
        Yup.object().shape({
          medicamento_id: Yup.number().integer().required(),
          posologia_diaria: Yup.number().integer().required(),
          data_entrega: Yup.date().required(),
          data_telemonitoramento: Yup.date().required(),
          qtd_capsula_manual: Yup.number().integer().nullable(),
          qtd_caixas: Yup.number().integer().nullable()
        })
      ).min(1).required()
    });

    try { await schema.validate(req.body, { abortEarly: false }); }
    catch (err) { return res.status(400).json({ error: 'Falha na validação', messages: err.inner }); }

    const { paciente_id, patient_evaluation_id, medicamentos_confirmados } = req.body;

    try {
      // Busca o evento local mais recente ao invés de bater na API externa
      let externalEventId = null;
      const ultimoEvento = await EventosPaciente.findOne({
        where: { paciente_id },
        order: [['data_entrega_prevista', 'DESC']]
      });
      if (ultimoEvento) externalEventId = ultimoEvento.external_id;

      const agendamentos = [];

      for (let item of medicamentos_confirmados) {
        const medicamento = await Medicamentos.findByPk(item.medicamento_id);
        if (!medicamento) return res.status(404).json({ error: `Medicamento não encontrado.` });

        const qtdPorCaixa = item.qtd_capsula_manual || medicamento.qtd_capsula;
        if (!qtdPorCaixa) {
          return res.status(400).json({ error: 'MISSING_QTD_CAPSULA', needs_qtd_capsula: true });
        }

        if (item.qtd_capsula_manual && !medicamento.qtd_capsula) {
          await medicamento.update({ qtd_capsula: item.qtd_capsula_manual });
        }

        const qtdCaixas = item.qtd_caixas || 1;
        const totalCapsulas = qtdPorCaixa * qtdCaixas;
        const dataEntrega = parseISO(item.data_entrega);
        const diasDuracao = Math.floor(totalCapsulas / item.posologia_diaria);
        const dataFimCaixa = addDays(dataEntrega, diasDuracao);
        const dataProximoContato = parseISO(item.data_telemonitoramento);

        const novoMonitoramento = await MonitoramentoMedicamento.create({
          paciente_id,
          patient_evaluation_id,
          medicamento_id: item.medicamento_id,
          posologia_diaria: item.posologia_diaria,
          data_entrega: dataEntrega,
          data_calculada_fim_caixa: dataFimCaixa,
          data_proximo_contato: dataProximoContato,
          qtd_caixas: qtdCaixas,
          qtd_total_capsulas: totalCapsulas,
          evento_externo_id: externalEventId,
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
    // [CÓDIGO ORIGINAL MANTIDO INTACTO POIS JÁ ESTAVA CORRETO]
    try {
      const { operadora_id, page = 1, limit = 20, search = '' } = req.query;
      const offset = (page - 1) * limit;
      const permission = await getOperadoraFilter(req.userId, operadora_id);
      if (!permission.authorized) {
        if (permission.emptyResult) return res.json({ data: [], total: 0, totalPages: 0, currentPage: 1 });
        return res.status(permission.status).json({ error: permission.error });
      }

      let pacienteWhere = { ...permission.whereClause };
      if (search) {
        const termosPesquisa = search.trim().split(/\s+/);
        const condicoesBusca = termosPesquisa.map(termo => ({
          [Op.or]: [{ nome: { [Op.iLike]: `%${termo}%` } }, { sobrenome: { [Op.iLike]: `%${termo}%` } }]
        }));
        pacienteWhere = { ...pacienteWhere, [Op.and]: condicoesBusca };
      }

      const { count, rows: pendentesPagina } = await MonitoramentoMedicamento.findAndCountAll({
        where: { status: 'PENDENTE' },
        include: [
          {
            model: Pacientes, as: 'paciente', attributes: ['id', 'nome', 'sobrenome', 'operadora_id', 'possui_cuidador', 'nome_cuidador', 'contato_cuidador'],
            where: pacienteWhere, required: true,
            include: [{ model: Operadora, as: 'operadoras', attributes: ['id', 'nome'] }]
          }
        ],
        order: [['data_proximo_contato', 'ASC']],
        limit: parseInt(limit), offset: parseInt(offset)
      });

      if (pendentesPagina.length === 0) return res.json({ data: [], total: 0, totalPages: 0, currentPage: parseInt(page) });

      const uniquePatientIds = [...new Set(pendentesPagina.map(p => p.paciente_id))];
      const allRecordsForPage = await MonitoramentoMedicamento.findAll({
        where: { paciente_id: { [Op.in]: uniquePatientIds }, status: { [Op.ne]: 'CANCELADO' } },
        include: [
          {
            model: Pacientes, as: 'paciente',
            attributes: ['id', 'nome', 'sobrenome', 'celular', 'telefone', 'operadora_id', 'possui_cuidador', 'nome_cuidador', 'contato_cuidador'],
            include: [
              { model: Operadora, as: 'operadoras', attributes: ['id', 'nome'] },
              { model: PatientEvaluation, as: 'avaliacoes', attributes: ['id', 'total_score', 'createdAt'], required: false },
            ]
          },
          { model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome', 'qtd_capsula'] },
          { model: PatientEvaluation, as: 'avaliacao', attributes: ['id', 'total_score'] }
        ],
        order: [['createdAt', 'DESC']]
      });

      return res.json({ data: allRecordsForPage, total: count, totalPages: Math.ceil(count / limit), currentPage: parseInt(page) });
    } catch (error) { return res.status(500).json({ error: 'Erro ao buscar monitoramentos.', details: error.message }); }
  }

  async update(req, res) {
    // [CÓDIGO ORIGINAL MANTIDO INTACTO POIS A LÓGICA DE DATAS ESTAVA CORRETA]
    const schema = Yup.object().shape({
      contato_efetivo: Yup.boolean().nullable(),
      nivel_adesao: Yup.string().oneOf(['COMPLETAMENTE', 'PARCIALMENTE', 'NAO_ADERE']).nullable(),
      qtd_informada_caixa: Yup.number().integer().nullable(),
      data_abertura_nova_caixa: Yup.date().nullable(),
      is_reacao: Yup.boolean().nullable(),
      reacoes_adversas: Yup.array().of(Yup.number().integer()).nullable(),
      observacao: Yup.string().nullable(),
      aplicar_nova_compra: Yup.boolean().nullable(),
      dados_nova_compra: Yup.object().nullable(),
      data_inicio_nova_caixa: Yup.date().nullable(),
      posologia_nova_caixa: Yup.number().integer().nullable()
    });

    try { await schema.validate(req.body, { abortEarly: false }); }
    catch (err) { return res.status(400).json({ error: 'Falha na validação', messages: err.inner }); }

    const { id } = req.params;
    const { contato_efetivo, nivel_adesao, qtd_informada_caixa, data_abertura_nova_caixa, is_reacao, reacoes_adversas, observacao, aplicar_nova_compra, dados_nova_compra, data_inicio_nova_caixa, posologia_nova_caixa } = req.body;

    try {
      const monitoramentoAtual = await MonitoramentoMedicamento.findByPk(id);
      if (!monitoramentoAtual) return res.status(404).json({ error: 'Monitoramento não encontrado.' });

      await monitoramentoAtual.update({
        contato_efetivo,
        nivel_adesao: contato_efetivo === false ? 'NAO_ADERE' : nivel_adesao,
        qtd_informada_caixa, data_abertura_nova_caixa, is_reacao, status: 'CONCLUIDO', observacao,
        data_telemonitoramento_efetivado: new Date()
      });

      if (is_reacao && reacoes_adversas && reacoes_adversas.length > 0) await monitoramentoAtual.setReacoesAdversas(reacoes_adversas);
      else await monitoramentoAtual.setReacoesAdversas([]);

      if (contato_efetivo === false) {
        const proximaData = obterProximoDiaUtil(new Date());
        await MonitoramentoMedicamento.create({
          paciente_id: monitoramentoAtual.paciente_id, patient_evaluation_id: monitoramentoAtual.patient_evaluation_id,
          medicamento_id: monitoramentoAtual.medicamento_id, posologia_diaria: monitoramentoAtual.posologia_diaria,
          data_entrega: monitoramentoAtual.data_entrega, data_administracao: monitoramentoAtual.data_administracao,
          data_calculada_fim_caixa: monitoramentoAtual.data_calculada_fim_caixa, data_proximo_contato: proximaData,
          status: 'PENDENTE', qtd_caixas: monitoramentoAtual.qtd_caixas, qtd_total_capsulas: monitoramentoAtual.qtd_total_capsulas,
          evento_externo_id: monitoramentoAtual.evento_externo_id
        });
        return res.json({ message: 'Contato sem sucesso. Reagendado para o próximo dia útil.' });
      }

      let proximoMedicamentoId = monitoramentoAtual.medicamento_id;
      let proximasCaixas = monitoramentoAtual.qtd_caixas;
      let proximasCapsulasTotais = monitoramentoAtual.qtd_total_capsulas;
      let proximaDataEntrega = monitoramentoAtual.data_entrega;
      let proximaDataFimCaixa = monitoramentoAtual.data_calculada_fim_caixa;
      let proximaDataAdministracao = monitoramentoAtual.data_administracao;
      let proximoEventoExternoId = monitoramentoAtual.evento_externo_id;
      let proximaPosologia = monitoramentoAtual.posologia_diaria;

      if (qtd_informada_caixa != null) {
        const diasRestantes = Math.floor(qtd_informada_caixa / monitoramentoAtual.posologia_diaria);
        proximaDataFimCaixa = addDays(new Date(), diasRestantes);
      }

      if (aplicar_nova_compra && dados_nova_compra) {
        proximoMedicamentoId = dados_nova_compra.medicamento_novo.id;
        proximasCaixas = dados_nova_compra.qtd_caixas;
        proximaDataEntrega = parseISO(dados_nova_compra.data_entrega);
        proximoEventoExternoId = dados_nova_compra.evento_externo_id;
        proximaPosologia = posologia_nova_caixa || monitoramentoAtual.posologia_diaria;
        proximaDataAdministracao = data_inicio_nova_caixa ? parseISO(data_inicio_nova_caixa) : parseISO(dados_nova_compra.data_novo_inicio);

        let sobraNoDiaDoInicio = 0;
        if (!dados_nova_compra.mudou_medicamento) {
          if (contato_efetivo && qtd_informada_caixa != null) {
            let dataFimEstimadaObj;
            const dataInicioAtual = monitoramentoAtual.data_administracao || monitoramentoAtual.data_entrega;
            const dataInicioAtualObj = dataInicioAtual ? new Date(dataInicioAtual) : new Date();
            dataInicioAtualObj.setHours(0, 0, 0, 0);

            const dataHoje = new Date(); dataHoje.setHours(0, 0, 0, 0);
            const isAntesDoInicioBack = dataHoje < dataInicioAtualObj;

            if (isAntesDoInicioBack) {
              const diasAutonomia = qtd_informada_caixa / monitoramentoAtual.posologia_diaria;
              dataFimEstimadaObj = new Date(dataInicioAtualObj.getTime());
              dataFimEstimadaObj.setDate(dataFimEstimadaObj.getDate() + Math.floor(diasAutonomia));
            } else {
              const diasAutonomia = qtd_informada_caixa / monitoramentoAtual.posologia_diaria;
              dataFimEstimadaObj = new Date(dataHoje.getTime());
              dataFimEstimadaObj.setDate(dataFimEstimadaObj.getDate() + Math.floor(diasAutonomia));
            }

            const dataInicioNova = new Date(proximaDataAdministracao.getTime());
            dataInicioNova.setHours(0, 0, 0, 0);
            const diffDays = (dataInicioNova - dataFimEstimadaObj) / (1000 * 60 * 60 * 24);

            if (diffDays <= 0) {
              sobraNoDiaDoInicio = Math.floor(Math.abs(diffDays) * monitoramentoAtual.posologia_diaria);
              if (sobraNoDiaDoInicio > qtd_informada_caixa) sobraNoDiaDoInicio = qtd_informada_caixa;
            } else { sobraNoDiaDoInicio = 0; }
          } else {
            if (monitoramentoAtual.data_calculada_fim_caixa) {
              const dataFimAtual = parseISO(monitoramentoAtual.data_calculada_fim_caixa);
              const dataInicioNova = new Date(proximaDataAdministracao.getTime());
              dataInicioNova.setHours(0, 0, 0, 0);
              if (dataFimAtual > dataInicioNova) {
                const diffDays = Math.floor((dataFimAtual - dataInicioNova) / (1000 * 60 * 60 * 24));
                sobraNoDiaDoInicio = diffDays * monitoramentoAtual.posologia_diaria;
              }
            }
          }
        }

        proximasCapsulasTotais = dados_nova_compra.total_capsulas_novas + sobraNoDiaDoInicio;
        const totalDiasDuracao = Math.floor(proximasCapsulasTotais / proximaPosologia);
        proximaDataFimCaixa = addDays(proximaDataAdministracao, totalDiasDuracao);

        if (dados_nova_compra.mudou_medicamento) {
          await HistoricoTrocaMedicamento.create({
            paciente_id: monitoramentoAtual.paciente_id, medicamento_antigo_id: dados_nova_compra.medicamento_atual.id,
            medicamento_novo_id: proximoMedicamentoId, data_troca: proximaDataEntrega, monitoramento_id: monitoramentoAtual.id
          });
        }
      }

      if (data_abertura_nova_caixa) {
        const dataProximoContatoEnviada = parseISO(data_abertura_nova_caixa);
        await MonitoramentoMedicamento.create({
          paciente_id: monitoramentoAtual.paciente_id, patient_evaluation_id: monitoramentoAtual.patient_evaluation_id,
          medicamento_id: proximoMedicamentoId, posologia_diaria: proximaPosologia, data_entrega: proximaDataEntrega,
          data_administracao: proximaDataAdministracao, data_calculada_fim_caixa: proximaDataFimCaixa, data_proximo_contato: dataProximoContatoEnviada,
          status: 'PENDENTE', qtd_caixas: proximasCaixas, qtd_total_capsulas: proximasCapsulasTotais, evento_externo_id: proximoEventoExternoId
        });
      }

      await AuditService.log(req.userId, 'Edição', 'Monitoramento', monitoramentoAtual.id, `Registrou contato. Compra aplicada: ${aplicar_nova_compra}`);
      return res.json({ message: 'Contato registrado e ciclo atualizado com sucesso!' });
    } catch (error) { return res.status(500).json({ error: 'Erro ao registrar contato', details: error.message }); }
  }

  // [VINCULAR AVALIAÇÃO, TIMELINE E INFORMAR ADMINISTRAÇÃO MANTIDOS INTACTOS]
  async timeline(req, res) {
    try {
      const operadoraQueryId = req.query.operadora_id;
      const permission = await getOperadoraFilter(req.userId, operadoraQueryId);
      if (!permission.authorized) return res.json([]);
      const monitoramentos = await MonitoramentoMedicamento.findAll({
        include: [
          { model: Pacientes, as: 'paciente', where: permission.whereClause, attributes: ['id', 'nome', 'sobrenome'] },
          { model: Medicamentos, as: 'medicamento', attributes: ['nome'] }
        ],
        order: [['createdAt', 'DESC']]
      });
      return res.json(monitoramentos);
    } catch (error) { return res.status(500).json({ error: 'Erro na timeline' }); }
  }

  async vincularAvaliacaoSilencioso(req, res) {
    const { paciente_id, patient_evaluation_id } = req.body;
    try {
      const [updatedRows] = await MonitoramentoMedicamento.update({ patient_evaluation_id }, { where: { paciente_id, status: 'PENDENTE' } });
      return res.status(200).json({ message: 'Vinculado.', registros_atualizados: updatedRows });
    } catch (error) { return res.status(500).json({ error: 'Erro ao vincular', details: error.message }); }
  }

  async informarDataAdministracao(req, res) {
    const { id } = req.params;
    const { data_administracao } = req.body;
    try {
      const monitoramento = await MonitoramentoMedicamento.findByPk(id);
      const dataAdminParsed = parseISO(data_administracao);
      const diasDuracao = Math.floor(monitoramento.qtd_total_capsulas / monitoramento.posologia_diaria);
      const novaDataFimCaixa = addDays(dataAdminParsed, diasDuracao);
      await monitoramento.update({ data_administracao: dataAdminParsed, data_calculada_fim_caixa: novaDataFimCaixa });
      return res.json({ message: 'Sucesso!', monitoramento });
    } catch (error) { return res.status(500).json({ error: 'Erro', details: error.message }); }
  }


  async verificarNovaCompra(req, res) {
    const { id } = req.params;
    try {
      const monitoramento = await MonitoramentoMedicamento.findByPk(id, {
        include: [
          { model: Pacientes, as: 'paciente', attributes: ['id', 'external_id', 'nome'] },
          { model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome', 'qtd_capsula'] }
        ]
      });

      if (!monitoramento || !monitoramento.evento_externo_id) return res.json({ novaCompraDetectada: false });

      // Busca os eventos desse paciente, do mais recente pro mais antigo
      const eventos = await EventosPaciente.findAll({
        where: { paciente_id: monitoramento.paciente.id },
        order: [['data_entrega_prevista', 'DESC']],
        include: [{ model: Medicamentos, as: 'medicamento' }]
      });

      if (eventos.length === 0) return res.json({ novaCompraDetectada: false });

      // Encontra o primeiro evento que não seja o mesmo do monitoramento atual
      const novoEvento = eventos.find(e => String(e.external_id) !== String(monitoramento.evento_externo_id));
      if (!novoEvento) return res.json({ novaCompraDetectada: false });

      // 👇 A MÁGICA ACONTECE AQUI: Prioriza a data real, com fallback para a prevista
      const dataReferenciaNovoEvento = novoEvento.data_entrega_real || novoEvento.data_entrega_prevista;

      if (dataReferenciaNovoEvento && monitoramento.data_entrega) {
        // Trata tanto se o Sequelize retornar uma string quanto um objeto Date
        const dataEntregaLocal = typeof monitoramento.data_entrega === 'string'
          ? monitoramento.data_entrega.split('T')[0]
          : monitoramento.data_entrega.toISOString().split('T')[0];

        // Compara usando a data correta
        if (dataReferenciaNovoEvento <= dataEntregaLocal) {
          return res.json({ novaCompraDetectada: false });
        }
      }

      const dataAdminExterna = novoEvento.data_administracao_prevista;
      const dataNovoInicio = dataAdminExterna ? addDays(parseISO(dataAdminExterna), 5) : null;

      let sobraComprimidos = 0;
      if (monitoramento.data_calculada_fim_caixa && dataNovoInicio) {
        const dataFimAtual = parseISO(monitoramento.data_calculada_fim_caixa);
        if (dataFimAtual > dataNovoInicio) {
          const diffDays = Math.max(0, Math.floor((dataFimAtual - dataNovoInicio) / (1000 * 60 * 60 * 24)));
          sobraComprimidos = diffDays * monitoramento.posologia_diaria;
        }
      }

      const totalCapsulasNovas = (novoEvento.medicamento.qtd_capsula || 0) * novoEvento.qtd_caixas;

      return res.json({
        novaCompraDetectada: true,
        detalhes: {
          evento_externo_id: novoEvento.external_id,
          // 👇 Envia para o frontend a mesma data de referência que validou o processo
          data_entrega: dataReferenciaNovoEvento, 
          data_previsao_administracao: dataAdminExterna,
          data_novo_inicio: dataNovoInicio,
          qtd_caixas: novoEvento.qtd_caixas,
          total_capsulas_novas: totalCapsulasNovas,
          sobra_comprimidos: sobraComprimidos,
          total_estoque_calculado: totalCapsulasNovas + sobraComprimidos,
          mudou_medicamento: monitoramento.medicamento_id !== novoEvento.medicamento_id,
          medicamento_novo: { id: novoEvento.medicamento_id, nome: novoEvento.medicamento.nome },
          medicamento_atual: { id: monitoramento.medicamento_id, nome: monitoramento.medicamento.nome }
        }
      });

    } catch (error) {
      console.error("ERRO NO VERIFICAR NOVA COMPRA:", error);
      return res.status(500).json({ error: 'Erro ao verificar nova compra.', details: error.message });
    }
  }

  async sincronizarEventoAtual(req, res) {
    const { id } = req.params;
    try {
      const monitoramento = await MonitoramentoMedicamento.findByPk(id, {
        include: [
          { model: Pacientes, as: 'paciente', attributes: ['id', 'external_id'] },
          { model: Medicamentos, as: 'medicamento', attributes: ['id', 'external_id', 'qtd_capsula'] }
        ]
      });

      if (!monitoramento || !monitoramento.evento_externo_id) return res.json({ atualizado: false });

      const eventoLocal = await EventosPaciente.findOne({
        where: { external_id: monitoramento.evento_externo_id },
        include: [{ model: Medicamentos, as: 'medicamento' }]
      });

      if (!eventoLocal) return res.json({ atualizado: false });

      let houveMudanca = false;
      let novoMedicamentoId = monitoramento.medicamento_id;

      // Verifica mudança de medicamento
      if (eventoLocal.medicamento_id !== monitoramento.medicamento_id) {
        houveMudanca = true;
        novoMedicamentoId = eventoLocal.medicamento_id;
      } else {
        // Verifica mudança silenciosa na quantidade de capsulas do medicamento local
        if (eventoLocal.medicamento.qtd_capsula !== monitoramento.medicamento.qtd_capsula) {
          houveMudanca = true;
        }
      }

      // Verifica se a quantidade de caixas mudou
      if (eventoLocal.qtd_caixas !== monitoramento.qtd_caixas) houveMudanca = true;

      if (!houveMudanca) return res.json({ atualizado: false });

      const novaQtdTotalCapsulas = (eventoLocal.medicamento.qtd_capsula || 0) * eventoLocal.qtd_caixas;

      let novaDataFimCaixa = monitoramento.data_calculada_fim_caixa;
      if (novaQtdTotalCapsulas > 0 && monitoramento.posologia_diaria > 0) {
        const diasDuracao = Math.floor(novaQtdTotalCapsulas / monitoramento.posologia_diaria);
        const baseDate = monitoramento.data_administracao || monitoramento.data_entrega || monitoramento.createdAt;
        novaDataFimCaixa = addDays(new Date(baseDate), diasDuracao);
      }

      await monitoramento.update({
        medicamento_id: novoMedicamentoId,
        qtd_caixas: eventoLocal.qtd_caixas,
        qtd_total_capsulas: novaQtdTotalCapsulas,
        data_calculada_fim_caixa: novaDataFimCaixa
      });

      const monitoramentoAtualizado = await MonitoramentoMedicamento.findByPk(id, {
        include: [{ model: Pacientes, as: 'paciente' }, { model: Medicamentos, as: 'medicamento' }]
      });

      return res.json({ atualizado: true, monitoramento: monitoramentoAtualizado });
    } catch (error) {
      console.error("ERRO AO SINCRONIZAR EVENTO ATUAL:", error);
      return res.status(500).json({ error: 'Erro ao sincronizar', details: error.message });
    }
  }

  async verificarSincronizacaoAtual(req, res) {
    const { id } = req.params;
    try {
      const monitoramento = await MonitoramentoMedicamento.findByPk(id, {
        include: [{ model: Medicamentos, as: 'medicamento' }]
      });

      if (!monitoramento || !monitoramento.evento_externo_id) return res.json({ requiresConfirmation: false });

      const eventoLocal = await EventosPaciente.findOne({
        where: { external_id: monitoramento.evento_externo_id },
        include: [{ model: Medicamentos, as: 'medicamento' }]
      });

      if (!eventoLocal) return res.json({ requiresConfirmation: false });

      let mudouMedicamento = eventoLocal.medicamento_id !== monitoramento.medicamento_id;
      let mudouQtd = eventoLocal.qtd_caixas !== monitoramento.qtd_caixas || eventoLocal.medicamento.qtd_capsula !== monitoramento.medicamento.qtd_capsula;

      if (mudouMedicamento || mudouQtd) {
        return res.json({
          requiresConfirmation: true,
          details: {
            medicamentoAntigo: monitoramento.medicamento.nome,
            medicamentoNovo: eventoLocal.medicamento.nome,
            novoMedicamentoId: eventoLocal.medicamento_id,
            qtdCaixasAntiga: monitoramento.qtd_caixas,
            qtdCaixasNova: eventoLocal.qtd_caixas,
            novaQtdCapsulaPorCaixa: eventoLocal.medicamento.qtd_capsula,
            mudouMedicamento: mudouMedicamento
          }
        });
      }

      return res.json({ requiresConfirmation: false });
    } catch (error) {
      console.error("ERRO AO VERIFICAR SINCRONIZAÇÃO ATUAL:", error);
      return res.status(500).json({ error: 'Erro ao verificar', details: error.message });
    }
  }

  async confirmarSincronizacaoAtual(req, res) {
    const { id } = req.params;
    const { novo_medicamento_id, nova_qtd_caixas, nova_qtd_capsula_por_caixa, mudou_medicamento } = req.body;

    try {
      const monitoramento = await MonitoramentoMedicamento.findByPk(id);
      if (!monitoramento) return res.status(404).json({ error: 'Monitoramento não encontrado' });

      const novaQtdTotalCapsulas = nova_qtd_capsula_por_caixa * nova_qtd_caixas;
      const updateData = {
        medicamento_id: novo_medicamento_id,
        qtd_caixas: nova_qtd_caixas,
        qtd_total_capsulas: novaQtdTotalCapsulas
      };

      if (mudou_medicamento) updateData.data_administracao = null;

      if (novaQtdTotalCapsulas > 0 && monitoramento.posologia_diaria > 0) {
        const diasDuracao = Math.floor(novaQtdTotalCapsulas / monitoramento.posologia_diaria);
        const baseDate = updateData.data_administracao === null ? monitoramento.data_entrega : (monitoramento.data_administracao || monitoramento.data_entrega);
        updateData.data_calculada_fim_caixa = addDays(new Date(baseDate), diasDuracao);
      }

      await monitoramento.update(updateData);

      const monitoramentoAtualizado = await MonitoramentoMedicamento.findByPk(id, {
        include: [
          { model: Pacientes, as: 'paciente', attributes: ['id', 'nome', 'sobrenome'] },
          { model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome', 'qtd_capsula'] },
          { model: PatientEvaluation, as: 'avaliacao', attributes: ['id', 'total_score'] }
        ]
      });

      return res.json({ monitoramento: monitoramentoAtualizado });
    } catch (error) { return res.status(500).json({ error: 'Erro ao aplicar atualização' }); }
  }

  async show(req, res) {
    const { id } = req.params;
    try {
      const monitoramento = await MonitoramentoMedicamento.findByPk(id, {
        include: [
          { model: Pacientes, as: 'paciente', attributes: ['id', 'nome', 'sobrenome'] },
          { model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome'] },
          { model: ReacaoAdversa, as: 'reacoesAdversas', through: { attributes: [] } }
        ]
      });
      if (!monitoramento) return res.status(404).json({ error: 'Não encontrado.' });
      const resposta = monitoramento.toJSON();
      resposta.reacoes_adversas = resposta.reacoesAdversas;
      return res.json(resposta);
    } catch (error) { return res.status(500).json({ error: 'Erro', details: error.message }); }
  }

  async updateRetroativo(req, res) {
    // [MANTIDO INTACTO]
    const schema = Yup.object().shape({
      qtd_informada_caixa: Yup.number().integer().nullable(),
      is_reacao: Yup.boolean().nullable(),
      reacoes_adversas: Yup.array().of(Yup.number().integer()).nullable(),
      observacao: Yup.string().nullable()
    });
    try { await schema.validate(req.body, { abortEarly: false }); } catch (err) { return res.status(400).json({ error: 'Falha na validação', messages: err.inner }); }

    const { id } = req.params;
    const { qtd_informada_caixa, is_reacao, reacoes_adversas, observacao } = req.body;

    try {
      const monitoramentoAtual = await MonitoramentoMedicamento.findByPk(id);
      if (!monitoramentoAtual) return res.status(404).json({ error: 'Monitoramento não encontrado.' });
      if (monitoramentoAtual.status !== 'CONCLUIDO') return res.status(400).json({ error: 'Apenas concluídos podem sofrer edição retroativa.' });

      await monitoramentoAtual.update({ qtd_informada_caixa, is_reacao, observacao });
      if (is_reacao && reacoes_adversas && reacoes_adversas.length > 0) await monitoramentoAtual.setReacoesAdversas(reacoes_adversas);
      else await monitoramentoAtual.setReacoesAdversas([]);

      await AuditService.log(req.userId, 'Edição Retroativa', 'Monitoramento', monitoramentoAtual.id, `Editou informações (ID: ${monitoramentoAtual.id}).`);
      return res.json({ message: 'Histórico de contato atualizado com sucesso!' });
    } catch (error) { return res.status(500).json({ error: 'Erro', details: error.message }); }
  }

  async historicoCompras(req, res) {
    try {
      const { id } = req.params;

      const monitoramento = await MonitoramentoMedicamento.findByPk(id);
      if (!monitoramento) {
        return res.status(404).json({ error: 'Monitoramento não encontrado.' });
      }

      const eventos = await EventosPaciente.findAll({
        where: { paciente_id: monitoramento.paciente_id },
        include: [
          { model: Pacientes, as: 'paciente', attributes: ['nome', 'sobrenome'] },
          { model: Medicamentos, as: 'medicamento', attributes: ['nome', 'qtd_capsula'] }
        ],
        order: [['data_entrega_prevista', 'DESC']]
      });

      return res.json(eventos);
    } catch (error) {
      console.error("Erro ao buscar histórico de compras:", error);
      return res.status(500).json({ error: 'Erro ao buscar histórico de compras.', details: error.message });
    }
  }
}

export default new MonitoramentoMedicamentoController();