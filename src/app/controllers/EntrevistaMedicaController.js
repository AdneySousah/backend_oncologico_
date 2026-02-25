import * as Yup from 'yup';
import EntrevistaMedica from '../models/EntrevistaMedica.js';
import Exames from '../models/Exames.js';
import InfosComorbidade from '../models/InfosComorbidade.js';
import Pacientes from '../models/Pacientes.js';
import Diagnostico from '../models/Diagnostico.js';
import PrestadorMedico from '../models/PrestadorMedico.js';
import Medico from '../models/Medico.js';
import Comorbidades from '../models/Comorbidades.js';
// REMOVIDO: import InfosMedicamento from '../models/InfosMedicamento.js'; 
import Medicamentos from '../models/Medicamentos.js';
import EntrevistaMedicaAnexos from '../models/EntrevistaMedicaAnexos.js';
import { getOperadoraFilter } from '../../utils/permissionUtils.js';

class EntrevistaMedicaController {

    async store(req, res) {
        // 1. Converte as strings do FormData de volta para Objetos/Arrays DENTRO do req.body
        if (typeof req.body.comorbidade === 'string') {
            req.body.comorbidade = JSON.parse(req.body.comorbidade);
        }
        if (typeof req.body.exame === 'string') {
            req.body.exame = JSON.parse(req.body.exame);
        }
        if (typeof req.body.medicamentos_selecionados === 'string') {
            req.body.medicamentos_selecionados = JSON.parse(req.body.medicamentos_selecionados);
        }

        // 2. Extrai a lista para usar lá embaixo no setMedicamentos
        const listaMedicamentosIds = req.body.medicamentos_selecionados || [];

        const schema = Yup.object({
            medico_id: Yup.number().required(),
            estadiamento: Yup.string().oneOf(['I', 'II', 'III', 'IV']).required(),
            data_contato: Yup.date().required(),
            paciente_id: Yup.number().required(),
            diagnostico_id: Yup.number().required(),
            prestador_medico_id: Yup.number().required(),
            comorbidade: Yup.object().required(),
            exame: Yup.object().required(),
            medicamentos_selecionados: Yup.array().of(Yup.number()).nullable()
        });

        try {
            await schema.validate(req.body, { abortEarly: false });
        } catch (err) {
            return res.status(400).json({ error: 'Erro de validação', messages: err.inner });
        }

        try {
            const infoComorbidade = await InfosComorbidade.create(req.body.comorbidade);
            const exame = await Exames.create(req.body.exame);

            // 1. Cria a entrevista sem as chaves antigas de medicamento
            const entrevistaMedica = await EntrevistaMedica.create({
                ...req.body,
                infos_comorbidades_id: infoComorbidade.id,
                exame_id: exame.id,
            });

            // 2. Associa os Medicamentos na Tabela Intermediária (MUITOS-PARA-MUITOS)
            // Se o array tiver IDs, o Sequelize cuida de inserir na 'entrevista_medicamentos'
            if (listaMedicamentosIds && listaMedicamentosIds.length > 0) {
                await entrevistaMedica.setMedicamentos(listaMedicamentosIds);
            }

            // SALVANDO OS ANEXOS
            if (req.files && req.files.length > 0) {
                let nomesAnexos = req.body.anexos_nomes || [];
                if (!Array.isArray(nomesAnexos)) {
                    nomesAnexos = [nomesAnexos];
                }

                const anexosData = req.files.map((file, index) => ({
                    entrevista_profissional_id: entrevistaMedica.id,
                    nome: nomesAnexos[index] || 'Sem Nome',
                    file_path: file.filename,
                    original_name: file.originalname
                }));

                await EntrevistaMedicaAnexos.bulkCreate(anexosData);
            }

            const pacientes = await Pacientes.findOne({ where: { id: entrevistaMedica.paciente_id } });

            if (pacientes) {
                pacientes.fez_entrevista = true;
                await pacientes.save();
            }

            return res.status(201).json(entrevistaMedica);
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao processar entrevista', details: err.message });
        }
    }

    // --- FUNÇÃO INDEX ALTERADA ---
    async index(req, res) {
        const operadoraQueryId = req.query.operadora_id;
        const permission = await getOperadoraFilter(req.userId, operadoraQueryId);

        if (!permission.authorized) {
            if (permission.emptyResult) return res.json([]);
            return res.status(permission.status).json({ error: permission.error });
        }

        const includePacienteWhere = permission.whereClause;

        try {
            const entrevistasMedicas = await EntrevistaMedica.findAll({
                include: [
                    { model: Medico, as: 'medico', attributes: ['id', 'nome', 'crm'] },
                    { model: Diagnostico, as: 'diagnostico_cid' },
                    { model: Exames, as: 'exames', include: ['prestador_medico'] },
                    {
                        model: InfosComorbidade,
                        as: 'infos_comorbidade',
                        include: [{ model: Comorbidades, as: 'comorbidade_mestre', attributes: ['nome'] }]
                    },
                    // NOVA FORMA DE INCLUIR OS MEDICAMENTOS
                    {
                        model: Medicamentos,
                        as: 'medicamentos', // Esse 'as' deve bater exatamente com o que você colocou no Model.associate
                        attributes: ['id', 'nome', 'nome_comercial', 'principio_ativo', 'dosagem', 'tipo_dosagem'],
                        through: { attributes: [] } // Evita trazer os dados da tabela intermediária (entrevista_medicamentos) suja no JSON
                    },
                    { model: PrestadorMedico, as: 'prestador_medico' },
                    {
                        model: Pacientes,
                        as: 'paciente',
                        where: {
                            ...includePacienteWhere, // Mantém os filtros de operadora que vieram da permissão
                            is_active: true          // Adiciona a regra de que o paciente deve estar ativo
                        },
                        required: true               // Como está true, faz um INNER JOIN (não traz a entrevista se o paciente não passar no filtro)
                    },
                    {
                        model: EntrevistaMedicaAnexos,
                        as: 'anexos',
                        attributes: ['id', 'nome', 'file_path', 'original_name']
                    }
                ],
                order: [['createdAt', 'DESC']]
            });

            return res.status(200).json(entrevistasMedicas);
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao buscar entrevistas', details: error.message });
        }
    }

    // --- FUNÇÃO SHOW ALTERADA ---
    async show(req, res) {
        const { id } = req.params;

        const permission = await getOperadoraFilter(req.userId);

        if (!permission.authorized) {
            if (permission.emptyResult) return res.status(403).json({ error: 'Acesso negado.' });
            return res.status(permission.status).json({ error: permission.error });
        }

        const includePacienteWhere = permission.whereClause;

        try {
            const entrevista = await EntrevistaMedica.findByPk(id, {
                include: [
                    { model: Medico, as: 'medico', attributes: ['id', 'nome', 'crm'] },
                    { model: Diagnostico, as: 'diagnostico_cid' },
                    { model: Exames, as: 'exames', include: ['prestador_medico'] },
                    {
                        model: InfosComorbidade,
                        as: 'infos_comorbidade',
                        include: [{ model: Comorbidades, as: 'comorbidade_mestre', attributes: ['nome'] }]
                    },

                    // NOVA FORMA DE INCLUIR OS MEDICAMENTOS AQUI TAMBÉM
                    {
                        model: Medicamentos,
                        as: 'medicamentos',
                        attributes: ['id', 'nome', 'nome_comercial', 'principio_ativo', 'dosagem', 'tipo_dosagem'],
                        through: { attributes: [] }
                    },
                    { model: PrestadorMedico, as: 'prestador_medico' },
                    {
                        model: Pacientes,
                        as: 'paciente',
                        where: {
                            ...includePacienteWhere, // Mantém os filtros de operadora que vieram da permissão
                            is_active: true          // Adiciona a regra de que o paciente deve estar ativo
                        },
                        required: true               // Como está true, faz um INNER JOIN (não traz a entrevista se o paciente não passar no filtro)
                    },
                    {
                        model: EntrevistaMedicaAnexos,
                        as: 'anexos',
                        attributes: ['id', 'nome', 'file_path', 'original_name']
                    }
                ]
            });

            if (!entrevista) {
                return res.status(404).json({ error: 'Entrevista não encontrada ou acesso negado' });
            }

            return res.json(entrevista);
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao buscar entrevista', details: error.message });
        }
    }
}

export default new EntrevistaMedicaController();