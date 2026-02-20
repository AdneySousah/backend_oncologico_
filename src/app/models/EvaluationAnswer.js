import Sequelize, { Model } from 'sequelize';

class EvaluationAnswer extends Model {
  static init(sequelize) {
    super.init({
      text_answer: Sequelize.TEXT,
      computed_score: Sequelize.INTEGER,
    }, {
      sequelize,
      tableName: 'evaluation_answers',
    });
    return this;
  }

  static associate(models) {
    this.belongsTo(models.PatientEvaluation, { foreignKey: 'evaluation_id', as: 'evaluation' });
    this.belongsTo(models.EvaluationQuestion, { foreignKey: 'question_id', as: 'question' });
    this.belongsTo(models.EvaluationOption, { foreignKey: 'option_selected_id', as: 'option' });
    
  }
}

export default EvaluationAnswer;