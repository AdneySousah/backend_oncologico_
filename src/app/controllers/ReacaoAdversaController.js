

import * as Yup from 'yup';
import ReacaoAdversa from '../models/ReacaoAdversa.js';

class ReacaoAdversaController {
  // CREATE (Vincular perfil profissional a um usuario existente)
  async store(req, res) {
    const schema = Yup.object({
      name: Yup.string().required(),
    });

  
    try{
      await schema.validate(req.body, { abortEarly: false });
    }
    catch (err) {
      return res.status(400).json({ error: 'Validation fails', messages: err.errors });
    }

    const { name } = req.body;

    const reacaoAdversa = await ReacaoAdversa.create({ name });

    return res.status(201).json({ reacaoAdversa });
  }

  // INDEX (Listar profissionais com os dados do usuário juntos)
  async index(req, res) {
    const reacoesAdversas = await ReacaoAdversa.findAll({
      attributes: ['id', 'name'],
    });

    return res.json(reacoesAdversas);
  }
  
  // UPDATE (Atualizar dados profissionais)
  async update(req, res) {
      // Logica similar ao update do User, buscando pelo ID do OncologyProfessional
      const schema = Yup.object({
      name: Yup.string().required(),
    });

    try{
      await schema.validate(req.body, { abortEarly: false });
    }
    catch (err) {
      return res.status(400).json({ error: 'Validation fails', messages: err.errors });
    }

    const { id } = req.params;
    const { name } = req.body;

    const reacaoAdversa = await ReacaoAdversa.findByPk(id);

    if (!reacaoAdversa) {
      return res.status(404).json({ error: 'Reação adversa not found' });
    }

    await reacaoAdversa.update({ name });

    return res.json(reacaoAdversa);
  }
}

export default new ReacaoAdversaController();