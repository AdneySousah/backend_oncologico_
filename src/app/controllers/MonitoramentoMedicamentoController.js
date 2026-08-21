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


const ehSolicitandoUsoConjunto = (dadosNovaCompraCliente, modoNovoMedicamento) => {
  return !!(dadosNovaCompraCliente?.mudou_medicamento && modoNovoMedicamento === 'CONJUNTO');
};


const revalidarDadosNovaCompra = async (monitoramentoAtual, dadosNovaCompraCliente, modoNovoMedicamento, options = {}) => {
  if (!dadosNovaCompraCliente || !dadosNovaCompraCliente.evento_externo_id) {
    const erro = new Error('Dados da nova compra ausentes ou incompletos.');
    erro.status = 400;
    throw erro;
  }
  const evento = await EventosPaciente.findOne({
    where: {
      external_id: dadosNovaCompraCliente.evento_externo_id,
      paciente_id: monitoramentoAtual.paciente_id
    },
    include: [{ model: Medicamentos, as: 'medicamento' }],
    ...options
  });
  if (!evento) {
    const erro = new Error('O evento de compra informado não foi encontrado ou não pertence mais a este paciente. Atualize a tela e tente novamente.');
    erro.status = 409;
    throw erro;
  }

  const mudouMedicamento = evento.medicamento_id !== monitoramentoAtual.medicamento_id;
  const ehUsoConjunto = mudouMedicamento && modoNovoMedicamento === 'CONJUNTO';

  if (ehUsoConjunto) {
    let medicamentosDoGrupoIds = [monitoramentoAtual.medicamento_id];
    if (monitoramentoAtual.grupo_medicamentos_id) {
      const irmaos = await MonitoramentoMedicamento.findAll({
        where: {
          grupo_medicamentos_id: monitoramentoAtual.grupo_medicamentos_id,
          status: { [Op.notIn]: ['CANCELADO', 'DESCONTINUADO'] },
          id: { [Op.ne]: monitoramentoAtual.id }
        },
        ...options
      });
      medicamentosDoGrupoIds = [...new Set([monitoramentoAtual.medicamento_id, ...irmaos.map(i => i.medicamento_id)])];
    }
    if (medicamentosDoGrupoIds.length >= 2) {
      const erro = new Error('Este paciente já possui o número máximo de medicamentos em acompanhamento simultâneo. Não é possível aplicar como uso em conjunto.');
      erro.status = 409;
      throw erro;
    }
  }

  const totalCapsulasNovas = (evento.medicamento?.qtd_capsula || 0) * (evento.qtd_caixas || 1);

  return {
    mudouMedicamento,
    ehUsoConjunto,
    medicamentoNovoId: evento.medicamento_id,
    medicamentoAtualId: monitoramentoAtual.medicamento_id,
    qtdCaixas: evento.qtd_caixas || 1,
    totalCapsulasNovas,
    dataEntrega: evento.data_entrega_real || evento.data_entrega_prevista,
    eventoExternoId: evento.external_id
  };
};

// Mesma regra de +5 dias (pulando fim de semana) usada no front, para calcular
// a data do primeiro telemonitoramento de um medicamento adicional (uso conjunto)
const calcularDataTelemonitoramento = (dataBase) => {
  let data = addDays(dataBase, 5);
  const diaDaSemana = data.getDay();
  if (diaDaSemana === 6) data = addDays(data, 2);
  else if (diaDaSemana === 0) data = addDays(data, 1);

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  if (data < hoje) {
    return hoje;
  }
  return data;
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
          qtd_caixas: Yup.number().integer().nullable(),
          // 👇 NOVO: presente quando o medicamento vem de um candidato de
          // retomada detectado automaticamente. Se ausente (fluxo original de
          // onboarding), o comportamento continua igual ao de antes.
          evento_externo_id: Yup.number().integer().nullable()
        })
      ).min(1).max(2).required()
    });
    try { await schema.validate(req.body, { abortEarly: false }); }
    catch (err) { return res.status(400).json({ error: 'Falha na validação', messages: err.inner }); }

    const { paciente_id, patient_evaluation_id, medicamentos_confirmados } = req.body;

    try {
      // 👇 NOVO: impede criar um novo tratamento se o paciente já tiver
      // qualquer ciclo ativo. Sem essa trava, esse endpoint reaproveitado pra
      // retomada poderia, por engano ou corrida entre abas, criar um segundo
      // conjunto de ciclos por cima de um paciente já em acompanhamento.
      const pendenteExistente = await MonitoramentoMedicamento.findOne({
        where: { paciente_id, status: 'PENDENTE' }
      });
      if (pendenteExistente) {
        return res.status(409).json({ error: 'Este paciente já possui um tratamento ativo. Não é possível iniciar um novo agora.' });
      }

      const medicamentosCarregados = [];
      for (let item of medicamentos_confirmados) {
        const medicamento = await Medicamentos.findByPk(item.medicamento_id);
        if (!medicamento) return res.status(404).json({ error: `Medicamento não encontrado.` });
        const qtdPorCaixa = item.qtd_capsula_manual || medicamento.qtd_capsula;
        if (!qtdPorCaixa) {
          return res.status(400).json({
            error: 'MISSING_QTD_CAPSULA',
            needs_qtd_capsula: true,
            medicamento_id: medicamento.id,
            message: `Informe a quantidade total de comprimidos da caixa para ${medicamento.nome}.`
          });
        }

        // 👇 NOVO: se o front informou um evento específico (veio de um
        // candidato detectado), confirma que ele realmente existe e pertence
        // a este paciente+medicamento antes de usar como baseline — nunca
        // confia cegamente no id enviado. Se não bater (ou não foi enviado),
        // cai no comportamento original: pega o último evento conhecido.
        let eventoExternoIdBase = null;
        if (item.evento_externo_id) {
          const eventoInformado = await EventosPaciente.findOne({
            where: { external_id: item.evento_externo_id, paciente_id, medicamento_id: item.medicamento_id }
          });
          eventoExternoIdBase = eventoInformado ? eventoInformado.external_id : null;
        }
        if (!eventoExternoIdBase) {
          const ultimoEventoDesteMedicamento = await EventosPaciente.findOne({
            where: { paciente_id, medicamento_id: item.medicamento_id },
            order: [['external_id', 'DESC']]
          });
          eventoExternoIdBase = ultimoEventoDesteMedicamento ? ultimoEventoDesteMedicamento.external_id : null;
        }

        // 👇 NOVO: busca automática do ciclo descontinuado anterior deste
        // mesmo paciente+medicamento, se existir — é o que alimenta o vínculo
        // de retomada, sem o atendente precisar escolher nada.
        const cicloDescontinuadoAnterior = await MonitoramentoMedicamento.findOne({
          where: { paciente_id, medicamento_id: item.medicamento_id, status: 'DESCONTINUADO' },
          order: [['data_telemonitoramento_efetivado', 'DESC']]
        });

        medicamentosCarregados.push({
          item,
          medicamento,
          qtdPorCaixa,
          eventoExternoIdBase,
          retomadoDeId: cicloDescontinuadoAnterior ? cicloDescontinuadoAnterior.id : null
        });
      }

      const grupoMedicamentosId = medicamentos_confirmados.length > 1
        ? `grp-${paciente_id}-${Date.now()}`
        : null;

      const agendamentos = await MonitoramentoMedicamento.sequelize.transaction(async (transaction) => {
        const criados = [];
        for (let { item, medicamento, qtdPorCaixa, eventoExternoIdBase, retomadoDeId } of medicamentosCarregados) {
          if (item.qtd_capsula_manual && !medicamento.qtd_capsula) {
            await medicamento.update({ qtd_capsula: item.qtd_capsula_manual }, { transaction });
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
            evento_externo_id: eventoExternoIdBase,
            grupo_medicamentos_id: grupoMedicamentosId,
            retomado_de_monitoramento_id: retomadoDeId,
            status: 'PENDENTE'
          }, { transaction });

          criados.push(novoMonitoramento);
        }
        return criados;
      });

      return res.status(201).json(agendamentos);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao gerar monitoramento', details: error.message });
    }
  }
  async index(req, res) {
    try {
      const { operadora_id, page = 1, limit = 20, search = '', incluir_descontinuados } = req.query;
      const apenasDescontinuados = incluir_descontinuados === 'true' || incluir_descontinuados === true;
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

      // ==========================================================
      // Caminho ORIGINAL, 100% inalterado — pacientes com pelo menos um
      // registro PENDENTE. Continua sendo o padrão da tela.
      // ==========================================================
      if (!apenasDescontinuados) {
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
      }

      // ==========================================================
      // 👇 NOVO: filtro EXCLUSIVO — mostra só pacientes com acompanhamento
      // totalmente encerrado (zero registros PENDENTE, pelo menos um
      // DESCONTINUADO). Paginação por paciente, ordenado do mais
      // recentemente encerrado pro mais antigo.
      // ==========================================================
      const registrosPendentes = await MonitoramentoMedicamento.findAll({
        attributes: ['paciente_id'],
        where: { status: 'PENDENTE' },
        raw: true
      });
      const idsComPendente = [...new Set(registrosPendentes.map(p => p.paciente_id))];

      const descontinuados = await MonitoramentoMedicamento.findAll({
        attributes: ['paciente_id', 'data_telemonitoramento_efetivado', 'createdAt'],
        where: {
          status: 'DESCONTINUADO',
          paciente_id: idsComPendente.length > 0 ? { [Op.notIn]: idsComPendente } : { [Op.ne]: null }
        },
        include: [{
          model: Pacientes, as: 'paciente', attributes: [],
          where: pacienteWhere, required: true
        }],
        raw: true
      });

      const dataMaisRecentePorPaciente = {};
      descontinuados.forEach(r => {
        const referencia = r.data_telemonitoramento_efetivado || r.createdAt;
        const data = new Date(referencia).getTime();
        const atual = dataMaisRecentePorPaciente[r.paciente_id];
        if (atual === undefined || data > atual) dataMaisRecentePorPaciente[r.paciente_id] = data;
      });

      const idsOrdenados = Object.keys(dataMaisRecentePorPaciente)
        .map(Number)
        .sort((a, b) => dataMaisRecentePorPaciente[b] - dataMaisRecentePorPaciente[a]);

      const total = idsOrdenados.length;
      if (total === 0) return res.json({ data: [], total: 0, totalPages: 0, currentPage: parseInt(page) });

      const idsDaPagina = idsOrdenados.slice(offset, offset + parseInt(limit));

      const allRecordsForPage = await MonitoramentoMedicamento.findAll({
        where: { paciente_id: { [Op.in]: idsDaPagina }, status: { [Op.ne]: 'CANCELADO' } },
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

      return res.json({ data: allRecordsForPage, total, totalPages: Math.ceil(total / parseInt(limit)), currentPage: parseInt(page) });
    } catch (error) { return res.status(500).json({ error: 'Erro ao buscar monitoramentos.', details: error.message }); }
  }

  async update(req, res) {
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
      posologia_nova_caixa: Yup.number().integer().nullable(),
      mudou_posologia: Yup.boolean().nullable(),
      nova_posologia: Yup.number().integer().nullable(),
      data_mudanca_posologia: Yup.date().nullable(),
      motivo_falha_contato_id: Yup.number().integer().nullable(),
      modo_novo_medicamento: Yup.string().oneOf(['CONJUNTO', 'SUBSTITUICAO']).nullable(),
      // 👇 NOVO
      descontinuar_medicamento: Yup.boolean().nullable(),
      motivo_encerramento: Yup.string().nullable()
    });
    try { await schema.validate(req.body, { abortEarly: false }); }
    catch (err) { return res.status(400).json({ error: 'Falha na validação', messages: err.inner }); }

    const { id } = req.params;
    const {
      contato_efetivo, nivel_adesao, qtd_informada_caixa, data_abertura_nova_caixa,
      is_reacao, reacoes_adversas, observacao, aplicar_nova_compra, dados_nova_compra,
      data_inicio_nova_caixa, posologia_nova_caixa,
      mudou_posologia, nova_posologia, data_mudanca_posologia,
      motivo_falha_contato_id,
      modo_novo_medicamento,
      descontinuar_medicamento, // 👈 NOVO
      motivo_encerramento // 👈 NOVO
    } = req.body;

    if (descontinuar_medicamento && aplicar_nova_compra) {
      return res.status(400).json({ error: 'Não é possível descontinuar o medicamento e aplicar uma nova compra ao mesmo tempo.' });
    }
    if (contato_efetivo !== false && !descontinuar_medicamento && aplicar_nova_compra && ehSolicitandoUsoConjunto(dados_nova_compra, modo_novo_medicamento)) {
      if (!data_inicio_nova_caixa || !posologia_nova_caixa) {
        return res.status(400).json({ error: 'Data de início e posologia do medicamento adicional são obrigatórias para uso em conjunto.' });
      }
    }

    try {
      const resultado = await MonitoramentoMedicamento.sequelize.transaction(async (transaction) => {
        const monitoramentoAtual = await MonitoramentoMedicamento.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!monitoramentoAtual) {
          const erro = new Error('Monitoramento não encontrado.');
          erro.status = 404;
          throw erro;
        }

        // ---- Contato NÃO efetivado ----
        if (contato_efetivo === false) {
          await monitoramentoAtual.update({
            contato_efetivo,
            nivel_adesao: null,
            qtd_informada_caixa,
            data_abertura_nova_caixa,
            is_reacao: false,
            status: 'CONCLUIDO',
            observacao,
            data_telemonitoramento_efetivado: new Date(),
            mudou_posologia: false,
            nova_posologia: null,
            data_mudanca_posologia: null,
            motivo_falha_contato_id
          }, { transaction });
          await monitoramentoAtual.setReacoesAdversas([], { transaction });

          const proximaData = obterProximoDiaUtil(new Date());
          await MonitoramentoMedicamento.create({
            paciente_id: monitoramentoAtual.paciente_id, patient_evaluation_id: monitoramentoAtual.patient_evaluation_id,
            medicamento_id: monitoramentoAtual.medicamento_id, posologia_diaria: monitoramentoAtual.posologia_diaria,
            data_entrega: monitoramentoAtual.data_entrega, data_administracao: monitoramentoAtual.data_administracao,
            data_calculada_fim_caixa: monitoramentoAtual.data_calculada_fim_caixa, data_proximo_contato: proximaData,
            status: 'PENDENTE', qtd_caixas: monitoramentoAtual.qtd_caixas, qtd_total_capsulas: monitoramentoAtual.qtd_total_capsulas,
            evento_externo_id: monitoramentoAtual.evento_externo_id,
            grupo_medicamentos_id: monitoramentoAtual.grupo_medicamentos_id
          }, { transaction });

          return { mensagem: 'Contato sem sucesso. Reagendado para o próximo dia útil.' };
        }

        // ---- 👇 NOVO: Descontinuar medicamento — fecha o registro e NÃO cria próximo ciclo ----
        if (descontinuar_medicamento) {
          await monitoramentoAtual.update({
            contato_efetivo,
            nivel_adesao,
            qtd_informada_caixa,
            is_reacao,
            status: 'DESCONTINUADO',
            observacao,
            data_telemonitoramento_efetivado: new Date(),
            motivo_encerramento: motivo_encerramento || null,
            motivo_falha_contato_id: null,
            data_abertura_nova_caixa: null
          }, { transaction });

          if (is_reacao && reacoes_adversas && reacoes_adversas.length > 0) {
            await monitoramentoAtual.setReacoesAdversas(reacoes_adversas, { transaction });
          } else {
            await monitoramentoAtual.setReacoesAdversas([], { transaction });
          }

          await AuditService.log(req.userId, 'Edição', 'Monitoramento', monitoramentoAtual.id, `Medicamento descontinuado. Motivo: ${motivo_encerramento || 'não informado'}.`);

          return { mensagem: 'Medicamento descontinuado com sucesso. Nenhum novo ciclo será agendado.' };
        }

        // ---- Revalida a nova compra contra o banco ----
        let compraRevalidada = null;
        if (aplicar_nova_compra) {
          compraRevalidada = await revalidarDadosNovaCompra(monitoramentoAtual, dados_nova_compra, modo_novo_medicamento, { transaction });
        }
        const ehUsoConjunto = !!(compraRevalidada && compraRevalidada.ehUsoConjunto);

        let grupoMedicamentosId = monitoramentoAtual.grupo_medicamentos_id;
        if (ehUsoConjunto && !grupoMedicamentosId) {
          grupoMedicamentosId = `grp-${monitoramentoAtual.paciente_id}-${Date.now()}`;
        }

        await monitoramentoAtual.update({
          contato_efetivo,
          nivel_adesao,
          qtd_informada_caixa,
          data_abertura_nova_caixa,
          is_reacao,
          status: 'CONCLUIDO',
          observacao,
          data_telemonitoramento_efetivado: new Date(),
          mudou_posologia: mudou_posologia || false,
          nova_posologia: mudou_posologia ? nova_posologia : null,
          data_mudanca_posologia: mudou_posologia ? data_mudanca_posologia : null,
          motivo_falha_contato_id: null,
          grupo_medicamentos_id: grupoMedicamentosId
        }, { transaction });

        if (is_reacao && reacoes_adversas && reacoes_adversas.length > 0) {
          await monitoramentoAtual.setReacoesAdversas(reacoes_adversas, { transaction });
        } else {
          await monitoramentoAtual.setReacoesAdversas([], { transaction });
        }

        let proximoMedicamentoId = monitoramentoAtual.medicamento_id;
        let proximasCaixas = monitoramentoAtual.qtd_caixas;
        let proximasCapsulasTotais = monitoramentoAtual.qtd_total_capsulas;
        let proximaDataEntrega = monitoramentoAtual.data_entrega;
        let proximaDataFimCaixa = monitoramentoAtual.data_calculada_fim_caixa;
        let proximaDataAdministracao = monitoramentoAtual.data_administracao;
        let proximoEventoExternoId = monitoramentoAtual.evento_externo_id;
        let proximaPosologia = (mudou_posologia && nova_posologia) ? nova_posologia : monitoramentoAtual.posologia_diaria;

        if (qtd_informada_caixa != null && proximaPosologia > 0) {
          const diasRestantes = Math.floor(qtd_informada_caixa / proximaPosologia);
          proximaDataFimCaixa = addDays(new Date(), diasRestantes);
          proximaDataAdministracao = new Date();
          proximasCapsulasTotais = qtd_informada_caixa;
        }

        if (aplicar_nova_compra && compraRevalidada && !ehUsoConjunto) {
          proximoMedicamentoId = compraRevalidada.medicamentoNovoId;
          proximasCaixas = compraRevalidada.qtdCaixas;
          proximaDataEntrega = parseISO(compraRevalidada.dataEntrega);
          proximoEventoExternoId = compraRevalidada.eventoExternoId;
          proximaPosologia = posologia_nova_caixa || monitoramentoAtual.posologia_diaria;
          proximaDataAdministracao = data_inicio_nova_caixa ? parseISO(data_inicio_nova_caixa) : proximaDataAdministracao;
          proximasCapsulasTotais = compraRevalidada.totalCapsulasNovas;
          const totalDiasDuracao = Math.floor(proximasCapsulasTotais / proximaPosologia);
          proximaDataFimCaixa = addDays(proximaDataAdministracao, totalDiasDuracao);

          if (compraRevalidada.mudouMedicamento) {
            await HistoricoTrocaMedicamento.create({
              paciente_id: monitoramentoAtual.paciente_id,
              medicamento_antigo_id: compraRevalidada.medicamentoAtualId,
              medicamento_novo_id: proximoMedicamentoId,
              data_troca: proximaDataEntrega,
              monitoramento_id: monitoramentoAtual.id
            }, { transaction });
          }
        }

        if (data_abertura_nova_caixa) {
          const dataProximoContatoEnviada = parseISO(data_abertura_nova_caixa);
          await MonitoramentoMedicamento.create({
            paciente_id: monitoramentoAtual.paciente_id, patient_evaluation_id: monitoramentoAtual.patient_evaluation_id,
            medicamento_id: proximoMedicamentoId, posologia_diaria: proximaPosologia, data_entrega: proximaDataEntrega,
            data_administracao: proximaDataAdministracao, data_calculada_fim_caixa: proximaDataFimCaixa, data_proximo_contato: dataProximoContatoEnviada,
            status: 'PENDENTE', qtd_caixas: proximasCaixas, qtd_total_capsulas: proximasCapsulasTotais, evento_externo_id: proximoEventoExternoId,
            grupo_medicamentos_id: grupoMedicamentosId
          }, { transaction });
        }

        if (ehUsoConjunto) {
          if (!data_inicio_nova_caixa || !posologia_nova_caixa) {
            const erro = new Error('Data de início e posologia do medicamento adicional são obrigatórias para uso em conjunto.');
            erro.status = 400;
            throw erro;
          }
          const dataAdministracaoNovoMed = parseISO(data_inicio_nova_caixa);
          const totalCapsulasNovoMed = compraRevalidada.totalCapsulasNovas;
          const diasDuracaoNovoMed = Math.floor(totalCapsulasNovoMed / posologia_nova_caixa);
          const dataFimCaixaNovoMed = addDays(dataAdministracaoNovoMed, diasDuracaoNovoMed);
          const dataProximoContatoNovoMed = calcularDataTelemonitoramento(dataAdministracaoNovoMed);

          await MonitoramentoMedicamento.create({
            paciente_id: monitoramentoAtual.paciente_id,
            patient_evaluation_id: monitoramentoAtual.patient_evaluation_id,
            medicamento_id: compraRevalidada.medicamentoNovoId,
            posologia_diaria: posologia_nova_caixa,
            data_entrega: parseISO(compraRevalidada.dataEntrega),
            data_administracao: dataAdministracaoNovoMed,
            data_calculada_fim_caixa: dataFimCaixaNovoMed,
            data_proximo_contato: dataProximoContatoNovoMed,
            status: 'PENDENTE',
            qtd_caixas: compraRevalidada.qtdCaixas,
            qtd_total_capsulas: totalCapsulasNovoMed,
            evento_externo_id: compraRevalidada.eventoExternoId,
            grupo_medicamentos_id: grupoMedicamentosId
          }, { transaction });
        }

        await AuditService.log(req.userId, 'Edição', 'Monitoramento', monitoramentoAtual.id, `Registrou contato. Mudou posologia: ${mudou_posologia}. Uso em conjunto: ${ehUsoConjunto}`);

        return { mensagem: 'Contato registrado e ciclo atualizado com sucesso!' };
      });

      return res.json({ message: resultado.mensagem });
    } catch (error) {
      const status = error.status || 500;
      return res.status(status).json({ error: status === 500 ? 'Erro ao registrar contato' : error.message, details: error.message });
    }
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
    const { excluir_eventos } = req.query;
    const eventosExcluidos = excluir_eventos
      ? String(excluir_eventos).split(',').map(v => parseInt(v, 10)).filter(v => !isNaN(v))
      : [];
    try {
      const monitoramento = await MonitoramentoMedicamento.findByPk(id, {
        include: [
          { model: Pacientes, as: 'paciente', attributes: ['id', 'external_id', 'nome'] },
          { model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome', 'qtd_capsula'] }
        ]
      });
      if (!monitoramento || !monitoramento.evento_externo_id) return res.json({ novaCompraDetectada: false });

      let medicamentosDoGrupoIds = [monitoramento.medicamento_id];
      if (monitoramento.grupo_medicamentos_id) {
        const irmaos = await MonitoramentoMedicamento.findAll({
          where: {
            grupo_medicamentos_id: monitoramento.grupo_medicamentos_id,
            status: { [Op.notIn]: ['CANCELADO', 'DESCONTINUADO'] },
            id: { [Op.ne]: monitoramento.id }
          }
        });
        medicamentosDoGrupoIds = [...new Set([monitoramento.medicamento_id, ...irmaos.map(i => i.medicamento_id)])];
      }

      // 👇 CORREÇÃO: ordem ASC (mais antigo primeiro), pra nunca pular
      // silenciosamente um evento intermediário que ainda não foi aplicado.
      const eventos = await EventosPaciente.findAll({
        where: { paciente_id: monitoramento.paciente.id, recebido: true },
        order: [['external_id', 'ASC']],
        include: [{ model: Medicamentos, as: 'medicamento' }]
      });
      if (eventos.length === 0) return res.json({ novaCompraDetectada: false });

      const eventoAtualId = parseInt(monitoramento.evento_externo_id, 10);

      const candidatosMesmoMedicamento = eventos.filter(e => {
        const extId = parseInt(e.external_id, 10);
        return extId > eventoAtualId && e.medicamento_id === monitoramento.medicamento_id && !eventosExcluidos.includes(extId);
      });
      const candidatosMedicamentoDiferente = eventos.filter(e => {
        const extId = parseInt(e.external_id, 10);
        return extId > eventoAtualId && !medicamentosDoGrupoIds.includes(e.medicamento_id) && !eventosExcluidos.includes(extId);
      });
      // Como 'eventos' está em ordem ASC, o primeiro item de cada lista já é o mais antigo pendente daquele tipo.
      const novoEventoMesmoMedicamento = candidatosMesmoMedicamento[0] || null;
      const novoEventoMedicamentoDiferente = candidatosMedicamentoDiferente[0] || null;

      let novoEvento = null;
      let ehMedicamentoDiferente = false;
      if (novoEventoMesmoMedicamento && novoEventoMedicamentoDiferente) {
        const idA = parseInt(novoEventoMesmoMedicamento.external_id, 10);
        const idB = parseInt(novoEventoMedicamentoDiferente.external_id, 10);
        // Processa sempre o evento cronologicamente mais antigo entre os dois tipos.
        novoEvento = idA <= idB ? novoEventoMesmoMedicamento : novoEventoMedicamentoDiferente;
        ehMedicamentoDiferente = novoEvento === novoEventoMedicamentoDiferente;
      } else if (novoEventoMedicamentoDiferente) {
        novoEvento = novoEventoMedicamentoDiferente;
        ehMedicamentoDiferente = true;
      } else if (novoEventoMesmoMedicamento) {
        novoEvento = novoEventoMesmoMedicamento;
        ehMedicamentoDiferente = false;
      }
      if (!novoEvento) return res.json({ novaCompraDetectada: false });

      const dataReferenciaNovoEvento = novoEvento.data_entrega_real || novoEvento.data_entrega_prevista;
      const dataAdminExterna = novoEvento.data_administracao_prevista;
      const dataNovoInicio = dataAdminExterna ? addDays(parseISO(dataAdminExterna), 5) : null;
      const totalCapsulasNovas = (novoEvento.medicamento.qtd_capsula || 0) * novoEvento.qtd_caixas;
      const podeSerConjunto = ehMedicamentoDiferente && medicamentosDoGrupoIds.length < 2;

      return res.json({
        novaCompraDetectada: true,
        detalhes: {
          evento_externo_id: novoEvento.external_id,
          data_entrega: dataReferenciaNovoEvento,
          data_previsao_administracao: dataAdminExterna,
          data_novo_inicio: dataNovoInicio,
          qtd_caixas: novoEvento.qtd_caixas,
          total_capsulas_novas: totalCapsulasNovas,
          sobra_comprimidos: 0,
          total_estoque_calculado: totalCapsulasNovas,
          mudou_medicamento: ehMedicamentoDiferente,
          pode_ser_conjunto: podeSerConjunto,
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
        order: [['external_id', 'DESC']]
      });

      return res.json(eventos);
    } catch (error) {
      console.error("Erro ao buscar histórico de compras:", error);
      return res.status(500).json({ error: 'Erro ao buscar histórico de compras.', details: error.message });
    }
  }

  async historicoAberturas(req, res) {
    try {
      const { id } = req.params;

      const monitoramentoAtual = await MonitoramentoMedicamento.findByPk(id);
      if (!monitoramentoAtual) {
        return res.status(404).json({ error: 'Monitoramento não encontrado.' });
      }

      // Busca todos os monitoramentos do paciente que tenham a data de administração preenchida ou evento vinculado
      const historico = await MonitoramentoMedicamento.findAll({
        where: {
          paciente_id: monitoramentoAtual.paciente_id,
          evento_externo_id: { [Op.not]: null }
        },
        include: [
          { model: Medicamentos, as: 'medicamento', attributes: ['nome'] }
        ],
        attributes: ['id', 'evento_externo_id', 'data_administracao', 'createdAt'],
        order: [['data_administracao', 'DESC NULLS LAST'], ['createdAt', 'DESC']]
      });

      return res.json(historico);
    } catch (error) {
      console.error("Erro ao buscar histórico de aberturas:", error);
      return res.status(500).json({ error: 'Erro ao buscar histórico de aberturas.', details: error.message });
    }
  }



  async registrarContatoConjunto(req, res) {
    const schema = Yup.object().shape({
      grupo_medicamentos_id: Yup.string().nullable(),
      contato_efetivo: Yup.boolean().required(),
      data_proximo_contato: Yup.date().nullable(),
      motivo_falha_contato_id: Yup.number().integer().nullable(),
      registros: Yup.array().of(
        Yup.object().shape({
          monitoramento_id: Yup.number().integer().required(),
          qtd_informada_caixa: Yup.number().integer().nullable(),
          nivel_adesao: Yup.string().oneOf(['COMPLETAMENTE', 'PARCIALMENTE', 'NAO_ADERE']).nullable(),
          is_reacao: Yup.boolean().nullable(),
          reacoes_adversas: Yup.array().of(Yup.number().integer()).nullable(),
          observacao: Yup.string().nullable(),
          mudou_posologia: Yup.boolean().nullable(),
          nova_posologia: Yup.number().integer().nullable(),
          data_mudanca_posologia: Yup.date().nullable(),
          aplicar_nova_compra: Yup.boolean().nullable(),
          dados_nova_compra: Yup.object().nullable(),
          data_inicio_nova_caixa: Yup.date().nullable(),
          posologia_nova_caixa: Yup.number().integer().nullable(),
          modo_novo_medicamento: Yup.string().oneOf(['CONJUNTO', 'SUBSTITUICAO']).nullable(),
          // 👇 NOVO
          descontinuar_medicamento: Yup.boolean().nullable(),
          motivo_encerramento: Yup.string().nullable()
        })
      ).min(1).required()
    });
    try { await schema.validate(req.body, { abortEarly: false }); }
    catch (err) { return res.status(400).json({ error: 'Falha na validação', messages: err.inner }); }

    const { contato_efetivo, data_proximo_contato, motivo_falha_contato_id, registros } = req.body;

    if (contato_efetivo) {
      const todosDescontinuados = registros.every(r => r.descontinuar_medicamento);
      if (!todosDescontinuados && !data_proximo_contato) {
        return res.status(400).json({ error: 'Data do próximo contato é obrigatória.' });
      }
      for (const registro of registros) {
        if (registro.descontinuar_medicamento && registro.aplicar_nova_compra) {
          return res.status(400).json({ error: 'Não é possível descontinuar um medicamento e aplicar uma nova compra para ele ao mesmo tempo.' });
        }
        if (!registro.descontinuar_medicamento && registro.aplicar_nova_compra && ehSolicitandoUsoConjunto(registro.dados_nova_compra, registro.modo_novo_medicamento)) {
          if (!registro.data_inicio_nova_caixa || !registro.posologia_nova_caixa) {
            return res.status(400).json({ error: 'Data de início e posologia do medicamento adicional são obrigatórias para uso em conjunto.' });
          }
        }
      }
    }

    try {
      const resultado = await MonitoramentoMedicamento.sequelize.transaction(async (transaction) => {
        const agora = new Date();

        if (contato_efetivo === false) {
          for (const registro of registros) {
            const monitoramentoAtual = await MonitoramentoMedicamento.findByPk(registro.monitoramento_id, { transaction, lock: transaction.LOCK.UPDATE });
            if (!monitoramentoAtual) continue;
            await monitoramentoAtual.update({
              contato_efetivo: false,
              nivel_adesao: null,
              status: 'CONCLUIDO',
              data_telemonitoramento_efetivado: agora,
              motivo_falha_contato_id: motivo_falha_contato_id || null
            }, { transaction });

            const proximaData = obterProximoDiaUtil(new Date());
            await MonitoramentoMedicamento.create({
              paciente_id: monitoramentoAtual.paciente_id,
              patient_evaluation_id: monitoramentoAtual.patient_evaluation_id,
              medicamento_id: monitoramentoAtual.medicamento_id,
              posologia_diaria: monitoramentoAtual.posologia_diaria,
              data_entrega: monitoramentoAtual.data_entrega,
              data_administracao: monitoramentoAtual.data_administracao,
              data_calculada_fim_caixa: monitoramentoAtual.data_calculada_fim_caixa,
              data_proximo_contato: proximaData,
              status: 'PENDENTE',
              qtd_caixas: monitoramentoAtual.qtd_caixas,
              qtd_total_capsulas: monitoramentoAtual.qtd_total_capsulas,
              evento_externo_id: monitoramentoAtual.evento_externo_id,
              grupo_medicamentos_id: monitoramentoAtual.grupo_medicamentos_id
            }, { transaction });
          }
          return { mensagem: 'Contato sem sucesso. Ambos os medicamentos foram reagendados para o próximo dia útil.', registros: [] };
        }

        const dataProximoContatoCompartilhada = data_proximo_contato ? parseISO(data_proximo_contato) : null;

        const monitoramentosCarregados = [];
        for (const registro of registros) {
          const monitoramentoAtual = await MonitoramentoMedicamento.findByPk(registro.monitoramento_id, { transaction, lock: transaction.LOCK.UPDATE });
          if (!monitoramentoAtual) {
            const erro = new Error(`Monitoramento ${registro.monitoramento_id} não encontrado.`);
            erro.status = 404;
            throw erro;
          }
          monitoramentosCarregados.push({ registro, monitoramentoAtual });
        }

        let grupoMedicamentosId = monitoramentosCarregados
          .map(m => m.monitoramentoAtual.grupo_medicamentos_id)
          .find(Boolean) || `grp-${monitoramentosCarregados[0].monitoramentoAtual.paciente_id}-${Date.now()}`;

        const resultados = [];
        for (const { registro, monitoramentoAtual } of monitoramentosCarregados) {
          const {
            qtd_informada_caixa, nivel_adesao, is_reacao, reacoes_adversas, observacao,
            mudou_posologia, nova_posologia, data_mudanca_posologia,
            aplicar_nova_compra, dados_nova_compra, data_inicio_nova_caixa, posologia_nova_caixa, modo_novo_medicamento,
            descontinuar_medicamento, motivo_encerramento // 👈 NOVO
          } = registro;

          // ---- 👇 NOVO: descontinuar este medicamento específico ----
          if (descontinuar_medicamento) {
            await monitoramentoAtual.update({
              contato_efetivo: true,
              nivel_adesao,
              qtd_informada_caixa,
              is_reacao,
              status: 'DESCONTINUADO',
              observacao,
              data_telemonitoramento_efetivado: agora,
              motivo_encerramento: motivo_encerramento || null,
              grupo_medicamentos_id: grupoMedicamentosId
            }, { transaction });

            if (is_reacao && reacoes_adversas && reacoes_adversas.length > 0) {
              await monitoramentoAtual.setReacoesAdversas(reacoes_adversas, { transaction });
            } else {
              await monitoramentoAtual.setReacoesAdversas([], { transaction });
            }
            resultados.push(monitoramentoAtual);
            continue; // não cria próximo ciclo pra este medicamento
          }

          let compraRevalidada = null;
          if (aplicar_nova_compra) {
            compraRevalidada = await revalidarDadosNovaCompra(monitoramentoAtual, dados_nova_compra, modo_novo_medicamento, { transaction });
          }
          const ehUsoConjunto = !!(compraRevalidada && compraRevalidada.ehUsoConjunto);

          await monitoramentoAtual.update({
            contato_efetivo: true,
            nivel_adesao,
            qtd_informada_caixa,
            data_abertura_nova_caixa: data_proximo_contato,
            is_reacao,
            status: 'CONCLUIDO',
            observacao,
            data_telemonitoramento_efetivado: agora,
            mudou_posologia: mudou_posologia || false,
            nova_posologia: mudou_posologia ? nova_posologia : null,
            data_mudanca_posologia: mudou_posologia ? data_mudanca_posologia : null,
            grupo_medicamentos_id: grupoMedicamentosId
          }, { transaction });

          if (is_reacao && reacoes_adversas && reacoes_adversas.length > 0) {
            await monitoramentoAtual.setReacoesAdversas(reacoes_adversas, { transaction });
          } else {
            await monitoramentoAtual.setReacoesAdversas([], { transaction });
          }

          let proximoMedicamentoId = monitoramentoAtual.medicamento_id;
          let proximasCaixas = monitoramentoAtual.qtd_caixas;
          let proximasCapsulasTotais = monitoramentoAtual.qtd_total_capsulas;
          let proximaDataEntrega = monitoramentoAtual.data_entrega;
          let proximaDataFimCaixa = monitoramentoAtual.data_calculada_fim_caixa;
          let proximaDataAdministracao = monitoramentoAtual.data_administracao;
          let proximoEventoExternoId = monitoramentoAtual.evento_externo_id;
          let proximaPosologia = (mudou_posologia && nova_posologia) ? nova_posologia : monitoramentoAtual.posologia_diaria;

          if (qtd_informada_caixa != null && proximaPosologia > 0) {
            const diasRestantes = Math.floor(qtd_informada_caixa / proximaPosologia);
            proximaDataFimCaixa = addDays(new Date(), diasRestantes);
            proximaDataAdministracao = new Date();
            proximasCapsulasTotais = qtd_informada_caixa;
          }

          if (aplicar_nova_compra && compraRevalidada && !ehUsoConjunto) {
            proximoMedicamentoId = compraRevalidada.medicamentoNovoId;
            proximasCaixas = compraRevalidada.qtdCaixas;
            proximaDataEntrega = parseISO(compraRevalidada.dataEntrega);
            proximoEventoExternoId = compraRevalidada.eventoExternoId;
            proximaPosologia = posologia_nova_caixa || monitoramentoAtual.posologia_diaria;
            proximaDataAdministracao = data_inicio_nova_caixa ? parseISO(data_inicio_nova_caixa) : proximaDataAdministracao;
            proximasCapsulasTotais = compraRevalidada.totalCapsulasNovas;
            const totalDiasDuracao = Math.floor(proximasCapsulasTotais / proximaPosologia);
            proximaDataFimCaixa = addDays(proximaDataAdministracao, totalDiasDuracao);

            if (compraRevalidada.mudouMedicamento) {
              await HistoricoTrocaMedicamento.create({
                paciente_id: monitoramentoAtual.paciente_id,
                medicamento_antigo_id: compraRevalidada.medicamentoAtualId,
                medicamento_novo_id: proximoMedicamentoId,
                data_troca: proximaDataEntrega,
                monitoramento_id: monitoramentoAtual.id
              }, { transaction });
            }
          }

          const novoRegistro = await MonitoramentoMedicamento.create({
            paciente_id: monitoramentoAtual.paciente_id,
            patient_evaluation_id: monitoramentoAtual.patient_evaluation_id,
            medicamento_id: proximoMedicamentoId,
            posologia_diaria: proximaPosologia,
            data_entrega: proximaDataEntrega,
            data_administracao: proximaDataAdministracao,
            data_calculada_fim_caixa: proximaDataFimCaixa,
            data_proximo_contato: dataProximoContatoCompartilhada,
            status: 'PENDENTE',
            qtd_caixas: proximasCaixas,
            qtd_total_capsulas: proximasCapsulasTotais,
            evento_externo_id: proximoEventoExternoId,
            grupo_medicamentos_id: grupoMedicamentosId
          }, { transaction });

          if (ehUsoConjunto) {
            if (!data_inicio_nova_caixa || !posologia_nova_caixa) {
              const erro = new Error('Data de início e posologia do medicamento adicional são obrigatórias para uso em conjunto.');
              erro.status = 400;
              throw erro;
            }
            const dataAdministracaoNovoMed = parseISO(data_inicio_nova_caixa);
            const totalCapsulasNovoMed = compraRevalidada.totalCapsulasNovas;
            const diasDuracaoNovoMed = Math.floor(totalCapsulasNovoMed / posologia_nova_caixa);
            const dataFimCaixaNovoMed = addDays(dataAdministracaoNovoMed, diasDuracaoNovoMed);

            await MonitoramentoMedicamento.create({
              paciente_id: monitoramentoAtual.paciente_id,
              patient_evaluation_id: monitoramentoAtual.patient_evaluation_id,
              medicamento_id: compraRevalidada.medicamentoNovoId,
              posologia_diaria: posologia_nova_caixa,
              data_entrega: parseISO(compraRevalidada.dataEntrega),
              data_administracao: dataAdministracaoNovoMed,
              data_calculada_fim_caixa: dataFimCaixaNovoMed,
              data_proximo_contato: calcularDataTelemonitoramento(dataAdministracaoNovoMed),
              status: 'PENDENTE',
              qtd_caixas: compraRevalidada.qtdCaixas,
              qtd_total_capsulas: totalCapsulasNovoMed,
              evento_externo_id: compraRevalidada.eventoExternoId,
              grupo_medicamentos_id: grupoMedicamentosId
            }, { transaction });
          }

          resultados.push(novoRegistro);
        }

        await AuditService.log(
          req.userId, 'Edição', 'Monitoramento', null,
          `Registrou contato em conjunto para o grupo ${grupoMedicamentosId}. Data do próximo contato: ${data_proximo_contato || 'N/A (medicamentos descontinuados)'}`
        );

        return { mensagem: 'Contato registrado para os dois medicamentos com sucesso!', registros: resultados };
      });

      return res.json({ message: resultado.mensagem, registros: resultado.registros });
    } catch (error) {
      const status = error.status || 500;
      return res.status(status).json({ error: status === 500 ? 'Erro ao registrar contato em conjunto' : error.message, details: error.message });
    }
  }

  async candidatosRetomada(req, res) {
    const { paciente_ids } = req.query;
    if (!paciente_ids) return res.json({ candidatos: {} });
    const idsArray = String(paciente_ids).split(',').map(v => parseInt(v, 10)).filter(v => !isNaN(v));
    if (idsArray.length === 0) return res.json({ candidatos: {} });

    try {
      const eventos = await EventosPaciente.findAll({
        where: { paciente_id: { [Op.in]: idsArray }, recebido: true },
        include: [{ model: Medicamentos, as: 'medicamento' }],
        order: [['external_id', 'DESC']]
      });

      // Guarda só o evento mais recente por (paciente, medicamento) — como a
      // lista já vem ordenada DESC, o primeiro encontrado é o mais novo.
      const eventoMaisRecentePorPar = {};
      eventos.forEach(e => {
        const chave = `${e.paciente_id}-${e.medicamento_id}`;
        if (!eventoMaisRecentePorPar[chave]) eventoMaisRecentePorPar[chave] = e;
      });

      // "Marca d'água": maior evento_externo_id já registrado em QUALQUER
      // monitoramento (de qualquer status) pra cada par paciente+medicamento.
      const monitoramentos = await MonitoramentoMedicamento.findAll({
        where: { paciente_id: { [Op.in]: idsArray }, evento_externo_id: { [Op.not]: null } },
        attributes: ['paciente_id', 'medicamento_id', 'evento_externo_id'],
        raw: true
      });
      const watermarkPorPar = {};
      monitoramentos.forEach(m => {
        const chave = `${m.paciente_id}-${m.medicamento_id}`;
        const extId = parseInt(m.evento_externo_id, 10);
        if (!watermarkPorPar[chave] || extId > watermarkPorPar[chave]) watermarkPorPar[chave] = extId;
      });

      const candidatos = {};
      Object.values(eventoMaisRecentePorPar).forEach(evento => {
        const chave = `${evento.paciente_id}-${evento.medicamento_id}`;
        const extId = parseInt(evento.external_id, 10);
        const marca = watermarkPorPar[chave];
        if (marca === undefined || extId > marca) {
          const pacienteId = evento.paciente_id;
          if (!candidatos[pacienteId]) candidatos[pacienteId] = [];
          const dataAdminExterna = evento.data_administracao_prevista;
          candidatos[pacienteId].push({
            evento_externo_id: evento.external_id,
            medicamento_id: evento.medicamento_id,
            medicamento_nome: evento.medicamento?.nome,
            qtd_capsula_conhecida: evento.medicamento?.qtd_capsula != null,
            qtd_caixas: evento.qtd_caixas,
            data_entrega: evento.data_entrega_real || evento.data_entrega_prevista,
            data_previsao_administracao: dataAdminExterna,
            data_sugerida_primeiro_contato: dataAdminExterna ? calcularDataTelemonitoramento(parseISO(dataAdminExterna)) : null
          });
        }
      });

      return res.json({ candidatos });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao buscar candidatos de retomada.', details: error.message });
    }
  }


}

export default new MonitoramentoMedicamentoController();