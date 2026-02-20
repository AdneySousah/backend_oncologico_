import * as Yup from 'yup';
import { Op } from 'sequelize';
import getAdress from '../../utils/getAdress.js';
import PrestadorMedico from '../models/PrestadorMedico.js';

class PrestadorMedicoController {
    async store(req, res) {
        const schema = Yup.object({
            nome: Yup.string().required(),
            cnpj: Yup.string().required(),
            cep: Yup.string().required(),
            tipo: Yup.string().oneOf(['hospital', 'clinica', 'laboratorio']).required(),
        });

        try {
            await schema.validate(req.body, { abortEarly: false });
        } catch (err) {
            return res.status(400).json({ error: err.errors });
        }

        const { nome, cnpj, cep, tipo } = req.body;
        const consultaEndereco = await getAdress(cep);

        if (!consultaEndereco || consultaEndereco.length === 0 || consultaEndereco[0].erro) {
            return res.status(400).json({ error: 'CEP inválido ou não encontrado' });
        }

        const endereco = consultaEndereco[0];
        
        const prestadorMedico = await PrestadorMedico.create({
            nome,
            cnpj,
            cep,
            logradouro: endereco.logradouro,
            numero: req.body.numero || 'S/N',
            complemento: req.body.complemento || '',
            bairro: endereco.bairro,
            cidade: endereco.localidade,
            estado: endereco.uf,
            tipo,
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

    // --- NOVA FUNÇÃO UPDATE ---
    async update(req, res) {
        const { id } = req.params;
        const prestador = await PrestadorMedico.findByPk(id);

        if (!prestador) {
            return res.status(404).json({ error: 'Prestador não encontrado' });
        }

        // Se o CEP mudar, atualiza o endereço automaticamente
        if (req.body.cep && req.body.cep !== prestador.cep) {
            const consulta = await getAdress(req.body.cep);
            if (consulta && !consulta[0].erro) {
                const end = consulta[0];
                req.body.logradouro = end.logradouro;
                req.body.bairro = end.bairro;
                req.body.cidade = end.localidade;
                req.body.estado = end.uf;
            }
        }

        await prestador.update(req.body);
        return res.json(prestador);
    }
}

export default new PrestadorMedicoController();