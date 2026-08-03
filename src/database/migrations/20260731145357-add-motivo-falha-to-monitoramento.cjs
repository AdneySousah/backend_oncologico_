'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('monitoramento_medicamentos', 'motivo_falha_contato_id', {
      type: Sequelize.INTEGER,
      references: { model: 'motivos_falha_contato', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('monitoramento_medicamentos', 'motivo_falha_contato_id');
  }
};