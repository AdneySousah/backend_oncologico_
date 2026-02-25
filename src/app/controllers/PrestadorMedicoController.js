import * as Yup from 'yup';
import { Op } from 'sequelize';
import PrestadorMedico from '../models/PrestadorMedico.js';


class PrestadorMedicoController {
    async store(req, res) {
        // Atualizamos o schema para garantir que o front enviou os dados do endereço
        const schema = Yup.object({
            nome: Yup.string().required(),
            cnpj: Yup.string().required(),
            cep: Yup.string().required(),
            logradouro: Yup.string().required(),
            bairro: Yup.string().required(),
            cidade: Yup.string().required(),
            estado: Yup.string().required(),
            tipo: Yup.string().oneOf(['hospital', 'clinica', 'laboratorio']).required(),
        });

        try {
            await schema.validate(req.body, { abortEarly: false });
        } catch (err) {
            return res.status(400).json({ error: err.errors });
        }

        // Criamos o prestador passando os dados que já vieram validados do frontend
        const prestadorMedico = await PrestadorMedico.create({
            nome: req.body.nome,
            cnpj: req.body.cnpj,
            cep: req.body.cep,
            logradouro: req.body.logradouro,
            numero: req.body.numero || 'S/N',
            complemento: req.body.complemento || '',
            bairro: req.body.bairro,
            cidade: req.body.cidade,
            estado: req.body.estado,
            tipo: req.body.tipo,
        });

        return res.status(201).json(prestadorMedico);
    }

    async index(req, res) {
        const { nome, cnpj, tipo } = req.query;
        const where = {};

        if (nome) where.nome = { [Op.iLike]: `%${nome}%` };
        if (cnpj) where.cnpj = cnpj.replace(/\D/g, '');
        if (tipo) where.tipo = tipo;

        const prestadoresMedicos = await PrestadorMedico.findAll({ 
            where,
            order: [['nome', 'ASC']]
        });
        return res.json(prestadoresMedicos);
    }

    async update(req, res) {
        const { id } = req.params;
        const prestador = await PrestadorMedico.findByPk(id);

        if (!prestador) {
            return res.status(404).json({ error: 'Prestador não encontrado' });
        }

        // Como o frontend agora se encarrega de buscar o novo CEP e enviar
        // o logradouro, bairro, etc atualizados no req.body, só precisamos dar um update direto:
        await prestador.update(req.body);
        
        return res.json(prestador);
    }
}

export default new PrestadorMedicoController();