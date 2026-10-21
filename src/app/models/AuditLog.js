import Sequelize, { Model } from 'sequelize';

class AuditLog extends Model {
  static init(sequelize) {
    super.init(
      {
        action_type: Sequelize.STRING,
        entity: Sequelize.STRING,
        entity_id: Sequelize.INTEGER,
        details: Sequelize.TEXT,
        paciente_id: Sequelize.INTEGER, // 👈 NOVO: paciente afetado pela ação (ver migration add-paciente-id-to-audit-logs)
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
    this.belongsTo(models.Pacientes, { foreignKey: 'paciente_id', as: 'paciente' }); // 👈 NOVO
  }
}

export default AuditLog;