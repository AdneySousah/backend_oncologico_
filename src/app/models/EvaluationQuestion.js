import Sequelize, { Model } from 'sequelize';

class EvaluationQuestion extends Model {
  static init(sequelize) {
    super.init({
      enunciado: Sequelize.TEXT,
      tipo: Sequelize.ENUM('texto', 'multipla_escolha'),
    }, {
      sequelize,
      tableName: 'evaluation_questions',
    });
    return this;
  }

  static associate(models) {
    this.belongsTo(models.EvaluationTemplate, { foreignKey: 'template_id', as: 'template' });
    this.hasMany(models.EvaluationOption, { foreignKey: 'question_id', as: 'options' });
  }
}

export default EvaluationQuestion;