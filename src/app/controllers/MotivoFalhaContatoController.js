import MotivoFalhaContato from '../models/MotivoFalhaContato.js';
import * as Yup from 'yup';

class MotivoFalhaContatoController {
  // Listar motivos (O frontend do monitoramento vai usar essa rota)
  async index(req, res) {
    try {
      // Se passar ?all=true na URL, traz todos (útil para a tela de admin)
      // Se não, traz só os ativos (útil para o select do modal)
      const whereClause = req.query.all ? {} : { ativo: true };

      const motivos = await MotivoFalhaContato.findAll({
        where: whereClause,
        order: [['descricao', 'ASC']]
      });

      return res.json(motivos);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao buscar motivos de falha de contato.' });
    }
  }

  // Criar um novo motivo
  async store(req, res) {
    const schema = Yup.object().shape({
      descricao: Yup.string().required('A descrição é obrigatória.'),
      ativo: Yup.boolean()
    });

    try { await schema.validate(req.body, { abortEarly: false }); } 
    catch (err) { return res.status(400).json({ error: 'Falha na validação', messages: err.inner }); }

    try {
      const { descricao, ativo = true } = req.body;

      const motivoExists = await MotivoFalhaContato.findOne({ where: { descricao } });
      if (motivoExists) {
        return res.status(400).json({ error: 'Já existe um motivo cadastrado com essa descrição.' });
      }

      const motivo = await MotivoFalhaContato.create({ descricao, ativo });
      
      return res.status(201).json(motivo);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao criar motivo de falha.', details: error.message });
    }
  }

  // Editar um motivo (corrigir texto ou status)
  async update(req, res) {
    const schema = Yup.object().shape({
      descricao: Yup.string(),
      ativo: Yup.boolean()
    });

    try { await schema.validate(req.body, { abortEarly: false }); } 
    catch (err) { return res.status(400).json({ error: 'Falha na validação', messages: err.inner }); }

    try {
      const motivo = await MotivoFalhaContato.findByPk(req.params.id);
      
      if (!motivo) {
        return res.status(404).json({ error: 'Motivo não encontrado.' });
      }

      await motivo.update(req.body);

      return res.json(motivo);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao atualizar motivo.', details: error.message });
    }
  }

  // "Deletar" (Inativar para não quebrar chaves estrangeiras)
  async delete(req, res) {
    try {
      const motivo = await MotivoFalhaContato.findByPk(req.params.id);
      
      if (!motivo) {
        return res.status(404).json({ error: 'Motivo não encontrado.' });
      }

      // Inativa em vez de deletar do banco, assim os monitoramentos passados não perdem a referência
      await motivo.update({ ativo: false });

      return res.json({ message: 'Motivo inativado com sucesso.' });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao inativar motivo.', details: error.message });
    }
  }
}

export default new MotivoFalhaContatoController();