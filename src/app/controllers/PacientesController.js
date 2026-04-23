import * as Yup from 'yup';
import User from '../models/User.js';
import Pacientes from '../models/Pacientes.js';
import Operadora from '../models/Operadora.js';
import Medicamentos from '../models/Medicamentos.js';
import getAdress from '../../utils/getAdress.js';
import PacientesAnexos from '../models/PacientesAnexos.js';
import Sequelize, { Op } from 'sequelize';
import { getOperadoraFilter } from '../../utils/permissionUtils.js';
import AuditService from '../../services/AuditService.js';
import axios from 'axios';
import PacienteSyncService from '../../services/SyncService.js';

const formatarCelularWhatsapp = (numero) => {
    if (!numero) return null;
    let limpo = String(numero).replace(/\D/g, '');
    if (limpo.length === 11 && !limpo.startsWith('55')) {
        limpo = '55' + limpo;
    }
    return limpo;
};

class PacientesController {

    async getNomesAnexos(req, res) {
        try {
            const nomes = await PacientesAnexos.findAll({
                attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('nome')), 'nome']],
                raw: true,
                order: [['nome', 'ASC']]
            });
            return res.json(nomes.map(n => n.nome));
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao buscar nomes de anexos' });
        }
    }

    async store(req, res) {
        req.body.possui_cuidador = req.body.possui_cuidador === 'true';
        req.body.fez_entrevista = req.body.fez_entrevista === 'true';
        req.body.operadora_id = Number(req.body.operadora_id);

        if (req.body.celular) req.body.celular = formatarCelularWhatsapp(req.body.celular);
        if (req.body.telefone) req.body.telefone = String(req.body.telefone).replace(/\D/g, '');

        const permission = await getOperadoraFilter(req.userId, req.body.operadora_id);
        if (!permission.authorized) {
            return res.status(permission.status || 403).json({ error: permission.error || "Sem permissão." });
        }

        req.body.medicamento_id = req.body.medicamento_id ? Number(req.body.medicamento_id) : null;

        const schema = Yup.object({
            nome: Yup.string().required(),
            sobrenome: Yup.string().required(),
            celular: Yup.string().required().length(13),
            data_nascimento: Yup.date().required(),
            sexo: Yup.string().oneOf(['M', 'F', 'nao definido']).required(),
            possui_cuidador: Yup.boolean().required(),
            operadora_id: Yup.number().required(),
            cpf: Yup.string().required(),
            cep: Yup.string().required(),
            logradouro: Yup.string().required(),
            numero: Yup.string().required(),
            bairro: Yup.string().required(),
            cidade: Yup.string().required(),
            estado: Yup.string().required()
        });

        try {
            await schema.validate(req.body, { abortEarly: false });
        } catch (err) {
            return res.status(400).json({ error: err.errors });
        }

        const formatarNome = (texto) => texto ? texto.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : '';
        req.body.nome = formatarNome(req.body.nome);
        req.body.sobrenome = formatarNome(req.body.sobrenome);

        const isCPF = await Pacientes.findOne({ where: { cpf: req.body.cpf.replace(/\D/g, '') } });
        if (isCPF) return res.status(400).json({ error: 'CPF já cadastrado.' });

        try {
            const paciente = await Pacientes.create(req.body);

            if (req.files && req.files.length > 0) {
                let nomesAnexos = Array.isArray(req.body.anexos_nomes) ? req.body.anexos_nomes : [req.body.anexos_nomes || ''];
                const anexosData = req.files.map((file, index) => ({
                    paciente_id: paciente.id,
                    nome: nomesAnexos[index] || 'Sem Nome',
                    file_path: file.filename,
                    original_name: file.originalname
                }));
                await PacientesAnexos.bulkCreate(anexosData);
            }

            return res.status(201).json(paciente);
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao cadastrar', details: err.message });
        }
    }

    async update(req, res) {
        const { id } = req.params;
        try {
            const paciente = await Pacientes.findByPk(id);
            if (!paciente) return res.status(404).json({ error: 'Paciente não encontrado' });

            if (req.body.possui_cuidador !== undefined) req.body.possui_cuidador = String(req.body.possui_cuidador) === 'true';
            if (req.body.fez_entrevista !== undefined) req.body.fez_entrevista = String(req.body.fez_entrevista) === 'true';
            if (req.body.operadora_id) req.body.operadora_id = Number(req.body.operadora_id);
            if (req.body.medicamento_id === '' || req.body.medicamento_id === 'null') req.body.medicamento_id = null;
            else if (req.body.medicamento_id) req.body.medicamento_id = Number(req.body.medicamento_id);

            if (req.body.celular) {
                req.body.celular = formatarCelularWhatsapp(req.body.celular);
            }

            if (req.body.cpf) {
                req.body.cpf = req.body.cpf.replace(/\D/g, '');
            }

            await paciente.update(req.body);
            return res.json(paciente);
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao atualizar' });
        }
    }

    async index(req, res) {
        const { nome, cpf, operadora_id, status_active } = req.query;
        const permission = await getOperadoraFilter(req.userId, operadora_id);

        if (!permission.authorized) return res.json([]);

        const where = permission.whereClause;
        if (nome) {
            where[Op.or] = [
                { nome: { [Op.iLike]: `%${nome}%` } },
                { sobrenome: { [Op.iLike]: `%${nome}%` } }
            ];
        }
        if (cpf) where.cpf = cpf.replace(/\D/g, '');

        if (status_active === 'false') where.is_active = false;
        else if (status_active !== 'ambos' && status_active !== 'todos') where.is_active = { [Op.not]: false };

        try {
            const pacientes = await Pacientes.findAll({
                where,
                include: [
                    { model: Operadora, as: 'operadoras', attributes: ['id', 'nome'] },
                    { model: PacientesAnexos, as: 'anexos', attributes: ['id', 'nome', 'file_path', 'original_name'] },
                    { model: Medicamentos, as: 'medicamento', attributes: ['id', 'nome', 'dosagem'] }
                ],
                order: [['nome', 'ASC']] // Removida a ordenação por is_new_user
            });
            return res.json(pacientes);
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao buscar pacientes' });
        }
    }

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

            
            const baseUrl = `${process.env.END_POINT}/api/patients?oncological_navigation=1`;

            console.log(`[BACKEND] 2. Buscando pacientes (Filtro aplicado na URL)...`);

            // Busca a primeira página
            const responseP1 = await axios.get(`${baseUrl}&page=1`, { headers });
            const dataP1 = responseP1.data;

            if (dataP1.data) todosPacientes = todosPacientes.concat(dataP1.data);
            else if (Array.isArray(dataP1)) todosPacientes = todosPacientes.concat(dataP1);

            const lastPage = (dataP1.meta && dataP1.meta.last_page) ? dataP1.meta.last_page : 1;

            // Se tiver mais de uma página de pacientes oncológicos, busca o resto
            if (lastPage > 1) {
                console.log(`[BACKEND] Total de páginas com pacientes oncológicos: ${lastPage}. Buscando o resto...`);

                const BATCH_SIZE = 5; // Lotes de 5 em 5 requisições paralelas

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
                return res.json({ message: "Nenhum paciente de navegação oncológica encontrado." });
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

    async checkSync(req, res) {
        try {
            const currentUser = await User.findByPk(req.userId);

            if (!currentUser || !currentUser.external_token) {
                return res.status(401).json({ error: "Token externo não encontrado." });
            }

            const headers = { 'Authorization': `Bearer ${currentUser.external_token}` };
            const baseUrl = `${process.env.END_POINT}/api/patients?oncological_navigation=1`;
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

            // FORÇANDO A CONVERSÃO PARA STRING PARA EVITAR BUGS DE COMPARAÇÃO
            const pacientesValidosParaSync = todosPacientesExternos.filter(extPatient => {
                return String(extPatient.oncological_navigation) === '1' &&
                    String(extPatient.immunobiological) !== '1' &&
                    String(extPatient.oncological) !== '1';
            });

            const externalIds = pacientesValidosParaSync.map(p => String(p.id));

            const pacientesLocais = await Pacientes.findAll({
                attributes: ['external_id'],
                where: { external_id: { [Op.not]: null } }
            });

            // FORÇANDO A CONVERSÃO AQUI TAMBÉM
            const localIds = pacientesLocais.map(p => String(p.external_id));

            const pendentes = externalIds.filter(id => !localIds.includes(id));

            console.log(`[CHECK SYNC] Externos: ${externalIds.length} | Locais: ${localIds.length} | Pendentes: ${pendentes.length}`);

            return res.json({
                pendentes: pendentes.length,
                total_externo: externalIds.length,
                total_local: localIds.length
            });

        } catch (err) {
            console.error('[BACKEND] Erro ao checar sync:', err.message);
            return res.status(500).json({ error: 'Erro ao verificar sincronização pendente.' });
        }
    }

    async getOperadorasFiltro(req, res) {
        try {
            const permission = await getOperadoraFilter(req.userId);
            let whereClause = {};
            if (permission.whereClause && permission.whereClause.operadora_id) whereClause.id = permission.whereClause.operadora_id;
            const operadoras = await Operadora.findAll({ where: whereClause, attributes: ['id', 'nome'], order: [['nome', 'ASC']] });
            return res.json(operadoras);
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao buscar operadoras' });
        }
    }

    async toggleActive(req, res) {
        const { id } = req.params;
        try {
            const paciente = await Pacientes.findByPk(id);
            if (!paciente) return res.status(404).json({ error: 'Paciente não encontrado' });
            const novoStatus = paciente.is_active === false;
            await paciente.update({ is_active: novoStatus });
            return res.json({ message: 'Status alterado', is_active: novoStatus });
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao alterar status' });
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
            return res.json(paciente);
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao buscar paciente' });
        }
    }
}

export default new PacientesController();