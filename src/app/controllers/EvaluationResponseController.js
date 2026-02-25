import * as Yup from 'yup';
import PatientEvaluation from '../models/PatientEvaluation.js';
import EvaluationAnswer from '../models/EvaluationAnswer.js';
import EvaluationOption from '../models/EvaluationOption.js';
import EntrevistaMedica from '../models/EntrevistaMedica.js';
import EvaluationQuestion from '../models/EvaluationQuestion.js';
import Pacientes from '../models/Pacientes.js';
import EvaluationTemplate from '../models/EvaluationTemplate.js';
import Medico from '../models/Medico.js';
import Operadora from '../models/Operadora.js';
import { getOperadoraFilter } from '../../utils/permissionUtils.js'; 


class EvaluationResponseController {

  async store(req, res) {
    const schema = Yup.object({
      paciente_id: Yup.number().required(),
      template_id: Yup.number().required(),
      respostas: Yup.array().of(
        Yup.object().shape({
          question_id: Yup.number().required(),
          option_selected_id: Yup.number().nullable(), // Null se for texto
          text_answer: Yup.string().nullable()
        })
      ).required(),
      entrevista_profissional_id: Yup.number().nullable(), 
      data_proxima_consulta: Yup.date().nullable(),
      consulta: Yup.string().nullable(),
      observacoes: Yup.string().nullable(),
    });

    if (!(await schema.isValid(req.body))) {
      return res.status(400).json({ error: 'Validation fails' });
    }

    const { paciente_id, template_id, respostas, entrevista_profissional_id, data_proxima_consulta, consulta, observacoes } = req.body;

    let resultado = null;

    // CORREÇÃO: Só processa a data se ela não for nula
    if (data_proxima_consulta) {
      let [ano, mes, dia] = data_proxima_consulta.split('-').map(Number);
      let data = new Date(ano, mes - 1, dia);
      data.setDate(data.getDate() + 5);
      resultado = data.toLocaleDateString('sv-SE');
    }

    let totalScore = 0;
    const answersToCreate = [];

    // Processamento para calcular pontuação
    for (const resp of respostas) {
      let currentScore = 0;

      if (resp.option_selected_id) {
        const option = await EvaluationOption.findByPk(resp.option_selected_id);
        if (option) {
          currentScore = option.score;
        }
      }

      totalScore += currentScore;

      answersToCreate.push({
        question_id: resp.question_id,
        option_selected_id: resp.option_selected_id,
        text_answer: resp.text_answer,
        computed_score: currentScore 
      });
    }

    try {
      const evaluation = await PatientEvaluation.create({
        paciente_id,
        template_id,
        total_score: totalScore,
        entrevista_profissional_id,
        data_proxima_consulta,
        consulta,
        observacoes,
        data_proximo_contato: resultado
      });

      const finalAnswers = answersToCreate.map(a => ({ ...a, evaluation_id: evaluation.id }));

      await EvaluationAnswer.bulkCreate(finalAnswers);

      return res.json({ evaluation, answers: finalAnswers });

    } catch (err) {
      return res.status(500).json({ error: 'Error saving evaluation', details: err.message });
    }
  }

  async index(req, res) {
    // 1. CHAMA O UTILITÁRIO DE PERMISSÃO
    const operadoraQueryId = req.query.operadora_id; // Pega se existir filtro na URL
    const permission = await getOperadoraFilter(req.userId, operadoraQueryId);

    // 2. VERIFICA SE DEU ERRO OU SE RETORNA VAZIO
    if (!permission.authorized) {
        // Se o erro for de usuário sem operadora (emptyResult), retorna array vazio suavemente
        if (permission.emptyResult) return res.json([]); 
        
        // Caso contrário, devolve o erro e o status gerados no utilitário
        return res.status(permission.status).json({ error: permission.error });
    }

    // 3. RECUPERA A TRAVA GERADA
    const includePacienteWhere = permission.whereClause;

    try {
      const totalTemplatesAtivos = await EvaluationTemplate.count({ where: { is_active: true } });

      const entrevistas = await EntrevistaMedica.findAll({
        order: [['data_contato', 'DESC']],
        include: [
          { 
            model: Pacientes, 
  
            as: 'paciente',
            where: includePacienteWhere, // <--- APLICA A TRAVA AQUI
            required: true ,
            include:[
              {
                model: Operadora,
                as: 'operadoras',
                
              }
            ]

          },
          { model: Medico, as: 'medico', attributes: ['id', 'nome', 'crm'] }, 
          {
            model: PatientEvaluation,
            as: 'avaliacoes', 
            required: false, 
            include: [
              { model: EvaluationTemplate, as: 'template', attributes: ['title'] },
              {
                model: EvaluationAnswer,
                as: 'answers',
                include: [
                  { model: EvaluationQuestion, as: 'question' },
                  { model: EvaluationOption, as: 'option' }
                ]
              }
            ]
          }
        ]
      });

      // Formatação (mantida igual)
      const formattedEntrevistas = entrevistas.map(ent => {
        const data = ent.toJSON();
        const qtdRespondidos = data.avaliacoes ? data.avaliacoes.length : 0;

        let status = 'Pendente';
        if (qtdRespondidos > 0 && qtdRespondidos < totalTemplatesAtivos) status = 'Parcial';
        if (qtdRespondidos > 0 && qtdRespondidos >= totalTemplatesAtivos) status = 'Concluída';
        if (totalTemplatesAtivos === 0) status = 'Sem Questionários';

        data.status_avaliacao = status;
        data.total_templates_ativos = totalTemplatesAtivos;
        data.templates_respondidos = qtdRespondidos;
        
        return data;
      });

      return res.json(formattedEntrevistas);

    } catch (error) {
      console.log("Erro no index de EvaluationResponse:", error);
      return res.status(500).json({ error: "Erro ao buscar entrevistas" });
    }
  }
}

export default new EvaluationResponseController();