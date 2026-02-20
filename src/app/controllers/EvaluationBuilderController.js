import * as Yup from 'yup';
import { Op } from 'sequelize';
import PatientEvaluation from '../models/PatientEvaluation.js';
import EvaluationTemplate from '../models/EvaluationTemplate.js';
import EvaluationQuestion from '../models/EvaluationQuestion.js';
import EvaluationOption from '../models/EvaluationOption.js';

class EvaluationBuilderController {
  async store(req, res) {
    // Validação de estrutura aninhada complexa
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
              score: Yup.number().integer().required() // AQUI define quantos pontos vale
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

    // Criação em cadeia (Template -> Questions -> Options) usando include do Sequelize
    try {
      const template = await EvaluationTemplate.create({
        title,
        description,
        questions // O Sequelize entende isso se a association estiver correta e usarmos 'include'
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

  async index(req, res) {
    const templates = await EvaluationTemplate.findAll({
      include: [{
        model: EvaluationQuestion,
        as: 'questions',
        include: [{ model: EvaluationOption, as: 'options' }]
      }]
    });
    return res.json(templates);
  }


  async toggleStatus(req, res) {
    const { id } = req.params;

    const template = await EvaluationTemplate.findByPk(id);

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Inverte o valor atual (se true vira false, se false vira true)
    template.is_active = !template.is_active;
    
    await template.save();

    return res.json(template);
  }


  async getPendingForInterview(req, res) {
    const { entrevista_id } = req.params;

    try {
      // 1. Descobre quais templates já foram respondidos
      const respondidos = await PatientEvaluation.findAll({
        where: { entrevista_profissional_id: entrevista_id },
        attributes: ['template_id']
      });
      
      const respondidosIds = respondidos.map(r => r.template_id);

      // 2. Monta a condição dinamicamente (mais seguro que a versão anterior)
      const whereCondition = { is_active: true };
      
      if (respondidosIds.length > 0) {
        whereCondition.id = { [Op.notIn]: respondidosIds };
      }

      // 3. Busca os que faltam
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
      // Isso vai cuspir o erro real e detalhado no seu terminal do Node!
      console.error("Erro no getPendingForInterview:", error); 
      return res.status(500).json({ error: 'Erro ao buscar templates pendentes', details: error.message });
    }
  }
}

export default new EvaluationBuilderController();