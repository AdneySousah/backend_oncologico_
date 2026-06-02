'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('monitoramento_medicamentos', 'data_administracao', {
      type: Sequelize.DATEONLY,
      allowNull: true,
      comment: 'Data em que o paciente efetivamente iniciou a administração do medicamento'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('monitoramento_medicamentos', 'data_administracao');
  }
};