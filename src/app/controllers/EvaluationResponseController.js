import * as Yup from 'yup';
import PatientEvaluation from '../models/PatientEvaluation.js';
import EvaluationAnswer from '../models/EvaluationAnswer.js';
import EvaluationOption from '../models/EvaluationOption.js';
import EvaluationQuestion from '../models/EvaluationQuestion.js';
import Pacientes from '../models/Pacientes.js';
import EvaluationTemplate from '../models/EvaluationTemplate.js';
import Medicamentos from '../models/Medicamentos.js';
import Operadora from '../models/Operadora.js';
import { getOperadoraFilter } from '../../utils/permissionUtils.js';
import AuditService from '../../services/AuditService.js';


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

    if (data_proxima_consulta) {
      let [ano, mes, dia] = data_proxima_consulta.split('-').map(Number);
      let data = new Date(ano, mes - 1, dia);
      data.setDate(data.getDate() + 5);
      resultado = data.toLocaleDateString('sv-SE');
    }

    // NOVA REGRA: Calcula a próxima avaliação para daqui a 6 meses
    const dateProximaAvaliacao = new Date();
    dateProximaAvaliacao.setMonth(dateProximaAvaliacao.getMonth() + 6);
    const dataProximaAvaliacaoFormatada = dateProximaAvaliacao.toISOString().split('T')[0]; // Formato YYYY-MM-DD

    let totalScore = 0;
    const answersToCreate = [];

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
        data_proximo_contato: resultado,
        data_proxima_avaliacao: dataProximaAvaliacaoFormatada
      });

      const finalAnswers = answersToCreate.map(a => ({ ...a, evaluation_id: evaluation.id }));
      await EvaluationAnswer.bulkCreate(finalAnswers);

      const paciente = await Pacientes.findByPk(paciente_id);
      const template = await EvaluationTemplate.findByPk(template_id);

      const nomePaciente = paciente ? `${paciente.nome} ${paciente.sobrenome}`.trim() : `ID ${paciente_id}`;
      const nomeTemplate = template ? template.title : `ID ${template_id}`;

      await AuditService.log(
        req.userId,
        'Criação',
        'Entrevista/Avaliação',
        evaluation.id,
        `Respondeu questionário "${nomeTemplate}" para o paciente ${nomePaciente}. Score: ${totalScore}`
      );

      return res.json({ evaluation, answers: finalAnswers });

    } catch (err) {
      return res.status(500).json({ error: 'Error saving evaluation', details: err.message });
    }
  }

  async index(req, res) {
    const operadoraQueryId = req.query.operadora_id;
    const permission = await getOperadoraFilter(req.userId, operadoraQueryId);

    if (!permission.authorized) {
      if (permission.emptyResult) return res.json([]);
      return res.status(permission.status).json({ error: permission.error });
    }

    const includePacienteWhere = permission.whereClause;

    try {
      const totalTemplatesAtivos = await EvaluationTemplate.count({ where: { is_active: true } });

      const pacientes = await Pacientes.findAll({
        where: { ...includePacienteWhere, is_active: true },
        // 2. ORDENAÇÃO ATUALIZADA: Pega o model incluído e ordena pelo price DESC
        order: [
          [{ model: Medicamentos, as: 'medicamento' }, 'price', 'DESC'],
          ['createdAt', 'DESC'] // Desempate pela data de criação
        ],
        include: [
          {
            model: Operadora,
            as: 'operadoras',
          },
          // 3. INCLUDE NOVO: Traz o medicamento atrelado para pegar o price
          {
            model: Medicamentos,
            as: 'medicamento',
            attributes: ['id', 'nome', 'price']
          },
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

      const formattedPacientes = pacientes.map(pac => {
        const data = pac.toJSON();
        const qtdRespondidos = data.avaliacoes ? data.avaliacoes.length : 0;

        let status = 'Pendente';
        if (qtdRespondidos > 0 && qtdRespondidos < totalTemplatesAtivos) status = 'Parcial';
        if (qtdRespondidos > 0 && qtdRespondidos >= totalTemplatesAtivos) status = 'Concluída';
        if (totalTemplatesAtivos === 0) status = 'Sem Questionários';

        data.status_avaliacao = status;
        data.total_templates_ativos = totalTemplatesAtivos;
        data.templates_respondidos = qtdRespondidos;

        // 4. NOVA REGRA FRONTEND: 
        // Removemos a busca pela data_proximo_contato antiga.
        // Já deixamos o "price" na raiz do objeto para facilitar a montagem da tabela no Frontend.
        data.price = data.medicamento ? data.medicamento.price : 0;

        return data;
      });

      return res.json(formattedPacientes);

    } catch (error) {
      console.log("Erro no index de EvaluationResponse:", error);
      return res.status(500).json({ error: "Erro ao buscar pacientes e avaliações" });
    }
  }


  async history(req, res) {
    try {
      const { paciente_id } = req.params;
      const avaliacoes = await PatientEvaluation.findAll({
        where: { paciente_id },
        include: [
          { model: Pacientes, as: 'paciente', attributes: ['nome', 'sobrenome'] },
          { model: EvaluationTemplate, as: 'template', attributes: ['title'] }
        ],
        order: [['createdAt', 'DESC']]
      });
      return res.json(avaliacoes);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao buscar histórico de avaliações' });
    }
  }

  // NOVO MÉTODO: Alertas de Avaliação Pendente (Sidebar)
  async pendentesAlerta(req, res) {
    try {
      const operadoraQueryId = req.query.operadora_id;
      const permission = await getOperadoraFilter(req.userId, operadoraQueryId);
      if (!permission.authorized) return res.json([]);

      // Busca as avaliações com permissão
      const avaliacoes = await PatientEvaluation.findAll({
        include: [
          { model: Pacientes, as: 'paciente', where: { ...permission.whereClause, is_active: true }, attributes: ['id', 'nome', 'sobrenome'] },
          { model: EvaluationTemplate, as: 'template', attributes: ['title'] }
        ],
        order: [['createdAt', 'DESC']]
      });

      // Filtra apenas a ÚLTIMA avaliação de cada paciente
      const latestPerPatient = new Map();
      avaliacoes.forEach(av => {
        if (!latestPerPatient.has(av.paciente_id)) {
          latestPerPatient.set(av.paciente_id, av);
        }
      });

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const limiteDeDias = new Date(hoje);
      limiteDeDias.setDate(limiteDeDias.getDate() + 5); // Alerta 5 dias antes de vencer

      const alertas = [];
      latestPerPatient.forEach(av => {
        if (av.data_proxima_avaliacao) {
          const dataProx = new Date(av.data_proxima_avaliacao + 'T00:00:00');
          if (dataProx <= limiteDeDias) {
            alertas.push(av);
          }
        }
      });

      return res.json(alertas);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao buscar alertas' });
    }
  }
}

export default new EvaluationResponseController();