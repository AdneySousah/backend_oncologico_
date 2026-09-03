'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('pacientes', 'motivo_pausa_tratamento_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'motivos_pausa_tratamento', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.addColumn('monitoramento_medicamentos', 'motivo_encerramento_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'motivos_pausa_tratamento', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('pacientes', 'motivo_pausa_tratamento_id');
    await queryInterface.removeColumn('monitoramento_medicamentos', 'motivo_encerramento_id');
  }
};
