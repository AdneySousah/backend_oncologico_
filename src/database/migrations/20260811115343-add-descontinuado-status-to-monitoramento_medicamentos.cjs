'use strict';
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_monitoramento_medicamentos_status" ADD VALUE IF NOT EXISTS 'DESCONTINUADO';`
    );
    await queryInterface.addColumn('monitoramento_medicamentos', 'motivo_encerramento', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },
  down: async (queryInterface) => {
    // Postgres não permite remover um valor de ENUM diretamente (exigiria
    // recriar o tipo do zero). O rollback aqui remove só a coluna.
    await queryInterface.removeColumn('monitoramento_medicamentos', 'motivo_encerramento');
  },
};