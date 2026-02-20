'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('pacientes', 'status_termo', {
      type: Sequelize.ENUM('Pendente', 'Aceito', 'Recusado'),
      defaultValue: 'Pendente',
      allowNull: false,
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Desfaz a adição da coluna
    await queryInterface.removeColumn('pacientes', 'status_termo');
    
    // IMPORTANTE: Como você usa PostgreSQL, remover a coluna não apaga automaticamente o "tipo" ENUM criado no banco.
    // Esse comando força a limpeza do tipo para não dar erro se você precisar rodar a migration de novo.
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_pacientes_status_termo";');
  }
};