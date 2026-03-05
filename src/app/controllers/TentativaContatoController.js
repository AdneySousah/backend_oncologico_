import * as Yup from 'yup';
import TentativaContato from '../models/TentativaContato.js';

class TentativaContatoController {
    async store(req, res) {
        try {
            // 1. Criação do Schema de validação para os dados de entrada
            const schema = Yup.object().shape({
                paciente_id: Yup.number()
                    .integer('O ID do paciente deve ser um número inteiro.')
                    .required('O ID do paciente é obrigatório.'),
                medico_id: Yup.number()
                    .integer('O ID do médico deve ser um número inteiro.')
                    .required('O ID do médico é obrigatório.'),
                sucesso: Yup.boolean()
                    .required('O status de sucesso é obrigatório.')
            });

            // 2. Validação dos dados (abortEarly: false para retornar todos os erros de uma vez)
            await schema.validate(req.body, { abortEarly: false });

            const { paciente_id, medico_id, sucesso } = req.body;

            const tentativa = await TentativaContato.create({
                paciente_id,
                medico_id,
                sucesso
            });

            return res.status(201).json(tentativa);
        } catch (error) {
            // 3. Captura específica de erros do Yup
            if (error instanceof Yup.ValidationError) {
                return res.status(400).json({
                    error: 'Falha na validação dos dados.',
                    messages: error.inner.map(err => ({ field: err.path, message: err.message }))
                });
            }

            return res.status(500).json({ error: 'Erro ao registrar tentativa de contato', details: error.message });
        }
    }

    async index(req, res) {
        try {
            // 1. Criação do Schema para validar o parâmetro de busca (query)
            const schema = Yup.object().shape({
                paciente_id: Yup.number()
                    .integer('O ID do paciente deve ser um número inteiro.')
                    .positive('O ID do paciente não pode ser negativo.')
            });

            // 2. Validação do req.query
            await schema.validate(req.query, { abortEarly: false });

            const { paciente_id } = req.query;

            // Monta o objeto de filtro dinamicamente
            const whereClause = {};

            if (paciente_id) {
                whereClause.paciente_id = paciente_id;
            }

            const tentativas = await TentativaContato.findAll({
                where: whereClause,
                order: [['createdAt', 'DESC']]
            });

            return res.status(200).json(tentativas);

        } catch (error) {
            // 3. Captura específica de erros do Yup na busca
            if (error instanceof Yup.ValidationError) {
                return res.status(400).json({
                    error: 'Falha na validação dos parâmetros de busca.',
                    messages: error.inner.map(err => ({ field: err.path, message: err.message }))
                });
            }

            console.error("Erro no index de TentativaContato:", error); // Bom para ver no log do terminal
            return res.status(500).json({ error: 'Erro ao buscar tentativas de contato', details: error.message });
        }
    }
}

export default new TentativaContatoController();