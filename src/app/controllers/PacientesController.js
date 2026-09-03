import User from '../models/User.js';
import Pacientes from '../models/Pacientes.js';
import Operadora from '../models/Operadora.js';
import Medicamentos from '../models/Medicamentos.js';
import { Op } from 'sequelize';
import AuditService from '../../services/AuditService.js';
import axios from 'axios';
import PacienteSyncService from '../../services/SyncService.js';
import MonitoramentoMedicamento from '../models/MonitoramentoMedicamento.js';
import EventosPaciente from '../models/EventosPaciente.js';
import MotivoPausaTratamento from '../models/MotivoPausaTratamento.js';


class PacientesController {

    // =========================================================================
    // SINCRONIZAÇÃO COM API EXTERNA
    // =========================================================================

    async syncExternal(req, res) {
        try {
            console.log("[BACKEND] 1. Buscando o token do usuário logado...");
            const currentUser = await User.findByPk(req.userId);

            if (!currentUser || !currentUser.external_token) {
                console.log("❌ Usuário sem external_token!");
                return res.status(401).json({ error: "Token externo não encontrado." });
            }

            const headers = { 'Authorization': `Bearer ${currentUser.external_token}` };
            let todosPacientes = [];

            const baseUrl = `${process.env.END_POINT}/api/patients?treatment_type_id=4`;

            console.log(`[BACKEND] 2. Buscando pacientes (Filtro aplicado na URL)...`);

            const responseP1 = await axios.get(`${baseUrl}&page=1`, { headers });
            const dataP1 = responseP1.data;

            if (dataP1.data) todosPacientes = todosPacientes.concat(dataP1.data);
            else if (Array.isArray(dataP1)) todosPacientes = todosPacientes.concat(dataP1);

            const lastPage = (dataP1.meta && dataP1.meta.last_page) ? dataP1.meta.last_page : 1;

            if (lastPage > 1) {
                console.log(`[BACKEND] Total de páginas com pacientes oncológicos: ${lastPage}. Buscando o resto...`);

                const BATCH_SIZE = 5;

                for (let i = 2; i <= lastPage; i += BATCH_SIZE) {
                    const batchPromises = [];

                    for (let j = i; j < i + BATCH_SIZE && j <= lastPage; j++) {
                        batchPromises.push(axios.get(`${baseUrl}&page=${j}`, { headers }));
                    }

                    const batchResponses = await Promise.all(batchPromises);

                    for (const response of batchResponses) {
                        const responseData = response.data;
                        if (responseData.data) todosPacientes = todosPacientes.concat(responseData.data);
                        else if (Array.isArray(responseData)) todosPacientes = todosPacientes.concat(responseData);
                    }
                }
            }

            console.log(`[BACKEND] 3. Download concluído! Total de pacientes encontrados: ${todosPacientes.length}`);

            if (todosPacientes.length === 0) {
                return res.status(404).json({ message: "Nenhum paciente do tipo 4 encontrado." });
            }

            console.log(`[BACKEND] 4. Iniciando sincronização no banco local...`);

            const { successes, errors } = await PacienteSyncService.syncPacientes(todosPacientes, currentUser.id);

            return res.json({
                message: `Sincronização finalizada. ${successes.length} atualizados/inseridos.`,
                successes,
                errors
            });

        } catch (err) {
            console.error('[BACKEND] Erro na sincronização externa:', err.response?.data || err.message);
            return res.status(500).json({ error: 'Erro ao comunicar com a API externa para sincronizar pacientes.' });
        }
    }


    // =========================================================================
    // VERIFICADOR DE SINCRONIZAÇÃO PENDENTE
    // =========================================================================

    // =========================================================================
    // VERIFICADOR DE SINCRONIZAÇÃO PENDENTE (ATUALIZADO PARA EVENTOS)
    // =========================================================================
    async checkSync(req, res) {
        try {
            const currentUser = await User.findByPk(req.userId);

            if (!currentUser || !currentUser.external_token) {
                return res.status(401).json({ error: "Token externo não encontrado." });
            }

            const headers = { 'Authorization': `Bearer ${currentUser.external_token}` };
            const baseUrl = `${process.env.END_POINT}/api/patients?treatment_type_id=4`;
            let todosPacientesExternos = [];

            const responseP1 = await axios.get(`${baseUrl}&page=1`, { headers });
            const dataP1 = responseP1.data;

            if (dataP1.data) todosPacientesExternos = todosPacientesExternos.concat(dataP1.data);
            else if (Array.isArray(dataP1)) todosPacientesExternos = todosPacientesExternos.concat(dataP1);

            const lastPage = (dataP1.meta && dataP1.meta.last_page) ? dataP1.meta.last_page : 1;

            if (lastPage > 1) {
                const BATCH_SIZE = 5;
                for (let i = 2; i <= lastPage; i += BATCH_SIZE) {
                    const batchPromises = [];
                    for (let j = i; j < i + BATCH_SIZE && j <= lastPage; j++) {
                        batchPromises.push(axios.get(`${baseUrl}&page=${j}`, { headers }));
                    }
                    const batchResponses = await Promise.all(batchPromises);
                    for (const response of batchResponses) {
                        const responseData = response.data;
                        if (responseData.data) todosPacientesExternos = todosPacientesExternos.concat(responseData.data);
                        else if (Array.isArray(responseData)) todosPacientesExternos = todosPacientesExternos.concat(responseData);
                    }
                }
            }

            const externalEventIds = [];
            const externalPatientIds = [];

            // Varre os pacientes e extrai TODOS os IDs de eventos válidos
            todosPacientesExternos.forEach(extPatient => {
                const hasTreatmentType4 = extPatient.treatmentTypes &&
                    Array.isArray(extPatient.treatmentTypes) &&
                    extPatient.treatmentTypes.some(t => String(t.id) === '4');

                const isFundacaoLibertas = extPatient.company &&
                    extPatient.company.name &&
                    String(extPatient.company.name).trim().toUpperCase() === 'FUNDAÇÃO LIBERTAS';

                if (hasTreatmentType4 && !isFundacaoLibertas) {
                    const validEvents = extPatient.events && Array.isArray(extPatient.events) ? extPatient.events.filter(e =>
                        String(e.eventtype_id) === '2' &&
                        String(e.medicament_received) === '1' &&
                        e.medicament &&
                        String(e.medicament.treatment_types_id) === '4'
                    ) : [];

                    if (validEvents.length > 0) {
                        externalPatientIds.push(String(extPatient.id));
                        validEvents.forEach(e => externalEventIds.push(String(e.id)));
                    }
                }
            });

            // Busca IDs que já temos no banco local (Pacientes)
            const pacientesLocais = await Pacientes.findAll({
                attributes: ['external_id'],
                where: { external_id: { [Op.not]: null } }
            });
            const localPatientIds = pacientesLocais.map(p => String(p.external_id));

            // Busca IDs que já temos no banco local (Eventos)
            const eventosLocais = await EventosPaciente.findAll({
                attributes: ['external_id'],
                where: { external_id: { [Op.not]: null } }
            });
            const localEventIds = eventosLocais.map(e => String(e.external_id));

            // Calcula quem está faltando
            const pacientesPendentes = externalPatientIds.filter(id => !localPatientIds.includes(id));
            const eventosPendentes = externalEventIds.filter(id => !localEventIds.includes(id));

            console.log(`[CHECK SYNC] Pacientes Pendentes: ${pacientesPendentes.length} | Eventos Pendentes: ${eventosPendentes.length}`);

            // 👇 Quebra pacientes/eventos separadamente, pra tela conseguir
            // mostrar exatamente o que está pendente (antes só mandava a soma).
            return res.json({
                pendentes: pacientesPendentes.length + eventosPendentes.length,
                pacientes_pendentes: pacientesPendentes.length,
                eventos_pendentes: eventosPendentes.length,
                total_externo: externalPatientIds.length
            });

        } catch (err) {
            console.error('[BACKEND] Erro ao checar sync:', err.message);
            return res.status(500).json({ error: 'Erro ao verificar sincronização pendente.' });
        }
    }

    // =========================================================================
    // PAUSA DE TRATAMENTO
    // =========================================================================
    // Usado a partir de "Necessidade de Navegação": em vez de enviar o Termo,
    // o operador pode pausar o tratamento do paciente. Enquanto pausado, o
    // paciente fica bloqueado de qualquer contato automatizado (Termo, NPS,
    // chat/WhatsApp) e some das pendências do Telemonitoramento, até alguém
    // retomar o tratamento manualmente.
    async pausarTratamento(req, res) {
        const { id } = req.params;
        const { motivo_id, observacao } = req.body;
        try {
            if (!motivo_id) {
                return res.status(400).json({ error: 'Selecione o motivo da pausa.' });
            }

            const paciente = await Pacientes.findByPk(id);
            if (!paciente) return res.status(404).json({ error: 'Paciente não encontrado' });

            await paciente.update({
                tratamento_pausado: true,
                motivo_pausa_tratamento_id: motivo_id,
                motivo_pausa_tratamento: observacao || null,
                data_pausa_tratamento: new Date()
            });

            const pacienteAtualizado = await Pacientes.findByPk(id, {
                include: [{ model: MotivoPausaTratamento, as: 'motivoPausaTratamento', attributes: ['id', 'descricao'] }]
            });

            await AuditService.log(req.userId, 'Edição', 'Pacientes', paciente.id, `Tratamento pausado. Motivo: ${pacienteAtualizado.motivoPausaTratamento?.descricao || 'não informado'}.`);

            return res.json({ message: 'Tratamento pausado com sucesso.', tratamento_pausado: true, paciente: pacienteAtualizado });
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao pausar tratamento' });
        }
    }

    async retomarTratamento(req, res) {
        const { id } = req.params;
        try {
            const paciente = await Pacientes.findByPk(id);
            if (!paciente) return res.status(404).json({ error: 'Paciente não encontrado' });

            await paciente.update({
                tratamento_pausado: false,
                motivo_pausa_tratamento_id: null,
                motivo_pausa_tratamento: null,
                data_pausa_tratamento: null
            });

            await AuditService.log(req.userId, 'Edição', 'Pacientes', paciente.id, 'Tratamento retomado.');

            return res.json({ message: 'Tratamento retomado com sucesso.', tratamento_pausado: false });
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao retomar tratamento' });
        }
    }

    async show(req, res) {
        const { id } = req.params;
        try {
            const paciente = await Pacientes.findByPk(id, {
                include: [
                    { model: Operadora, as: 'operadoras', attributes: ['id', 'nome'] },
                    { model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome', 'dosagem', 'price'] }
                ]
            });

            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            const temMonitoramento = await MonitoramentoMedicamento.findOne({
                where: { paciente_id: id }
            });

            return res.json({
                ...paciente.toJSON(),
                ja_tem_monitoramento: !!temMonitoramento
            });

        } catch (err) {
            console.error("Erro no show paciente:", err);
            return res.status(500).json({ error: 'Erro ao buscar paciente' });
        }
    }

    async medicamentosAtivos(req, res) {
        const { id } = req.params;
        try {
            const eventos = await EventosPaciente.findAll({
                where: { paciente_id: id, recebido: true },
                order: [['external_id', 'DESC']],
                include: [{ model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome', 'qtd_capsula'] }]
            });

            if (eventos.length === 0) {
                return res.json({ medicamentos: [] });
            }

            // Mantém só o evento mais recente de cada medicamento DISTINTO — evita
            // listar a mesma substância várias vezes por reposições/recompras antigas.
            const medicamentosVistos = new Set();
            const medicamentosAtivos = [];

            for (const evento of eventos) {
                if (!evento.medicamento || medicamentosVistos.has(evento.medicamento_id)) continue;
                medicamentosVistos.add(evento.medicamento_id);

                medicamentosAtivos.push({
                    id: evento.medicamento.id,
                    nome: evento.medicamento.nome,
                    qtd_capsula: evento.medicamento.qtd_capsula,
                    data_entrega_medicamento: evento.data_entrega_real || evento.data_entrega_prevista,
                    qtd_caixas: evento.qtd_caixas || 1
                });

                if (medicamentosAtivos.length === 2) break; // limite de 2 medicamentos concorrentes
            }

            return res.json({ medicamentos: medicamentosAtivos });
        } catch (err) {
            console.error("Erro ao buscar medicamentos ativos:", err);
            return res.status(500).json({ error: 'Erro ao buscar medicamentos ativos do paciente.', details: err.message });
        }
    }

    async syncIndividual(req, res) {
        const { id } = req.params;
        try {
            const currentUser = await User.findByPk(req.userId);
            if (!currentUser || !currentUser.external_token) {
                return res.status(401).json({ error: "Token externo não encontrado." });
            }

            const paciente = await Pacientes.findByPk(id);
            if (!paciente) return res.status(404).json({ error: 'Paciente não encontrado.' });
            if (!paciente.external_id) {
                return res.json({ message: 'Paciente sem vínculo com o sistema externo.', sincronizado: false });
            }

            const headers = { 'Authorization': `Bearer ${currentUser.external_token}` };
  
            const url = `${process.env.END_POINT}/api/patients?id=${paciente.external_id}`;
            const response = await axios.get(url, { headers });
            const pacienteExterno = Array.isArray(response.data.data) ? response.data.data[0] : (response.data.data || response.data);

            if (!pacienteExterno) {
                return res.json({ message: 'Paciente não encontrado no sistema externo.', sincronizado: false });
            }

            const { successes, errors } = await PacienteSyncService.syncPacientes([pacienteExterno], currentUser.id);

            return res.json({
                message: successes.length > 0 ? 'Paciente sincronizado com sucesso.' : 'Nenhuma atualização necessária.',
                sincronizado: successes.length > 0,
                errors
            });
        } catch (err) {
            console.error('[BACKEND] Erro na sincronização individual:', err.response?.data || err.message);
            return res.status(500).json({ error: 'Erro ao sincronizar paciente individualmente.' });
        }
    }
}

export default new PacientesController();