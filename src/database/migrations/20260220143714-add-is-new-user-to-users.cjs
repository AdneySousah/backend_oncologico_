'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('users', 'is_new_user', {
      type: Sequelize.BOOLEAN,
      defaultValue: true, // Por padrão, todo usuário criado será "novo"
      allowNull: false,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('users', 'is_new_user');
  }
};