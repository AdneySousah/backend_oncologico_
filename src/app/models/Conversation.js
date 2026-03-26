import Sequelize, { Model } from 'sequelize';

class Conversation extends Model {
  static init(sequelize) {
    super.init(
      {
        phone_number: Sequelize.STRING,
        paciente_id: Sequelize.INTEGER,
        window_expires_at: Sequelize.DATE,
        assigned_user_id: Sequelize.INTEGER,
      },
      {
        sequelize,
      }
    );
    return this;
  }

  static associate(models) {
    this.hasMany(models.Message, { foreignKey: 'conversation_id', as: 'messages' });
    this.belongsTo(models.User, { foreignKey: 'assigned_user_id', as: 'responsavel' });
    // NOVO: Relacionamento com o Paciente
    this.belongsTo(models.Pacientes, { foreignKey: 'paciente_id', as: 'paciente' }); 
  }
}

export default Conversation;