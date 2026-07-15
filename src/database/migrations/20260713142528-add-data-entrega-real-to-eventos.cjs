'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('eventos_pacientes', 'data_entrega_real', {
      type: Sequelize.DATEONLY,
      allowNull: true,
      comment: 'Data extraída de medicament_received_date (real data em que o medicamento foi entregue)',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('eventos_pacientes', 'data_entrega_real');
  }
};