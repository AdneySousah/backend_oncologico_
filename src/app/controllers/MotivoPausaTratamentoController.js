import MotivoPausaTratamento from '../models/MotivoPausaTratamento.js';
import AuditService from '../../services/AuditService.js';
import * as Yup from 'yup';

class MotivoPausaTratamentoController {
  // Listar motivos (usado tanto pelo select de "Pausar Tratamento" quanto
  // pelo select de "Descontinuar Medicamento")
  async index(req, res) {
    try {
      // Se passar ?all=true na URL, traz todos (útil para a tela de admin)
      // Se não, traz só os ativos (útil para os selects dos dois fluxos)
      const whereClause = req.query.all ? {} : { ativo: true };

      const motivos = await MotivoPausaTratamento.findAll({
        where: whereClause,
        order: [['descricao', 'ASC']]
      });

      return res.json(motivos);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao buscar motivos de pausa/descontinuação.' });
    }
  }

  async store(req, res) {
    const schema = Yup.object().shape({
      descricao: Yup.string().required('A descrição é obrigatória.'),
      ativo: Yup.boolean()
    });

    try { await schema.validate(req.body, { abortEarly: false }); }
    catch (err) { return res.status(400).json({ error: 'Falha na validação', messages: err.inner }); }

    try {
      const { descricao, ativo = true } = req.body;

      const motivoExists = await MotivoPausaTratamento.findOne({ where: { descricao } });
      if (motivoExists) {
        return res.status(400).json({ error: 'Já existe um motivo cadastrado com essa descrição.' });
      }

      const motivo = await MotivoPausaTratamento.create({ descricao, ativo });

      await AuditService.log(req.userId, 'Criação', 'Motivo de Pausa/Descontinuação', motivo.id, `Motivo de Pausa/Descontinuação "${motivo.descricao}" criado.`);

      return res.status(201).json(motivo);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao criar motivo.', details: error.message });
    }
  }

  async update(req, res) {
    const schema = Yup.object().shape({
      descricao: Yup.string(),
      ativo: Yup.boolean()
    });

    try { await schema.validate(req.body, { abortEarly: false }); }
    catch (err) { return res.status(400).json({ error: 'Falha na validação', messages: err.inner }); }

    try {
      const motivo = await MotivoPausaTratamento.findByPk(req.params.id);

      if (!motivo) {
        return res.status(404).json({ error: 'Motivo não encontrado.' });
      }

      await motivo.update(req.body);
      await AuditService.log(req.userId, 'Edição', 'Motivo de Pausa/Descontinuação', motivo.id, `Motivo de Pausa/Descontinuação "${motivo.descricao}" editado.`);

      return res.json(motivo);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao atualizar motivo.', details: error.message });
    }
  }

  // "Deletar" (Inativar para não quebrar chaves estrangeiras já usadas em
  // pacientes/monitoramentos passados)
  async delete(req, res) {
    try {
      const motivo = await MotivoPausaTratamento.findByPk(req.params.id);

      if (!motivo) {
        return res.status(404).json({ error: 'Motivo não encontrado.' });
      }

      await motivo.update({ ativo: false });
      await AuditService.log(req.userId, 'Edição', 'Motivo de Pausa/Descontinuação', motivo.id, `Motivo de Pausa/Descontinuação "${motivo.descricao}" inativado.`);

      return res.json({ message: 'Motivo inativado com sucesso.' });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao inativar motivo.', details: error.message });
    }
  }
}

export default new MotivoPausaTratamentoController();
