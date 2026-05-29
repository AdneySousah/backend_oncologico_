'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Adiciona colunas na tabela de monitoramento_medicamentos
    await queryInterface.addColumn('monitoramento_medicamentos', 'qtd_caixas', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });

    await queryInterface.addColumn('monitoramento_medicamentos', 'qtd_total_capsulas', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });

    // Adiciona a coluna na tabela de pacientes (necessário para o PatientSyncService)
    await queryInterface.addColumn('pacientes', 'qtd_caixas', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: 1, // Valor default para manter a consistência de dados antigos
    });
  },

  async down(queryInterface, Sequelize) {
    // Remove as colunas em caso de rollback
    await queryInterface.removeColumn('monitoramento_medicamentos', 'qtd_caixas');
    await queryInterface.removeColumn('monitoramento_medicamentos', 'qtd_total_capsulas');
    
    await queryInterface.removeColumn('pacientes', 'qtd_caixas');
  }
};