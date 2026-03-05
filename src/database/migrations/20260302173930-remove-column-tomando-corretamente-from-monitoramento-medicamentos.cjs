'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('monitoramento_medicamentos', 'tomando_corretamente');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('monitoramento_medicamentos', 'tomando_corretamente', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
    });
  }
};