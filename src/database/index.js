import Sequelize from 'sequelize';
import configDatabase from '../config/database.cjs';
// Models Antigos
import User from '../app/models/User.js';
import Operadora from '../app/models/Operadora.js';
import Pacientes from '../app/models/Pacientes.js';
import EntrevistaMedica from '../app/models/EntrevistaMedica.js';
// NOVOS MODELS
import EvaluationTemplate from '../app/models/EvaluationTemplate.js';
import EvaluationQuestion from '../app/models/EvaluationQuestion.js';
import EvaluationOption from '../app/models/EvaluationOption.js';
import PatientEvaluation from '../app/models/PatientEvaluation.js';
import EvaluationAnswer from '../app/models/EvaluationAnswer.js';
import PacientesAnexos from '../app/models/PacientesAnexos.js';
import Medicamentos from '../app/models/Medicamentos.js';
import InfosMedicamento from '../app/models/InfosMedicamento.js';
import EntrevistaMedicaAnexos from '../app/models/EntrevistaMedicaAnexos.js';
import Perfil from '../app/models/Perfil.js';
import EntrevistaMedicamento from '../app/models/EntrevistaMedicamento.js';
import MonitoramentoMedicamento from '../app/models/MonitoramentoMedicamento.js';
import ReacaoAdversa from '../app/models/ReacaoAdversa.js';
import AuditLog from '../app/models/AuditLog.js';
import NpsResponse from '../app/models/NpsResponse.js';
import Conversation from '../app/models/Conversation.js';
import Message from '../app/models/Message.js';
import MotivoFalhaContato from '../app/models/MotivoFalhaContato.js';
import MotivoPausaTratamento from '../app/models/MotivoPausaTratamento.js';
import VersaoTermo from '../app/models/VersaoTermo.js';
import TermosHistorico from '../app/models/TermosHistorico.js';
import HistoricoTrocaMedicamento from '../app/models/HistoricoTrocaMedicamento.js';
import EventosPaciente from '../app/models/EventosPaciente.js';
import DashboardSnapshot from '../app/models/DashboardSnapshot.js';
import MonitoramentoEdicaoEmAndamento from '../app/models/MonitoramentoEdicaoEmAndamento.js';


const models = [
  User, Operadora, Pacientes, EntrevistaMedica,
  EvaluationTemplate, EvaluationQuestion, EvaluationOption,
  PatientEvaluation, EvaluationAnswer,
  PacientesAnexos, Medicamentos,InfosMedicamento,EntrevistaMedicaAnexos, Perfil, EntrevistaMedicamento,
  MonitoramentoMedicamento, ReacaoAdversa, AuditLog, NpsResponse, Conversation,Message,TermosHistorico, HistoricoTrocaMedicamento,
  EventosPaciente, MotivoFalhaContato, MotivoPausaTratamento, VersaoTermo, DashboardSnapshot, MonitoramentoEdicaoEmAndamento
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
