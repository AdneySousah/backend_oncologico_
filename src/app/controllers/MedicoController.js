import * as Yup from 'yup';
import Medico from '../models/Medico.js';
import PrestadorMedico from '../models/PrestadorMedico.js';

class MedicoController {
    async store(req, res) {
        // Validação: Exigimos nome, crm e um array com pelo menos 1 ID de prestador
        const schema = Yup.object({
            nome: Yup.string().required('Nome é obrigatório'),
            crm: Yup.string().required('CRM é obrigatório'),
            prestadores: Yup.array().of(Yup.number()).min(1, 'Selecione pelo menos um local de atendimento').required()
        });

        try {
            await schema.validate(req.body, { abortEarly: false });
        } catch (err) {
            return res.status(400).json({ error: 'Erro de validação', messages: err.inner });
        }

        try {
            const { nome, crm, prestadores } = req.body;

            // Verifica se o CRM já está cadastrado
            const medicoExists = await Medico.findOne({ where: { crm } });
            if (medicoExists) {
                return res.status(400).json({ error: 'Já existe um médico cadastrado com este CRM.' });
            }

            // Cria o Médico
            const medico = await Medico.create({ nome, crm });

            // Mágica do Sequelize: Usa o alias da relação N:N (as: 'locais_atendimento') 
            // para salvar na tabela pivô automaticamente
            if (prestadores && prestadores.length > 0) {
                await medico.setLocais_atendimento(prestadores);
            }

            return res.status(201).json(medico);
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao cadastrar médico', details: err.message });
        }
    }

    async index(req, res) {
        const medicos = await Medico.findAll({
            include: [
                {
                    model: PrestadorMedico,
                    as: 'locais_atendimento',
                    attributes: ['id', 'nome', 'tipo'],
                    through: { attributes: [] } // Oculta os dados da tabela pivô no JSON de resposta
                }
            ],
            order: [['nome', 'ASC']]
        });

        return res.status(200).json(medicos);
    }
}

export default new MedicoController();