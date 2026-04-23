'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('patient_evaluations', 'data_proxima_avaliacao', {
      type: Sequelize.DATEONLY,
      allowNull: true,
      comment: 'Data prevista para a próxima avaliação (regra de 6 meses)'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('patient_evaluations', 'data_proxima_avaliacao');
  }
};