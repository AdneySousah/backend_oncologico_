import Sequelize, { Model } from 'sequelize';

class AuditLog extends Model {
  static init(sequelize) {
    super.init(
      {
        action_type: Sequelize.STRING,
        entity: Sequelize.STRING,
        entity_id: Sequelize.INTEGER,
        details: Sequelize.TEXT,
      },
      {
        sequelize,
      }
    );

    return this;
  }

  static associate(models) {
    // Relacionamento para podermos puxar o nome do usuário no Front
    this.belongsTo(models.User, { foreignKey: 'user_id', as: 'usuario' });
  }
}

export default AuditLog;