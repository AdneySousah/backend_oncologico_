import Sequelize, { Model } from 'sequelize';

class Message extends Model {
  static init(sequelize) {
    super.init(
      {
        conversation_id: Sequelize.INTEGER,
        user_id: Sequelize.INTEGER, // Adicionado
        message_sid: Sequelize.STRING,
        direction: Sequelize.ENUM('inbound', 'outbound-api', 'outbound-reply'),
        body: Sequelize.TEXT,
        status: Sequelize.STRING,
        is_read: Sequelize.BOOLEAN,
      },
      {
        sequelize,
      }
    );
    return this;
  }

  static associate(models) {
    this.belongsTo(models.Conversation, { foreignKey: 'conversation_id', as: 'conversation' });
    this.belongsTo(models.User, { foreignKey: 'user_id', as: 'usuario' }); // Adicionado
  }
}

export default Message;