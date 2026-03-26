'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.createTable('messages', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      conversation_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'conversations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      message_sid: {
        type: Sequelize.STRING,
        allowNull: true, // ID da mensagem na Twilio
      },
      direction: {
        type: Sequelize.ENUM('inbound', 'outbound-api', 'outbound-reply'),
        allowNull: false,
        // inbound: paciente enviou
        // outbound-api: disparo do sistema (template)
        // outbound-reply: atendente respondeu via chat
      },
      body: {
        type: Sequelize.TEXT,
        allowNull: true, // Pode ser null se for envio de mídia no futuro
      },
      status: {
        type: Sequelize.STRING,
        defaultValue: 'sent',
      },
      is_read: {
        type: Sequelize.BOOLEAN,
        defaultValue: false, // Para gerenciar "alertas de nova mensagem" no front
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });
  },

  down: async (queryInterface) => {
    return queryInterface.dropTable('messages');
  },
};