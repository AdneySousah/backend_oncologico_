import Sequelize, { Model } from 'sequelize';

class EvaluationTemplate extends Model {
  static init(sequelize) {
    super.init({
      title: Sequelize.STRING,
      description: Sequelize.STRING,
      is_active: Sequelize.BOOLEAN,
    }, {
      sequelize,
      tableName: 'evaluation_templates',
    });
    return this;
  }

  static associate(models) {
    this.hasMany(models.EvaluationQuestion, { foreignKey: 'template_id', as: 'questions' });
  }
}

export default EvaluationTemplate;