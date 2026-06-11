import MonitoramentoMedicamento from '../models/MonitoramentoMedicamento.js';
import Medicamentos from '../models/Medicamentos.js';
import Pacientes from '../models/Pacientes.js';
import PatientEvaluation from '../models/PatientEvaluation.js';
import Operadora from '../models/Operadora.js';
import { addDays, subDays, parseISO } from 'date-fns';
import { Op } from 'sequelize';
import { getOperadoraFilter } from '../../utils/permissionUtils.js';
import * as Yup from 'yup';
import AuditService from '../../services/AuditService.js';
import User from '../models/User.js'; // Ajuste o caminho de pastas conforme sua estrutura se necessário
import axios from 'axios';
import HistoricoTrocaMedicamento from '../models/HistoricoTrocaMedicamento.js';

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
      patient_evaluation_id: Yup.number().integer().nullable(),
      medicamentos_confirmados: Yup.array().of(
        Yup.object().shape({
          medicamento_id: Yup.number().integer().required('ID do medicamento é obrigatório.'),
          posologia_diaria: Yup.number().integer().required('A posologia é obrigatória.'),
          data_entrega: Yup.date().required('A data de entrega do medicamento é obrigatória.'),
          data_telemonitoramento: Yup.date().required('A data do telemonitoramento é obrigatória.'),
          qtd_capsula_manual: Yup.number().integer().nullable(),
          qtd_caixas: Yup.number().integer().nullable()
        })
      ).min(1, 'É necessário enviar pelo menos um medicamento.').required('A lista de medicamentos é obrigatória.')
    });

    try {
      await schema.validate(req.body, { abortEarly: false });
    } catch (err) {
      return res.status(400).json({ error: 'Falha na validação', messages: err.inner });
    }

    const { paciente_id, patient_evaluation_id, medicamentos_confirmados } = req.body;

    try {
      // =========================================================================
      // BUSCA AUTOMÁTICA DO ID DO EVENTO EXTERNO NO NASCIMENTO DO CICLO
      // =========================================================================
      const paciente = await Pacientes.findByPk(paciente_id);
      let externalEventId = null;

      if (paciente && paciente.external_id) {
        console.log(`\n[STORE DEBUG] Iniciando busca do evento externo para o paciente: ${paciente.external_id}`);

        const currentUser = await User.findByPk(req.userId);

        if (currentUser && currentUser.external_token) {
          try {
            const headers = { 'Authorization': `Bearer ${currentUser.external_token}` };
            const baseUrl = `${process.env.END_POINT}/api/patients?treatment_type_id=4`;

            let extPatient = null;
            let currentPage = 1;
            let lastPage = 1;

            do {
              const response = await axios.get(`${baseUrl}&page=${currentPage}`, { headers });
              const resData = response.data;
              const pacs = resData.data || resData;

              extPatient = pacs.find(p => String(p.id) === String(paciente.external_id));
              if (extPatient) {
                console.log(`[STORE DEBUG] Paciente encontrado na página ${currentPage}!`);
                break;
              }

              lastPage = (resData.meta && resData.meta.last_page) ? resData.meta.last_page : 1;
              currentPage++;
            } while (currentPage <= lastPage);

            if (extPatient && extPatient.events && Array.isArray(extPatient.events)) {
              let comprasValidas = extPatient.events.filter(e =>
                String(e.eventtype_id) === '2' &&
                String(e.medicament_received) === '1' &&
                e.medicament &&
                String(e.medicament.treatment_types_id) === '4'
              );

              if (comprasValidas.length > 0) {
                comprasValidas.sort((a, b) => {
                  const dataA = new Date(a.administration_date_prev || 0);
                  const dataB = new Date(b.administration_date_prev || 0);
                  return dataB - dataA;
                });
                externalEventId = comprasValidas[0].id;
                console.log(`[STORE DEBUG] Sucesso! ID do Evento mais recente capturado: ${externalEventId}`);
              } else {
                console.log(`[STORE DEBUG] Nenhum evento de compra concluído encontrado.`);
              }
            }
          } catch (extErr) {
            console.error("[STORE DEBUG] ERRO INTERNO na busca externa:", extErr.message);
          }
        } else {
          console.log(`[STORE DEBUG] Usuário sem token externo. Ignorando busca.`);
        }
      }
      // =========================================================================

      const agendamentos = [];

      for (let item of medicamentos_confirmados) {
        const medicamento = await Medicamentos.findByPk(item.medicamento_id);

        if (!medicamento) {
          return res.status(404).json({ error: `Medicamento ID ${item.medicamento_id} não encontrado.` });
        }

        const qtdPorCaixa = item.qtd_capsula_manual || medicamento.qtd_capsula;

        if (!qtdPorCaixa) {
          return res.status(400).json({
            error: 'MISSING_QTD_CAPSULA',
            needs_qtd_capsula: true,
            message: `Quantidade de cápsulas na caixa não encontrada.`,
            medicamento_id: item.medicamento_id
          });
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

        console.log(`[STORE DEBUG] Gravando no banco. evento_externo_id = ${externalEventId}`);

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
          evento_externo_id: externalEventId, // 👈 Se chegar aqui com número e salvar NULL, o problema é o Model.
          status: 'PENDENTE'
        });

        agendamentos.push(novoMonitoramento);
      }

      console.log(`[STORE DEBUG] Processo finalizado com sucesso!\n`);
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

      let pacienteWhere = { ...permission.whereClause };
      if (search) {
        const termosPesquisa = search.trim().split(/\s+/);

        const condicoesBusca = termosPesquisa.map(termo => ({
          [Op.or]: [
            { nome: { [Op.iLike]: `%${termo}%` } },
            { sobrenome: { [Op.iLike]: `%${termo}%` } }
          ]
        }));

        pacienteWhere = {
          ...pacienteWhere,
          [Op.and]: condicoesBusca
        };
      }

      const { count, rows: pendentesPagina } = await MonitoramentoMedicamento.findAndCountAll({
        where: { status: 'PENDENTE' },
        include: [
          {
            model: Pacientes,
            as: 'paciente',
            attributes: ['id', 'nome', 'sobrenome', 'operadora_id', 'possui_cuidador', 'nome_cuidador', 'contato_cuidador'],
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

      const uniquePatientIds = [...new Set(pendentesPagina.map(p => p.paciente_id))];

      const allRecordsForPage = await MonitoramentoMedicamento.findAll({
        where: {
          paciente_id: { [Op.in]: uniquePatientIds }, // Puxa TODO o histórico do paciente
          status: { [Op.ne]: 'CANCELADO' }
        },
        include: [
          {
            model: Pacientes,
            as: 'paciente',
            attributes: ['id', 'nome', 'sobrenome', 'celular', 'telefone', 'operadora_id', 'possui_cuidador', 'nome_cuidador', 'contato_cuidador'],
            include: [
              { model: Operadora, as: 'operadoras', attributes: ['id', 'nome'] },
              { model: PatientEvaluation, as: 'avaliacoes', attributes: ['id', 'total_score', 'createdAt'], required: false },
            ]
          },
          { model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome', 'qtd_capsula'] },
          { model: PatientEvaluation, as: 'avaliacao', attributes: ['id', 'total_score'] }
        ],
        // 👇 NOVA LINHA: Garante que o histórico venha ordenado do mais recente para o mais antigo
        order: [['createdAt', 'DESC']]
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
      reacoes_adversas: Yup.array().of(Yup.number().integer()).nullable(),
      observacao: Yup.string().nullable(),
      aplicar_nova_compra: Yup.boolean().nullable(),
      dados_nova_compra: Yup.object().nullable(),
      data_inicio_nova_caixa: Yup.date().nullable(),
      posologia_nova_caixa: Yup.number().integer().nullable()
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
      reacoes_adversas,
      observacao,
      aplicar_nova_compra,
      dados_nova_compra,
      data_inicio_nova_caixa,
      posologia_nova_caixa
    } = req.body;

    try {
      const monitoramentoAtual = await MonitoramentoMedicamento.findByPk(id);

      if (!monitoramentoAtual) {
        return res.status(404).json({ error: 'Monitoramento não encontrado.' });
      }

      await monitoramentoAtual.update({
        contato_efetivo,
        nivel_adesao: contato_efetivo === false ? 'NAO_ADERE' : nivel_adesao,
        qtd_informada_caixa,
        data_abertura_nova_caixa,
        is_reacao,
        status: 'CONCLUIDO',
        observacao
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

        proximaDataAdministracao = data_inicio_nova_caixa
          ? parseISO(data_inicio_nova_caixa)
          : parseISO(dados_nova_compra.data_novo_inicio);

        let sobraNoDiaDoInicio = 0;

        if (!dados_nova_compra.mudou_medicamento) {
          if (contato_efetivo && qtd_informada_caixa != null) {
            
            let dataFimEstimadaObj;
            const dataInicioAtual = monitoramentoAtual.data_administracao || monitoramentoAtual.data_entrega;
            const dataInicioAtualObj = dataInicioAtual ? new Date(dataInicioAtual) : new Date();
            dataInicioAtualObj.setHours(0, 0, 0, 0);

            const dataHoje = new Date();
            dataHoje.setHours(0, 0, 0, 0);

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
            } else {
              sobraNoDiaDoInicio = 0;
            }

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
            paciente_id: monitoramentoAtual.paciente_id,
            medicamento_antigo_id: dados_nova_compra.medicamento_atual.id,
            medicamento_novo_id: proximoMedicamentoId,
            data_troca: proximaDataEntrega,
            monitoramento_id: monitoramentoAtual.id
          });
        }
      }

      if (data_abertura_nova_caixa) {
        const dataProximoContatoEnviada = parseISO(data_abertura_nova_caixa);

        await MonitoramentoMedicamento.create({
          paciente_id: monitoramentoAtual.paciente_id,
          patient_evaluation_id: monitoramentoAtual.patient_evaluation_id,
          medicamento_id: proximoMedicamentoId,
          posologia_diaria: proximaPosologia,
          data_entrega: proximaDataEntrega,
          data_administracao: proximaDataAdministracao,
          data_calculada_fim_caixa: proximaDataFimCaixa,
          data_proximo_contato: dataProximoContatoEnviada,
          status: 'PENDENTE',
          qtd_caixas: proximasCaixas,
          qtd_total_capsulas: proximasCapsulasTotais,
          evento_externo_id: proximoEventoExternoId
        });
      }

      await AuditService.log(req.userId, 'Edição', 'Monitoramento', monitoramentoAtual.id, `Registrou contato de monitoramento. Nova compra aplicada: ${aplicar_nova_compra}`);
      return res.json({ message: 'Contato registrado e ciclo atualizado com sucesso!' });
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

  
  async vincularAvaliacaoSilencioso(req, res) {
    const { paciente_id, patient_evaluation_id } = req.body;

    if (!paciente_id || !patient_evaluation_id) {
      return res.status(400).json({ error: 'IDs do paciente e da avaliação são obrigatórios.' });
    }
    

    try {
      const [updatedRows] = await MonitoramentoMedicamento.update(
        { patient_evaluation_id },
        {
          where: {
            paciente_id,
            status: 'PENDENTE'
          }
        }
      );

      return res.status(200).json({
        message: 'Avaliação vinculada ao monitoramento ativo.',
        registros_atualizados: updatedRows
      });
    } catch (error) {
      // 🛑 AGORA O ERRO APARECE NO SEU TERMINAL DO BACKEND:
      console.error("🔥 [ERRO BANCO DE DADOS] Falha ao atualizar MonitoramentoMedicamento:", error);

      return res.status(500).json({ 
        error: 'Erro ao vincular avaliação silenciosamente.', 
        details: error.message 
      });
    }
  }

  async informarDataAdministracao(req, res) {
    const { id } = req.params;
    const { data_administracao } = req.body;

    if (!data_administracao) {
      return res.status(400).json({ error: 'A data de administração é obrigatória.' });
    }

    try {
      const monitoramento = await MonitoramentoMedicamento.findByPk(id);
      if (!monitoramento) {
        return res.status(404).json({ error: 'Monitoramento não encontrado.' });
      }

      const dataAdminParsed = parseISO(data_administracao);

      // Recalcula a data de fim da caixa baseada na data real informada pelo paciente
      const diasDuracao = Math.floor(monitoramento.qtd_total_capsulas / monitoramento.posologia_diaria);
      const novaDataFimCaixa = addDays(dataAdminParsed, diasDuracao);

      await monitoramento.update({
        data_administracao: dataAdminParsed,
        data_calculada_fim_caixa: novaDataFimCaixa
      });

      return res.json({
        message: 'Data de administração registrada com sucesso!',
        monitoramento
      });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao registrar data de administração.', details: error.message });
    }
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

      if (!monitoramento) {
        return res.status(404).json({ error: 'Monitoramento não encontrado.' });
      }

      if (!monitoramento.paciente.external_id) {
        return res.json({ novaCompraDetectada: false });
      }

      const currentUser = await User.findByPk(req.userId);
      if (!currentUser || !currentUser.external_token) {
        return res.status(401).json({ error: 'Token externo não encontrado.' });
      }

      const headers = { 'Authorization': `Bearer ${currentUser.external_token}` };
      const baseUrl = `${process.env.END_POINT}/api/patients?treatment_type_id=4`;

      let extPatient = null;
      let currentPage = 1;
      let lastPage = 1;

      do {
        const response = await axios.get(`${baseUrl}&page=${currentPage}`, { headers });
        const resData = response.data;
        const pacs = resData.data || resData;

        extPatient = pacs.find(p => String(p.id) === String(monitoramento.paciente.external_id));

        if (extPatient) {
          break; 
        }

        lastPage = (resData.meta && resData.meta.last_page) ? resData.meta.last_page : 1;
        currentPage++;
      } while (currentPage <= lastPage);

      if (!extPatient || !extPatient.events || !Array.isArray(extPatient.events)) {
        return res.json({ novaCompraDetectada: false });
      }

      let comprasValidas = extPatient.events.filter(e =>
        String(e.eventtype_id) === '2' &&
        String(e.medicament_received) === '1' &&
        e.medicament &&
        String(e.medicament.treatment_types_id) === '4'
      );

      if (comprasValidas.length === 0) {
        return res.json({ novaCompraDetectada: false });
      }

      comprasValidas.sort((a, b) => {
        const dataA = new Date(a.administration_date_prev || 0);
        const dataB = new Date(b.administration_date_prev || 0);
        return dataB - dataA;
      });

      const validPurchaseEvent = comprasValidas[0];

      if (monitoramento.evento_externo_id && String(validPurchaseEvent.id) === String(monitoramento.evento_externo_id)) {
        return res.json({ novaCompraDetectada: false });
      }

      const dataEntregaExternaReal = validPurchaseEvent.date_delivery ? validPurchaseEvent.date_delivery.split('T')[0] : null;
      
      // Correção inserida aqui: conversão segura da data local para string antes de comparar
      if (!monitoramento.evento_externo_id && dataEntregaExternaReal && monitoramento.data_entrega) {
        const dataEntregaLocal = monitoramento.data_entrega.toISOString().split('T')[0];
        if (dataEntregaExternaReal <= dataEntregaLocal) {
          return res.json({ novaCompraDetectada: false });
        }
      }

      const dataAdminExterna = validPurchaseEvent.administration_date_prev ? validPurchaseEvent.administration_date_prev.split('T')[0] : null;
      if (!dataAdminExterna) {
        return res.json({ novaCompraDetectada: false });
      }

      let extMed = validPurchaseEvent.medicament;
      let novoMedicamento = null;

      if (extMed) {
        if (extMed.id) {
          novoMedicamento = await Medicamentos.findOne({ where: { external_id: extMed.id } });
        }
        if (!novoMedicamento && extMed.tusscode) {
          novoMedicamento = await Medicamentos.findOne({ where: { codigo_tuss: extMed.tusscode } });
        }

        let tipoDosagemFormatado = extMed.measurement ? String(extMed.measurement).toUpperCase().trim() : null;
        const dosagensPermitidas = ['MG', 'G', 'MCG', 'UI', 'ML', 'MG/ML'];
        if (tipoDosagemFormatado && !dosagensPermitidas.includes(tipoDosagemFormatado)) {
          tipoDosagemFormatado = null;
        }

        let qtdCapsulaExtraida = null;
        if (extMed.dosage) {
          const apenasNumeros = String(extMed.dosage).replace(/\D/g, '');
          if (apenasNumeros) {
            qtdCapsulaExtraida = parseInt(apenasNumeros, 10);
          }
        }

        const medData = {
          external_id: extMed.id || null,
          codigo_tuss: extMed.tusscode || null,
          nome: extMed.name,
          nome_comercial: extMed.commercial_name,
          principio_ativo: extMed.active_principle,
          qtd_capsula: qtdCapsulaExtraida,
          dosagem: extMed.dosage ? String(extMed.dosage).trim() : null,
          tipo_dosagem: tipoDosagemFormatado,
          apresentacao: extMed.apresentation,
          via_administracao: extMed.way_administration,
          tipo_matmed: extMed.typematmed,
          tipo_medicamento: extMed.type_medicament,
          price: validPurchaseEvent.price ? parseFloat(validPurchaseEvent.price) : null
        };

        if (novoMedicamento) {
          await novoMedicamento.update(medData);
        } else {
          novoMedicamento = await Medicamentos.create(medData);
        }
      }

      if (!novoMedicamento) {
        return res.status(400).json({ error: `Falha ao processar e sincronizar o medicamento da nova compra no banco local.` });
      }

      const qtdCaixasNova = validPurchaseEvent.qtd_medicament ? parseInt(validPurchaseEvent.qtd_medicament, 10) : 1;
      const totalCapsulasNovas = (novoMedicamento.qtd_capsula || 0) * qtdCaixasNova;

      const dataAdminParsed = parseISO(dataAdminExterna);
      const dataNovoInicio = addDays(dataAdminParsed, 5);

      let sobraComprimidos = 0;
      if (monitoramento.data_calculada_fim_caixa) {
        const dataFimAtual = parseISO(monitoramento.data_calculada_fim_caixa);
        if (dataFimAtual > dataNovoInicio) {
          const diffDays = Math.max(0, Math.floor((dataFimAtual - dataNovoInicio) / (1000 * 60 * 60 * 24)));
          sobraComprimidos = diffDays * monitoramento.posologia_diaria;
        }
      }

      return res.json({
        novaCompraDetectada: true,
        detalhes: {
          evento_externo_id: validPurchaseEvent.id,
          data_entrega: dataEntregaExternaReal,
          data_previsao_administracao: dataAdminExterna,
          data_novo_inicio: dataNovoInicio,
          qtd_caixas: qtdCaixasNova,
          total_capsulas_novas: totalCapsulasNovas,
          sobra_comprimidos: sobraComprimidos,
          total_estoque_calculado: totalCapsulasNovas + sobraComprimidos,
          mudou_medicamento: monitoramento.medicamento_id !== novoMedicamento.id,
          medicamento_novo: { id: novoMedicamento.id, nome: novoMedicamento.nome },
          medicamento_atual: { id: monitoramento.medicamento_id, nome: monitoramento.medicamento.nome }
        }
      });

    } catch (error) {
      console.error("ERRO NO VERIFICAR NOVA COMPRA:", error);
      return res.status(500).json({ error: 'Erro ao verificar nova compra.', details: error.message });
    }
  }

}

export default new MonitoramentoMedicamentoController();