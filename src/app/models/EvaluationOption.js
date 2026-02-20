import Sequelize, { Model } from 'sequelize';

class EvaluationOption extends Model {
  static init(sequelize) {
    super.init({
      label: Sequelize.STRING,
      score: Sequelize.INTEGER,
    }, {
      sequelize,
      tableName: 'evaluation_options',
    });
    return this;
  }

  static associate(models) {
    this.belongsTo(models.EvaluationQuestion, { foreignKey: 'question_id', as: 'question' });
  }
}

export default EvaluationOption;