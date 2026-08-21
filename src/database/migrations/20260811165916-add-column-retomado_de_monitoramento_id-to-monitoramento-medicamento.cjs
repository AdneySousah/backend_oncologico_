'use strict';
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('monitoramento_medicamentos', 'retomado_de_monitoramento_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'monitoramento_medicamentos', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('monitoramento_medicamentos', 'retomado_de_monitoramento_id');
  }
};