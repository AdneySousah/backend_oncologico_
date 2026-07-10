'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.addColumn('monitoramento_medicamentos', 'data_telemonitoramento_efetivado', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Data real em que o contato foi efetivado/concluído'
    });
  },

  down: async (queryInterface) => {
    return queryInterface.removeColumn('monitoramento_medicamentos', 'data_telemonitoramento_efetivado');
  }
};