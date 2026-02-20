import OncologyProfessional from '../models/OncologyProfessional.js';
import User from '../models/User.js';
import * as Yup from 'yup';

class OncologyProfessionalController {
  // CREATE (Vincular perfil profissional a um usuario existente)
  async store(req, res) {
    const schema = Yup.object({
      user_id: Yup.number().required(),
      registry_type: Yup.string().required(), // CRM, COREN
      registry_number: Yup.string().required(),
      especiality_id: Yup.number().required(), // ID da especialidade, para relacionar com a tabela de especialidades
    });

  
    try{
      await schema.validate(req.body, { abortEarly: false });
    }
    catch (err) {
      return res.status(400).json({ error: 'Validation fails', messages: err.errors });
    }

    const { user_id, registry_type, registry_number, especiality_id } = req.body;

    // Verifica se o usuario existe
    const user = await User.findByPk(user_id);
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    // Verifica se já não é um profissional
    const professionalExists = await OncologyProfessional.findOne({ where: { user_id } });
    if (professionalExists) {
      return res.status(400).json({ error: 'Professional profile already exists for this user.' });
    }

    const professional = await OncologyProfessional.create({ user_id, registry_type, registry_number, especiality_id });

    return res.status(201).json({ professional });
  }

  // INDEX (Listar profissionais com os dados do usuário juntos)
  async index(req, res) {
    const professionals = await OncologyProfessional.findAll({
      attributes: ['id', 'registry_type', 'registry_number', 'especiality_id'],
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'email', 'active'],
          where: { active: true } // Apenas profissionais ativos
        },
        {
          model: Especiality,
          as: 'speciality',
          attributes: ['id', 'name']
        }
      ],
    });

    return res.json(professionals);
  }
  
  // UPDATE (Atualizar dados profissionais)
  async update(req, res) {
      // Logica similar ao update do User, buscando pelo ID do OncologyProfessional
      // ...
  }
}

export default new OncologyProfessionalController();