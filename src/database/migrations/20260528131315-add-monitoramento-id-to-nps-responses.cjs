'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('nps_responses', 'monitoramento_id', {
      type: Sequelize.INTEGER,
      allowNull: true, // Precisa ser true para não quebrar os registros antigos que já estão no banco
      references: { 
        model: 'monitoramento_medicamentos', // ⚠️ Confirme se este é o nome exato da sua tabela
        key: 'id' 
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('nps_responses', 'monitoramento_id');
  }
};