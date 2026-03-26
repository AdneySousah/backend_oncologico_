'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Adiciona o responsável atual pela conversa
    await queryInterface.addColumn('conversations', 'assigned_user_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    // Adiciona o autor da mensagem (quem disparou ou quem respondeu)
    await queryInterface.addColumn('messages', 'user_id', {
      type: Sequelize.INTEGER,
      allowNull: true, // Será nulo quando a mensagem for 'inbound' (vinda do paciente)
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('messages', 'user_id');
    await queryInterface.removeColumn('conversations', 'assigned_user_id');
  },
};