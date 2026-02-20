import Sequelize from 'sequelize';
import configDatabase from '../config/database.cjs';

// Models Antigos
import User from '../app/models/User.js';
import OncologyProfessional from '../app/models/OncologyProfessional.js';
import Especiality from '../app/models/Especiality.js';
import Operadora from '../app/models/Operadora.js';
import Pacientes from '../app/models/Pacientes.js';
import PrestadorMedico from '../app/models/PrestadorMedico.js';
import Diagnostico from '../app/models/Diagnostico.js';
import Exames from '../app/models/Exames.js';
import InfosComorbidade from '../app/models/InfosComorbidade.js';
import EntrevistaMedica from '../app/models/EntrevistaMedica.js';

// NOVOS MODELS
import EvaluationTemplate from '../app/models/EvaluationTemplate.js';
import EvaluationQuestion from '../app/models/EvaluationQuestion.js';
import EvaluationOption from '../app/models/EvaluationOption.js';
import PatientEvaluation from '../app/models/PatientEvaluation.js';
import EvaluationAnswer from '../app/models/EvaluationAnswer.js';
import Medico from '../app/models/Medico.js';
import PacientesAnexos from '../app/models/PacientesAnexos.js';
import Comorbidades from '../app/models/Comorbidades.js';
import Medicamentos from '../app/models/Medicamentos.js';
import InfosMedicamento from '../app/models/InfosMedicamento.js';
import EntrevistaMedicaAnexos from '../app/models/EntrevistaMedicaAnexos.js';
import Perfil from '../app/models/Perfil.js';
import EntrevistaMedicamento from '../app/models/EntrevistaMedicamento.js';

const models = [
  User, OncologyProfessional, Especiality, Operadora, Pacientes, 
  PrestadorMedico, Diagnostico, Exames, InfosComorbidade, EntrevistaMedica,
  // Novos
  EvaluationTemplate, EvaluationQuestion, EvaluationOption, 
  PatientEvaluation, EvaluationAnswer,Medico,
  PacientesAnexos, Comorbidades, Medicamentos,InfosMedicamento,EntrevistaMedicaAnexos, Perfil, EntrevistaMedicamento
];

class Database {
  constructor() {
    this.init();
  }

  init() {
    this.connection = new Sequelize(configDatabase);

    models
      .map((model) => model.init(this.connection))
      .map(
        (model) => model.associate && model.associate(this.connection.models)
      );
  }
}

export default new Database();