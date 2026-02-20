import Sequelize, { Model } from 'sequelize';

class PatientEvaluation extends Model {
  static init(sequelize) {
    super.init({
      total_score: Sequelize.INTEGER,
      data_proxima_consulta: Sequelize.DATEONLY,
      consulta: Sequelize.BOOLEAN,
      observacoes: Sequelize.TEXT,
      data_proximo_contato: Sequelize.DATEONLY,
    }, {
      sequelize,
      tableName: 'patient_evaluations',
    });
    return this;
  }

  static associate(models) {
    this.belongsTo(models.EvaluationTemplate, { foreignKey: 'template_id', as: 'template' });
    this.belongsTo(models.Pacientes, { foreignKey: 'paciente_id', as: 'paciente' });
    this.hasMany(models.EvaluationAnswer, { foreignKey: 'evaluation_id', as: 'answers' });
    this.belongsTo(models.EntrevistaMedica, { foreignKey: 'entrevista_profissional_id', as: 'entrevista_profissional' });
  }
}

export default PatientEvaluation;
