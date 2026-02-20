import * as Yup from 'yup';
import Diagnostico from '../models/Diagnostico.js';

class DiagnosticoController {
  // CREATE
  async store(req, res) {
    const schema = Yup.object({
      diagnostico: Yup.string().required(),
    });

    try {
      await schema.validate(req.body, { abortEarly: false });
    } catch (err) {
      return res.status(400).json({ error: 'Falha na validação', messages: err.errors });
    }

    const { diagnostico } = req.body;

    const diagnosticoExists = await Diagnostico.findOne({ where: { diagnostico } });

    if (diagnosticoExists) {
      return res.status(400).json({ error: 'Diagnóstico já cadastrado.' });
    }

    const create_diagnostico = await Diagnostico.create({ diagnostico });

    return res.status(201).json(create_diagnostico);
  }

  // READ
  async index(req, res) {
    const diagnosticos = await Diagnostico.findAll({
      attributes: ['id', 'diagnostico'],
      order: [['diagnostico', 'ASC']] // Ordenado alfabeticamente
    });

    return res.json(diagnosticos);
  }

  // UPDATE (Nova Função)
  async update(req, res) {
    const schema = Yup.object({
      diagnostico: Yup.string().required(),
    });

    try {
      await schema.validate(req.body, { abortEarly: false });
    } catch (err) {
      return res.status(400).json({ error: 'Falha na validação', messages: err.errors });
    }

    const { id } = req.params;
    const { diagnostico } = req.body;

    const diag = await Diagnostico.findByPk(id);

    if (!diag) {
      return res.status(404).json({ error: 'Diagnóstico não encontrado.' });
    }

    // Verifica se já existe outro diagnóstico com o mesmo nome (evitar duplicidade no rename)
    if (diagnostico !== diag.diagnostico) {
      const exists = await Diagnostico.findOne({ where: { diagnostico } });
      if (exists) {
        return res.status(400).json({ error: 'Já existe um diagnóstico com este nome.' });
      }
    }

    await diag.update({ diagnostico });

    return res.json(diag);
  }
}

export default new DiagnosticoController();