import * as Yup from 'yup';
import { Op } from 'sequelize';
import PatientEvaluation from '../models/PatientEvaluation.js';
import EvaluationTemplate from '../models/EvaluationTemplate.js';
import EvaluationQuestion from '../models/EvaluationQuestion.js';
import EvaluationOption from '../models/EvaluationOption.js';

class EvaluationBuilderController {
  async store(req, res) {
    const schema = Yup.object().shape({
      title: Yup.string().required(),
      description: Yup.string(),
      questions: Yup.array().of(
        Yup.object().shape({
          enunciado: Yup.string().required(),
          tipo: Yup.mixed().oneOf(['texto', 'multipla_escolha']).required(),
          options: Yup.array().of(
            Yup.object().shape({
              label: Yup.string().required(),
              score: Yup.number().integer().required()
            })
          ).when('tipo', {
             is: 'multipla_escolha',
             then: (schema) => schema.min(1, 'Multipla escolha deve ter opções'),
             otherwise: (schema) => schema.notRequired()
          })
        })
      ).required()
    });

    try {
      await schema.validate(req.body, { abortEarly: false });
    } catch (err) {
      return res.status(400).json({ error: 'Validation fails', messages: err.inner });
    }

    const { title, description, questions } = req.body;

    try {
      const template = await EvaluationTemplate.create({
        title,
        description,
        questions
      }, {
        include: [{
          model: EvaluationQuestion,
          as: 'questions',
          include: [{
             model: EvaluationOption,
             as: 'options'
          }]
        }]
      });

      return res.json(template);

    } catch (error) {
      return res.status(500).json({ error: 'Database error', details: error.message });
    }
  }

  // MÉTODO NOVO: Atualiza o Template com Travas de Segurança
  async update(req, res) {
    const { id } = req.params;

    // Trava 2: Verificar se já existe histórico de respostas
    const historicoCount = await PatientEvaluation.count({ where: { template_id: id } });
    
    if (historicoCount > 0) {
      return res.status(403).json({ 
        error: 'Edição bloqueada: Este questionário já possui respostas registradas no histórico. Para manter a integridade, crie um novo modelo.' 
      });
    }

    // Mesmo schema de validação do Store
    const schema = Yup.object().shape({
      title: Yup.string().required(),
      description: Yup.string().nullable(),
      questions: Yup.array().of(
        Yup.object().shape({
          enunciado: Yup.string().required(),
          tipo: Yup.mixed().oneOf(['texto', 'multipla_escolha']).required(),
          options: Yup.array().of(
            Yup.object().shape({
              label: Yup.string().required(),
              score: Yup.number().integer().required()
            })
          ).when('tipo', {
             is: 'multipla_escolha',
             then: (schema) => schema.min(1, 'Multipla escolha deve ter opções'),
             otherwise: (schema) => schema.notRequired()
          })
        })
      ).required()
    });

    try {
      await schema.validate(req.body, { abortEarly: false });
    } catch (err) {
      return res.status(400).json({ error: 'Validation fails', messages: err.inner });
    }

    const { title, description, questions } = req.body;

    const template = await EvaluationTemplate.findByPk(id);
    if (!template) {
      return res.status(404).json({ error: 'Template não encontrado' });
    }

    // Iniciamos uma transação para garantir que, se falhar no meio, nada seja salvo
    const transaction = await EvaluationTemplate.sequelize.transaction();

    try {
      // 1. Atualiza dados básicos do template
      await template.update({ title, description }, { transaction });

      // 2. Busca e deleta as opções e perguntas antigas de forma limpa
      const oldQuestions = await EvaluationQuestion.findAll({ where: { template_id: id }, transaction });
      const oldQuestionIds = oldQuestions.map(q => q.id);
      
      if (oldQuestionIds.length > 0) {
          await EvaluationOption.destroy({ where: { question_id: { [Op.in]: oldQuestionIds } }, transaction });
          await EvaluationQuestion.destroy({ where: { template_id: id }, transaction });
      }

      // 3. Recria as perguntas e opções com base no novo payload
      for (const q of questions) {
          const novaPergunta = await EvaluationQuestion.create({
              template_id: id,
              enunciado: q.enunciado,
              tipo: q.tipo
          }, { transaction });

          if (q.tipo === 'multipla_escolha' && q.options && q.options.length > 0) {
              const optionsToCreate = q.options.map(opt => ({
                  question_id: novaPergunta.id,
                  label: opt.label,
                  score: opt.score
              }));
              await EvaluationOption.bulkCreate(optionsToCreate, { transaction });
          }
      }

      // Confirma as alterações no banco
      await transaction.commit();

      return res.json({ message: 'Template atualizado com sucesso!' });
    } catch (error) {
      // Se der erro, desfaz tudo
      await transaction.rollback();
      console.error(error);
      return res.status(500).json({ error: 'Erro ao atualizar template', details: error.message });
    }
  }

  async index(req, res) {
    const templates = await EvaluationTemplate.findAll({
      include: [{
        model: EvaluationQuestion,
        as: 'questions',
        include: [{ model: EvaluationOption, as: 'options' }]
      }]
    });

    // Anexamos a informação se ele é editável ou não para facilitar a vida do Frontend
    const templatesFormatados = [];
    for (const t of templates) {
      const data = t.toJSON();
      const countRespostas = await PatientEvaluation.count({ where: { template_id: t.id }});
      data.is_editable = countRespostas === 0;
      templatesFormatados.push(data);
    }

    return res.json(templatesFormatados);
  }

  async toggleStatus(req, res) {
    const { id } = req.params;
    const template = await EvaluationTemplate.findByPk(id);

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    template.is_active = !template.is_active;
    await template.save();

    return res.json(template);
  }

  async getPendingForInterview(req, res) {
    const { entrevista_id } = req.params;

    try {
      const respondidos = await PatientEvaluation.findAll({
        where: { entrevista_profissional_id: entrevista_id },
        attributes: ['template_id']
      });
      
      const respondidosIds = respondidos.map(r => r.template_id);
      const whereCondition = { is_active: true };
      
      if (respondidosIds.length > 0) {
        whereCondition.id = { [Op.notIn]: respondidosIds };
      }

      const templatesPendentes = await EvaluationTemplate.findAll({
        where: whereCondition,
        include: [{
          model: EvaluationQuestion,
          as: 'questions',
          include: [{ model: EvaluationOption, as: 'options' }]
        }]
      });

      return res.json(templatesPendentes);
    } catch (error) {
      console.error("Erro no getPendingForInterview:", error); 
      return res.status(500).json({ error: 'Erro ao buscar templates pendentes', details: error.message });
    }
  }
}

export default new EvaluationBuilderController();