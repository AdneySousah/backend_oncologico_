import Especiality from '../models/Especiality.js';

import * as Yup from 'yup';

class EspecialitesController {
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

    const speciality = await Especiality.create({ name });

    return res.status(201).json({ speciality });
  }

  // INDEX (Listar profissionais com os dados do usuário juntos)
  async index(req, res) {
    const especiality = await Especiality.findAll({
      attributes: ['id', 'name'],
    });

    return res.json(especiality);
  }
  
  // UPDATE (Atualizar dados profissionais)
  async update(req, res) {
      // Logica similar ao update do User, buscando pelo ID do OncologyProfessional
      // ...
  }
}

export default new EspecialitesController();