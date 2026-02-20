'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('users', 'perfil_id', {
      type: Sequelize.INTEGER,
      references: { model: 'perfis', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL', // Se deletar o perfil, o usuário não é apagado, fica null
      allowNull: true, 
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('users', 'perfil_id');
  }
};