'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('monitoramento_medicamentos', 'data_entrega', {
      type: Sequelize.DATEONLY, // Alterado para DATEONLY
      allowNull: true, 
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('monitoramento_medicamentos', 'data_entrega');
  }
};