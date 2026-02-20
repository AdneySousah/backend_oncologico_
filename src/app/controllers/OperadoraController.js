import * as Yup from 'yup';
import Operadora from '../models/Operadora.js';
import User from '../models/User.js'; // Importado para poder listar os usuários vinculados

class OperadoraController {
  async store(req, res) {
    const schema = Yup.object({
      nome: Yup.string().required(),
      cnpj: Yup.string().max(14, 'CNPJ must be at most 14 characters').required(),
      telefone: Yup.string().required(),
      email: Yup.array().of(Yup.string().email())
    });

    try {
      await schema.validate(req.body, { abortEarly: false });
    } catch (err) {
      return res.status(400).json({
        error: 'Validation fails',
        messages: err.inner.map(e => ({ field: e.path, message: e.message }))
      });
    }

    const { nome, cnpj, telefone, email } = req.body;

    const isName = await Operadora.findOne({ where: { nome } });

    if (isName) {
      return res.status(400).json({ error: 'Operadora already exists' });
    }

    const operadora = await Operadora.create({
      nome,
      cnpj,
      telefone,
      email
    });

    return res.status(201).json(operadora);
  }

  async index(req, res) {
    const operadoras = await Operadora.findAll({
      // Adicionamos esse include para você saber quais usuários pertencem à operadora
      include: [
        {
          model: User,
          as: 'users',
          attributes: ['id', 'name', 'email'],
          through: { attributes: [] } // Esconde a tabela intermediária
        }
      ]
    });
    return res.status(200).json(operadoras);
  }

  async update(req, res) {
    const schema = Yup.object({
      nome: Yup.string(),
      cnpj: Yup.string().max(18),
      telefone: Yup.string(),
      email: Yup.array().of(Yup.string().email())
    });

    try {
      await schema.validate(req.body, { abortEarly: false });
    } catch (err) {
      return res.status(400).json({
        error: 'Validation fails',
        messages: err.inner.map(e => ({ field: e.path, message: e.message }))
      });
    }

    const { id } = req.params;
    const operadora = await Operadora.findByPk(id);

    if (!operadora) {
      return res.status(400).json({ error: 'Operadora not found' });
    }

    if (req.body.cnpj && req.body.cnpj !== operadora.cnpj) {
      const operadoraExists = await Operadora.findOne({ where: { cnpj: req.body.cnpj } });
      if (operadoraExists) {
        return res.status(400).json({ error: 'CNPJ already in use.' });
      }
    }

    await operadora.update(req.body);

    return res.status(200).json(operadora);
  }
}

export default new OperadoraController();