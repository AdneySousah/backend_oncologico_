'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('monitoramento_medicamentos', 'adesao_tratamento');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('monitoramento_medicamentos', 'adesao_tratamento', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
    });
  }
};