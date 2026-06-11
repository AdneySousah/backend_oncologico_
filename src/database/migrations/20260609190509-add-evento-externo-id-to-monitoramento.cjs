'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('monitoramento_medicamentos', 'evento_externo_id', {
      type: Sequelize.INTEGER,
      allowNull: true, // true para não quebrar os registros antigos
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('monitoramento_medicamentos', 'evento_externo_id');
  }
};