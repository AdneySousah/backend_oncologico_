'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.createTable('conversations', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      phone_number: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true, // Cada número de telefone tem uma conversa ativa/histórico
      },
      paciente_id: {
        type: Sequelize.INTEGER,
        allowNull: true, // Opcional, caso queira vincular direto com a tabela de pacientes
        references: { model: 'pacientes', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      window_expires_at: {
        type: Sequelize.DATE,
        allowNull: true, // Quando a janela de 24h da Meta expira
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
    return queryInterface.dropTable('conversations');
  },
};